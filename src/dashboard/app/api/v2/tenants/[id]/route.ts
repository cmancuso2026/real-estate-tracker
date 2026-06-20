import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { first_name, last_name, email, phone, notes, is_active } = body;

  const rows = await query(
    `UPDATE tenants SET
       first_name = COALESCE($1, first_name),
       last_name  = COALESCE($2, last_name),
       email      = $3,
       phone      = $4,
       notes      = $5,
       is_active  = COALESCE($6, is_active)
     WHERE id = $7
     RETURNING *`,
    [first_name ?? null, last_name ?? null, email ?? null, phone ?? null, notes ?? null, is_active ?? null, id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Delete tenant and cascade to leases (FK ON DELETE CASCADE)
  await query(`DELETE FROM tenants WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
