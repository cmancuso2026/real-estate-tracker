import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

// GET /api/v2/rent?unitId=1&month=2025-06&propertyId=1
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const unitId     = p.get('unitId');
  const month      = p.get('month');
  const propertyId = p.get('propertyId');

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (unitId)     { conditions.push(`rc.unit_id = $${idx++}`);   values.push(unitId); }
  if (month)      { conditions.push(`rc.due_date LIKE $${idx++}`); values.push(month + '%'); }
  if (propertyId) { conditions.push(`p.id = $${idx++}`);          values.push(propertyId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT rc.*,
            u.unit_label,
            p.address AS property_address,
            (t.first_name || ' ' || t.last_name) AS tenant_name
     FROM rent_collections rc
     JOIN units u            ON u.id = rc.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     LEFT JOIN tenants t     ON t.unit_id = rc.unit_id AND t.is_active = TRUE
     ${where}
     ORDER BY rc.due_date DESC`,
    values
  );
  return NextResponse.json(rows);
}

// POST /api/v2/rent — manual entry
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { unit_id, lease_id, due_date, amount_due, paid_date, amount_paid, notes, late_fee_charged, late_fee_paid } = body;

  if (!unit_id || !due_date || !amount_due) {
    return NextResponse.json({ error: 'unit_id, due_date, amount_due are required' }, { status: 400 });
  }

  const is_partial = amount_paid != null && amount_paid < amount_due;
  const is_late    = body.is_late ?? false;

  const rows = await query(
    `INSERT INTO rent_collections
       (unit_id, lease_id, due_date, amount_due, paid_date, amount_paid,
        is_partial, is_late, late_fee_charged, late_fee_paid, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11)
     RETURNING *`,
    [
      unit_id, lease_id ?? null, due_date, amount_due,
      paid_date ?? null, amount_paid ?? null,
      is_partial, is_late,
      late_fee_charged ?? null, late_fee_paid ?? null,
      notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}

// PUT /api/v2/rent — BofA CSV import
export async function PUT(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const csvText = await file.text();
  const batchId = randomUUID();
  const lines = csvText.trim().split('\n');
  const headerIdx = lines.findIndex(l =>
    l.toLowerCase().includes('date') && l.toLowerCase().includes('amount')
  );
  if (headerIdx === -1) {
    return NextResponse.json({ error: 'Could not find CSV header row' }, { status: 400 });
  }

  const headers = lines[headerIdx].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const dateIdx  = headers.findIndex(h => h === 'date');
  const descIdx  = headers.findIndex(h => h.includes('description'));
  const amtIdx   = headers.findIndex(h => h === 'amount');

  const creditRows: Array<{ date: string; description: string; amount: number }> = [];

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    const amount = parseFloat(cols[amtIdx] ?? '0');
    if (isNaN(amount) || amount <= 0) continue;
    creditRows.push({
      date: cols[dateIdx] ?? '',
      description: cols[descIdx] ?? '',
      amount,
    });
  }

  return NextResponse.json({
    batch_id: batchId,
    rows: creditRows,
    count: creditRows.length,
    message: 'Review and match these transactions to units, then POST to /api/v2/rent to record payments.',
  });
}
