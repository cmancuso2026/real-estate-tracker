import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { final_cost, is_selected, notes, status, quoted_cost } = body;

  if (is_selected === true) {
    await query(
      `UPDATE project_quotes SET is_selected = FALSE
       WHERE work_order_id = (SELECT work_order_id FROM project_quotes WHERE id = $1)`,
      [id]
    );
  }

  const rows = await query(
    `UPDATE project_quotes SET
       final_cost  = COALESCE($1, final_cost),
       notes       = COALESCE($2, notes),
       is_selected = COALESCE($3, is_selected),
       status      = COALESCE($4, status),
       quoted_cost = COALESCE($5, quoted_cost)
     WHERE id = $6
     RETURNING *`,
    [final_cost ?? null, notes ?? null, is_selected ?? null, status ?? null, quoted_cost ?? null, id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM project_quotes WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
