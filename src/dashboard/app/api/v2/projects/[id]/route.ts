import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const rows = await query(
    `UPDATE work_orders
        SET project_name = COALESCE($1, project_name),
            status       = COALESCE($2, status),
            is_recurring = COALESCE($3, is_recurring),
            updated_at   = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
      WHERE id = $4
      RETURNING *`,
    [body.project_name ?? null, body.status ?? null, body.is_recurring ?? null, id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM work_orders WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
