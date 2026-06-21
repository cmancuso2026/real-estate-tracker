import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const cols = [
    'statement_date','analysis_period_start','analysis_period_end',
    'projected_requirement','actual_disbursements','shortage_surplus_amount',
    'new_monthly_escrow','lender_name',
  ];

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const col of cols) {
    if (body[col] !== undefined) {
      fields.push(`${col} = $${idx++}`);
      values.push(body[col]);
    }
  }

  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  values.push(id);

  const rows = await query(
    `UPDATE escrow_statements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM escrow_statements WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
