import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const body = await req.json();
  const { quoted_cost, final_cost, is_selected, notes } = body;

  if (is_selected === true) {
    await query(
      `UPDATE project_quotes SET is_selected = FALSE WHERE project_id = $1 AND id <> $2`,
      [id, qid]
    );
  }

  const rows = await query(
    `UPDATE project_quotes
        SET quoted_cost = COALESCE($1, quoted_cost),
            final_cost  = COALESCE($2, final_cost),
            notes       = COALESCE($3, notes),
            is_selected = COALESCE($4, is_selected)
      WHERE id = $5 AND project_id = $6
      RETURNING *`,
    [quoted_cost ?? null, final_cost ?? null, notes ?? null, is_selected ?? null, qid, id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  await query(`DELETE FROM project_quotes WHERE id = $1 AND project_id = $2`, [qid, id]);
  return NextResponse.json({ ok: true });
}
