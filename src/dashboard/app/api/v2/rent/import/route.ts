/**
 * POST /api/v2/rent/import
 * Accepts a BofA CSV, matches Zelle transactions to tenants across all properties,
 * handles early payment detection, and returns a preview for confirmation.
 *
 * POST with { confirmed: true, rows: [...] } to actually save.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface TenantRow {
  id: number;
  first_name: string;
  last_name: string;
  unit_id: number;
  unit_label: string;
  property_id: number;
  property_address: string;
  rent_amount: number | null;
  lease_end_date: string | null;
  late_fee_grace_days: number | null;
  late_fee_amount: number | null;
}

interface ParsedTransaction {
  raw_date: string;
  description: string;
  amount: number;
  matched_tenant_id: number | null;
  matched_tenant_name: string | null;
  matched_unit_id: number | null;
  matched_unit_label: string | null;
  matched_property_address: string | null;
  assigned_month: string;         // YYYY-MM
  due_date: string;               // YYYY-MM-01
  is_early: boolean;
  is_late: boolean;
  late_fee_applicable: boolean;
  late_fee_amount: number | null;
  confidence: 'high' | 'low' | 'none';
  note: string;
}

function parseBofaCsv(csvText: string): Array<{ date: string; description: string; amount: number }> {
  const lines = csvText.trim().split('\n');
  const headerIdx = lines.findIndex(l =>
    l.toLowerCase().includes('date') && l.toLowerCase().includes('amount')
  );
  if (headerIdx === -1) return [];

  const headers = (lines[headerIdx] ?? '').split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const dateIdx = headers.findIndex(h => h === 'date');
  const descIdx = headers.findIndex(h => h.includes('description'));
  const amtIdx  = headers.findIndex(h => h === 'amount');

  const results: Array<{ date: string; description: string; amount: number }> = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    const amount = parseFloat(cols[amtIdx] ?? '0');
    if (isNaN(amount) || amount <= 0) continue;
    results.push({ date: cols[dateIdx] ?? '', description: cols[descIdx] ?? '', amount });
  }
  return results;
}

/** Normalize a name for fuzzy matching: lowercase, no punctuation */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Score how well a tenant name matches a transaction description */
function matchScore(description: string, tenant: TenantRow): number {
  const desc = normalizeName(description);
  const full = normalizeName(`${tenant.first_name} ${tenant.last_name}`);
  const first = normalizeName(tenant.first_name);
  const last = normalizeName(tenant.last_name);

  if (desc.includes(full)) return 100;
  if (desc.includes(last) && desc.includes(first)) return 90;
  if (desc.includes(last)) return 60;
  if (desc.includes(first) && first.length > 3) return 40;
  return 0;
}

