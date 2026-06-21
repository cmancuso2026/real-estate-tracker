/**
 * POST /api/v2/rent/import
 * BofA CSV parser — handles the specific BofA format:
 *   Rows 1-5: summary block (skip)
 *   Row 7: actual headers (Date, Description, Amount, Running Bal.)
 *   Row 8+: transactions
 *
 * Preview mode: POST multipart/form-data with file
 * Confirm mode: POST JSON with { rows: [...] }
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
  late_fee_grace_days: number | null;
  late_fee_amount: number | null;
  lease_id: number | null;
}

export interface ParsedRow {
  raw_date: string;
  description: string;
  amount: number;
  // Matching
  matched_tenant_id: number | null;
  matched_tenant_name: string | null;
  matched_unit_id: number | null;
  matched_unit_label: string | null;
  matched_property_address: string | null;
  matched_lease_id: number | null;
  // Assignment
  assigned_month: string;   // YYYY-MM
  due_date: string;         // YYYY-MM-01
  // Flags
  is_early: boolean;
  is_late: boolean;
  late_fee_applicable: boolean;
  late_fee_included: boolean;
  late_fee_amount: number | null;
  confidence: 'high' | 'low' | 'none';
  category: 'rent' | 'non_rent';
  note: string;
}

// ---------------------------------------------------------------------------
// CSV parsing — handles BofA's specific multi-block format
// ---------------------------------------------------------------------------
function parseBofaCsv(text: string): Array<{ date: string; description: string; amount: number }> {
  const lines = text.trim().split(/\r?\n/);

  // Find the real header row — look for a row containing "Date" AND "Amount"
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const low = (lines[i] ?? '').toLowerCase();
    if (low.includes('date') && low.includes('amount') && low.includes('description')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  // Parse the header to find column positions
  const headers = splitCsvLine(lines[headerIdx] ?? '').map(h => h.toLowerCase().trim());
  const dateIdx = headers.findIndex(h => h === 'date');
  const descIdx = headers.findIndex(h => h.includes('description'));
  const amtIdx  = headers.findIndex(h => h === 'amount');

  if (dateIdx === -1 || amtIdx === -1) return [];

  const results: Array<{ date: string; description: string; amount: number }> = [];

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);

    const rawAmt = (cols[amtIdx] ?? '').replace(/[$,\s]/g, '');
    const amount = parseFloat(rawAmt);

    // Only include positive amounts (credits = money coming IN)
    if (isNaN(amount) || amount <= 0) continue;

    const date = (cols[dateIdx] ?? '').trim();
    const desc = (cols[descIdx] ?? '').trim();
    if (!date || !desc) continue;

    results.push({ date, description: desc, amount });
  }

  return results;
}

/** Properly split a CSV line respecting quoted fields */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

