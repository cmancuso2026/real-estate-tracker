import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { paid_date, amount_paid, amount_due, is_late, is_partial, late_fee_charged, late_fee_paid, notes } = body;

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (paid_date !== undefined)      { fields.push(`paid_date = $${idx++}`);      values.push(paid_date); }
  if (amount_paid !== undefined)    { fields.push(`amount_paid = $${idx++}`);    values.push(amount_paid); }
  if (amount_due !== undefined)     { fields.push(`amount_due = $${idx++}`);     values.push(amount_due); }
  if (is_late !== undefined)        { fields.push(`is_late = $${idx++}`);        values.push(is_late); }
  if (is_partial !== undefined)     { fields.push(`is_partial = $${idx++}`);     values.push(is_partial); }
  if (late_fee_charged !== undefined) { fields.push(`late_fee_charged = $${idx++}`); values.push(late_fee_charged); }
  if (late_fee_paid !== undefined)  { fields.push(`late_fee_paid = $${idx++}`); values.push(late_fee_paid); }
  if (notes !== undefined)          { fields.push(`notes = $${idx++}`);          values.push(notes); }

  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  values.push(id);
  const rows = await query(
    `UPDATE rent_collections SET ${fields.join(', ')},
       updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
     WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM rent_collections WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