/** Given a raw date string, determine the assigned month and whether it's early */
function assignMonth(rawDate: string, isEarlyThresholdDays = 5): {
  assignedMonth: string;
  dueDate: string;
  isEarly: boolean;
} {
  // Parse MM/DD/YYYY or YYYY-MM-DD
  let d: Date;
  if (rawDate.includes('/')) {
    const [m, day, y] = rawDate.split('/');
    d = new Date(`${y}-${m?.padStart(2,'0')}-${day?.padStart(2,'0')}`);
  } else {
    d = new Date(rawDate);
  }
  if (isNaN(d.getTime())) {
    return { assignedMonth: '', dueDate: '', isEarly: false };
  }

  const dayOfMonth = d.getDate();
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();

  // If paid in the last N days of the month, assign to NEXT month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isEarly = dayOfMonth >= (daysInMonth - isEarlyThresholdDays + 1);

  let assignedYear = year;
  let assignedMonth = month + 1; // 1-indexed
  if (isEarly) {
    assignedMonth = month + 2;
    if (assignedMonth > 12) { assignedMonth = 1; assignedYear++; }
  }

  const monthStr = `${assignedYear}-${String(assignedMonth).padStart(2, '0')}`;
  const dueDate = `${monthStr}-01`;
  return { assignedMonth: monthStr, dueDate, isEarly };
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  // ── PREVIEW mode: parse CSV and return matched transactions ──
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try { formData = await req.formData(); } catch {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const csvText = await file.text();
    const transactions = parseBofaCsv(csvText);
    if (!transactions.length) {
      return NextResponse.json({ error: 'No credit transactions found in CSV' }, { status: 400 });
    }

    // Load all active tenants with their lease details
    const tenants = await query<TenantRow>(`
      SELECT t.id, t.first_name, t.last_name, t.unit_id,
             u.unit_label, u.property_id,
             p.address AS property_address,
             l.rent_amount, l.end_date AS lease_end_date,
             l.late_fee_grace_days, l.late_fee_amount
      FROM tenants t
      JOIN units u ON u.id = t.unit_id
      JOIN owned_properties p ON p.id = u.property_id
      LEFT JOIN LATERAL (
        SELECT * FROM leases WHERE unit_id = t.unit_id ORDER BY start_date DESC LIMIT 1
      ) l ON TRUE
      WHERE t.is_active = TRUE
    `);

    const preview: ParsedTransaction[] = transactions.map(tx => {
      // Find best matching tenant
      let bestTenant: TenantRow | null = null;
      let bestScore = 0;
      for (const t of tenants) {
        const score = matchScore(tx.description, t);
        if (score > bestScore) { bestScore = score; bestTenant = t; }
      }

      const { assignedMonth, dueDate, isEarly } = assignMonth(tx.date);

      // Determine if late — parse the transaction date
      let isLate = false;
      let lateFeeApplicable = false;
      const graceDays = bestTenant?.late_fee_grace_days ?? 5;
      if (dueDate && tx.date) {
        let txDate: Date;
        if (tx.date.includes('/')) {
          const [m, day, y] = tx.date.split('/');
          txDate = new Date(`${y}-${m?.padStart(2,'0')}-${day?.padStart(2,'0')}`);
        } else {
          txDate = new Date(tx.date);
        }
        const due = new Date(dueDate);
        const diffDays = Math.ceil((txDate.getTime() - due.getTime()) / 86400000);
        if (diffDays > graceDays && !isEarly) {
          isLate = true;
          lateFeeApplicable = true;
        }
      }

      return {
        raw_date: tx.date,
        description: tx.description,
        amount: tx.amount,
        matched_tenant_id: bestTenant?.id ?? null,
        matched_tenant_name: bestTenant ? `${bestTenant.first_name} ${bestTenant.last_name}` : null,
        matched_unit_id: bestTenant?.unit_id ?? null,
        matched_unit_label: bestTenant?.unit_label ?? null,
        matched_property_address: bestTenant?.property_address ?? null,
        assigned_month: assignedMonth,
        due_date: dueDate,
        is_early: isEarly,
        is_late: isLate,
        late_fee_applicable: lateFeeApplicable,
        late_fee_amount: lateFeeApplicable ? (bestTenant?.late_fee_amount ?? null) : null,
        confidence: bestScore >= 90 ? 'high' : bestScore >= 40 ? 'low' : 'none',
        note: isEarly
          ? `Paid early — assigned to ${assignedMonth}`
          : isLate
          ? `Paid late — late fee may apply`
          : '',
      };
    });

    return NextResponse.json({ preview, tenant_count: tenants.length });
  }

  // ── CONFIRM mode: save the approved rows ──
  const body = await req.json();
  const { rows } = body as { rows: ParsedTransaction[] };
  if (!rows?.length) return NextResponse.json({ error: 'No rows to save' }, { status: 400 });

  const saved: number[] = [];
  const batchId = `csv-${Date.now()}`;

  for (const row of rows) {
    if (!row.matched_unit_id || !row.due_date || !row.amount) continue;

    // Get expected amount from active lease
    const leaseRows = await query<{ rent_amount: number; id: number }>(
      `SELECT rent_amount, id FROM leases WHERE unit_id = $1 ORDER BY start_date DESC LIMIT 1`,
      [row.matched_unit_id]
    );
    const lease = leaseRows[0];
    const amountDue = lease?.rent_amount ?? row.amount;
    const isPartial = row.amount < amountDue;

    // Upsert — don't duplicate if already recorded for this unit/month
    const existing = await query<{ id: number }>(
      `SELECT id FROM rent_collections WHERE unit_id = $1 AND due_date = $2`,
      [row.matched_unit_id, row.due_date]
    );

    if (existing.length > 0) continue; // already recorded

    const result = await query<{ id: number }>(
      `INSERT INTO rent_collections
         (unit_id, lease_id, due_date, amount_due, paid_date, amount_paid,
          is_partial, is_late, late_fee_applicable, source, import_batch_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'csv_import',$10,$11)
       RETURNING id`,
      [
        row.matched_unit_id,
        lease?.id ?? null,
        row.due_date,
        amountDue,
        row.raw_date,
        row.amount,
        isPartial,
        row.is_late,
        row.late_fee_applicable,
        batchId,
        row.note || null,
      ]
    );
    if (result[0]) saved.push(result[0].id);
  }

  return NextResponse.json({ saved: saved.length, batch_id: batchId });
}