// ---------------------------------------------------------------------------
// Name extraction from BofA Zelle description
// "Zelle payment from SAMUEL PEREZ MARTINEZ Conf# xe14ougde"
// ---------------------------------------------------------------------------
function extractZelleName(description: string): string | null {
  // Match "from NAME Conf#" or "from NAME" patterns
  const match = description.match(/zelle\s+payment\s+from\s+(.+?)(?:\s+conf#|\s+confirmation|\s*$)/i);
  if (match?.[1]) return match[1].trim();
  // Fallback: "from NAME"
  const match2 = description.match(/from\s+([A-Z][A-Z\s]+?)(?:\s+Conf#|\s*$)/i);
  if (match2?.[1]) return match2[1].trim();
  return null;
}

function isZelle(description: string): boolean {
  return /zelle/i.test(description);
}

// ---------------------------------------------------------------------------
// Tenant name matching
// ---------------------------------------------------------------------------
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchScore(extractedName: string | null, tenant: TenantRow): number {
  if (!extractedName) return 0;
  const name = normalizeName(extractedName);
  const full  = normalizeName(`${tenant.first_name} ${tenant.last_name}`);
  const last  = normalizeName(tenant.last_name);
  const first = normalizeName(tenant.first_name);

  if (name === full) return 100;
  if (name.includes(full) || full.includes(name)) return 95;
  // Check all words of extracted name against tenant name words
  const nameWords = name.split(' ');
  const fullWords = full.split(' ');
  const overlap = nameWords.filter(w => w.length > 2 && fullWords.includes(w)).length;
  if (overlap >= 2) return 85;
  if (name.includes(last) && last.length > 2) return 70;
  if (overlap === 1 && first.length > 3 && name.includes(first)) return 50;
  return 0;
}

// ---------------------------------------------------------------------------
// Month assignment — if paid in last 5 days of month, assign to next month
// ---------------------------------------------------------------------------
function assignMonth(rawDate: string): { assignedMonth: string; dueDate: string; isEarly: boolean } {
  // Parse MM/DD/YYYY
  let d: Date;
  if (rawDate.includes('/')) {
    const parts = rawDate.split('/');
    d = new Date(`${parts[2]}-${parts[0]?.padStart(2,'0')}-${parts[1]?.padStart(2,'0')}`);
  } else {
    d = new Date(rawDate);
  }
  if (isNaN(d.getTime())) return { assignedMonth: '', dueDate: '', isEarly: false };

  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isEarly = day >= daysInMonth - 4; // last 5 days

  let am = month + 1;
  let ay = year;
  if (isEarly) { am++; if (am > 12) { am = 1; ay++; } }

  const assignedMonth = `${ay}-${String(am).padStart(2,'0')}`;
  return { assignedMonth, dueDate: `${assignedMonth}-01`, isEarly };
}

// ---------------------------------------------------------------------------
// Late detection
// ---------------------------------------------------------------------------
function checkLate(rawDate: string, dueDate: string, graceDays: number): boolean {
  if (!rawDate || !dueDate) return false;
  let paid: Date;
  if (rawDate.includes('/')) {
    const p = rawDate.split('/');
    paid = new Date(`${p[2]}-${p[0]?.padStart(2,'0')}-${p[1]?.padStart(2,'0')}`);
  } else {
    paid = new Date(rawDate);
  }
  const due = new Date(dueDate);
  return Math.ceil((paid.getTime() - due.getTime()) / 86400000) > graceDays;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  // ── PREVIEW ──
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try { formData = await req.formData(); }
    catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }); }

    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const csvText = await file.text();
    const transactions = parseBofaCsv(csvText);

    if (!transactions.length) {
      return NextResponse.json({ error: 'No credit transactions found. Make sure this is a BofA CSV export.' }, { status: 400 });
    }

    // Load all active tenants
    const tenants = await query<TenantRow>(`
      SELECT t.id, t.first_name, t.last_name, t.unit_id,
             u.unit_label, u.property_id, p.address AS property_address,
             l.rent_amount, l.late_fee_grace_days, l.late_fee_amount, l.id AS lease_id
      FROM tenants t
      JOIN units u ON u.id = t.unit_id
      JOIN owned_properties p ON p.id = u.property_id
      LEFT JOIN LATERAL (
        SELECT * FROM leases WHERE unit_id = t.unit_id ORDER BY start_date DESC LIMIT 1
      ) l ON TRUE
      WHERE t.is_active = TRUE
    `);

    const preview: ParsedRow[] = transactions.map(tx => {
      const zellePayment = isZelle(tx.description);
      const extractedName = extractZelleName(tx.description);

      // Non-Zelle = non_rent immediately
      if (!zellePayment) {
        const { assignedMonth, dueDate, isEarly } = assignMonth(tx.date);
        return {
          raw_date: tx.date, description: tx.description, amount: tx.amount,
          matched_tenant_id: null, matched_tenant_name: null,
          matched_unit_id: null, matched_unit_label: null,
          matched_property_address: null, matched_lease_id: null,
          assigned_month: assignedMonth, due_date: dueDate,
          is_early: isEarly, is_late: false,
          late_fee_applicable: false, late_fee_included: false, late_fee_amount: null,
          confidence: 'none', category: 'non_rent',
          note: 'Not a Zelle payment',
        };
      }

      // Try to match to a tenant
      let bestTenant: TenantRow | null = null;
      let bestScore = 0;
      for (const t of tenants) {
        const score = matchScore(extractedName, t);
        if (score > bestScore) { bestScore = score; bestTenant = t; }
      }

      // No name found in description = non_rent
      if (!extractedName) {
        const { assignedMonth, dueDate, isEarly } = assignMonth(tx.date);
        return {
          raw_date: tx.date, description: tx.description, amount: tx.amount,
          matched_tenant_id: null, matched_tenant_name: null,
          matched_unit_id: null, matched_unit_label: null,
          matched_property_address: null, matched_lease_id: null,
          assigned_month: assignedMonth, due_date: dueDate,
          is_early: isEarly, is_late: false,
          late_fee_applicable: false, late_fee_included: false, late_fee_amount: null,
          confidence: 'none', category: 'non_rent',
          note: 'Zelle — no name found',
        };
      }

      // Score < 50 = no match = non_rent (don't hallucinate)
      if (bestScore < 50 || !bestTenant) {
        const { assignedMonth, dueDate, isEarly } = assignMonth(tx.date);
        return {
          raw_date: tx.date, description: tx.description, amount: tx.amount,
          matched_tenant_id: null, matched_tenant_name: extractedName,
          matched_unit_id: null, matched_unit_label: null,
          matched_property_address: null, matched_lease_id: null,
          assigned_month: assignedMonth, due_date: dueDate,
          is_early: isEarly, is_late: false,
          late_fee_applicable: false, late_fee_included: false, late_fee_amount: null,
          confidence: 'none', category: 'non_rent',
          note: `Zelle from "${extractedName}" — no tenant match found`,
        };
      }

      const { assignedMonth, dueDate, isEarly } = assignMonth(tx.date);
      const graceDays = bestTenant.late_fee_grace_days ?? 5;
      const isLate = !isEarly && checkLate(tx.date, dueDate, graceDays);
      const rentAmount = bestTenant.rent_amount ?? 0;
      const lateFeeAmt = bestTenant.late_fee_amount ?? 0;

      // Detect if late fee was already included in the payment
      // Condition: late payment AND amount ≈ rent + late fee (within $5 tolerance)
      const lateFeePaidInPayment = isLate &&
        lateFeeAmt > 0 &&
        Math.abs(tx.amount - (rentAmount + lateFeeAmt)) <= 5;

      // Late fee applicable but NOT paid = fee was owed but not collected
      const lateFeeApplicable = isLate && !lateFeePaidInPayment;

      const confidence: 'high' | 'low' = bestScore >= 85 ? 'high' : 'low';

      const noteArr: string[] = [];
      if (isEarly) noteArr.push(`Paid early — assigned to ${assignedMonth}`);
      if (isLate && lateFeePaidInPayment) noteArr.push(`Late fee of $${lateFeeAmt} included in payment`);
      else if (isLate) noteArr.push(`Paid late — grace period ${graceDays} days`);

      return {
        raw_date: tx.date,
        description: tx.description,
        amount: tx.amount,
        matched_tenant_id: bestTenant.id,
        matched_tenant_name: `${bestTenant.first_name} ${bestTenant.last_name}`,
        matched_unit_id: bestTenant.unit_id,
        matched_unit_label: bestTenant.unit_label,
        matched_property_address: bestTenant.property_address,
        matched_lease_id: bestTenant.lease_id,
        assigned_month: assignedMonth,
        due_date: dueDate,
        is_early: isEarly,
        is_late: isLate,
        late_fee_applicable: lateFeeApplicable,
        late_fee_included: lateFeePaidInPayment,
        late_fee_amount: lateFeeAmt > 0 ? lateFeeAmt : null,
        confidence,
        category: 'rent',
        note: noteArr.join(' · '),
      };
    });

    return NextResponse.json({
      preview,
      tenants: tenants.map(t => ({ id: t.id, name: `${t.first_name} ${t.last_name}`, unit_label: t.unit_label })),
    });
  }

  // ── CONFIRM ──
  const body = await req.json();
  const { rows } = body as { rows: ParsedRow[] };
  if (!rows?.length) return NextResponse.json({ error: 'No rows to save' }, { status: 400 });

  const saved: number[] = [];
  const batchId = `csv-${Date.now()}`;

  for (const row of rows) {
    if (row.category !== 'rent' || !row.matched_unit_id || !row.due_date) continue;

    // Skip if already recorded for this unit+month
    const existing = await query<{ id: number }>(
      `SELECT id FROM rent_collections WHERE unit_id = $1 AND due_date = $2`,
      [row.matched_unit_id, row.due_date]
    );
    if (existing.length > 0) continue;

    const leaseRows = await query<{ rent_amount: number; id: number }>(
      `SELECT rent_amount, id FROM leases WHERE unit_id = $1 ORDER BY start_date DESC LIMIT 1`,
      [row.matched_unit_id]
    );
    const lease = leaseRows[0];
    const amountDue = lease?.rent_amount ?? row.amount;
    const isPartial = row.amount < amountDue;

    const result = await query<{ id: number }>(
      `INSERT INTO rent_collections
         (unit_id, lease_id, due_date, amount_due, paid_date, amount_paid,
          is_partial, is_late, late_fee_applicable, source, import_batch_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'csv_import',$10,$11)
       RETURNING id`,
      [
        row.matched_unit_id, lease?.id ?? null, row.due_date,
        amountDue, row.raw_date, row.amount,
        isPartial, row.is_late, row.late_fee_applicable,
        batchId, row.note || null,
      ]
    );
    if (result[0]) saved.push(result[0].id);
  }

  return NextResponse.json({ saved: saved.length, batch_id: batchId });
}
