import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/v2/work-orders/[id] — update project/work-order fields.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const {
    project_name, status, is_recurring,
    category, description, unit_id, vendor_id,
    quoted_cost, actual_cost, rating, review_notes, date_completed,
  } = body;

  const rows = await query(
    `UPDATE work_orders SET
       project_name   = COALESCE($1, project_name),
       status         = COALESCE($2, status),
       is_recurring   = COALESCE($3, is_recurring),
       category       = COALESCE($4, category),
       description    = COALESCE($5, description),
       unit_id        = COALESCE($6, unit_id),
       vendor_id      = COALESCE($7, vendor_id),
       quoted_cost    = COALESCE($8, quoted_cost),
       actual_cost    = COALESCE($9, actual_cost),
       rating         = COALESCE($10, rating),
       review_notes   = COALESCE($11, review_notes),
       date_completed = COALESCE($12, date_completed),
       updated_at     = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $13
     RETURNING *`,
    [
      project_name ?? null, status ?? null, is_recurring ?? null,
      category ?? null, description ?? null, unit_id ?? null, vendor_id ?? null,
      quoted_cost ?? null, actual_cost ?? null, rating ?? null, review_notes ?? null,
      date_completed ?? null, id,
    ]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

// DELETE /api/v2/work-orders/[id] — deletes the work order and cascades quotes/units.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM work_orders WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
