import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { description, monthly_amount, vendor_id, is_active } = body;

  const rows = await query(
    `UPDATE recurring_costs
        SET description    = COALESCE($1, description),
            monthly_amount = COALESCE($2, monthly_amount),
            vendor_id      = COALESCE($3, vendor_id),
            is_active      = COALESCE($4, is_active)
      WHERE id = $5
      RETURNING *`,
    [description ?? null, monthly_amount ?? null, vendor_id ?? null, is_active ?? null, id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM recurring_costs WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
