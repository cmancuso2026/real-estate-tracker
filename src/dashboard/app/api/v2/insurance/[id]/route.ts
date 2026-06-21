import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const cols = [
    'carrier','policy_number','policy_type','effective_date','expiration_date',
    'renewal_period_days','annual_premium','deductible','coverage_limit','coverage_notes',
    'dwelling_coverage','other_structures_coverage','personal_property_coverage',
    'loss_of_use_coverage','liability_coverage','medical_payments_coverage',
    'hurricane_deductible','wind_hail_deductible','flood_coverage',
    'loss_of_rent_coverage','loss_of_rent_months',
  ];

  for (const col of cols) {
    if (body[col] !== undefined) {
      fields.push(`${col} = $${idx++}`);
      values.push(body[col]);
    }
  }

  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push(`updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`);
  values.push(id);

  const rows = await query(
    `UPDATE insurance_policies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM insurance_policies WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
