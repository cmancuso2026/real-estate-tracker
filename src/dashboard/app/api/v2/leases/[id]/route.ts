import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const {
    start_date, end_date, rent_amount, security_deposit,
    late_fee_amount, late_fee_grace_days,
    utilities_landlord, utilities_tenant, equipment_included,
  } = body;

  const rows = await query(
    `UPDATE leases SET
       start_date          = COALESCE($1, start_date),
       end_date            = COALESCE($2, end_date),
       rent_amount         = COALESCE($3, rent_amount),
       security_deposit    = $4,
       late_fee_amount     = $5,
       late_fee_grace_days = $6,
       utilities_landlord  = $7,
       utilities_tenant    = $8,
       equipment_included  = $9,
       updated_at          = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
     WHERE id = $10
     RETURNING *`,
    [
      start_date ?? null, end_date ?? null, rent_amount ?? null,
      security_deposit ?? null, late_fee_amount ?? null, late_fee_grace_days ?? null,
      utilities_landlord ? JSON.stringify(utilities_landlord) : null,
      utilities_tenant   ? JSON.stringify(utilities_tenant)   : null,
      equipment_included ? JSON.stringify(equipment_included) : null,
      id,
    ]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM leases WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
