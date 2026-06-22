import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/work-orders/[id] — the project plus EVERY vendor's quote on it.
// Used by the Vendors page to show competing bids when a project row is opened.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await query(
    `SELECT wo.*, p.address AS property_address
     FROM work_orders wo
     LEFT JOIN owned_properties p ON p.id = wo.property_id
     WHERE wo.id = $1`,
    [id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let quotes: unknown[] = [];
  try {
    quotes = await query(
      `SELECT pq.id, pq.vendor_id, pq.quoted_cost, pq.final_cost,
              pq.is_selected, pq.status, pq.notes,
              v.name  AS vendor_name,
              v.trade AS vendor_trade
       FROM project_quotes pq
       JOIN vendors v ON v.id = pq.vendor_id
       WHERE pq.work_order_id = $1
       ORDER BY pq.is_selected DESC, pq.created_at`,
      [id]
    );
  } catch (err) {
    console.error('Project quotes query failed, returning empty list:', err);
  }

  return NextResponse.json({ ...rows[0], quotes });
}

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
