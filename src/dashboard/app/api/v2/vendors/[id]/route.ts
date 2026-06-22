import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/vendors/[id] — vendor record plus its project quotes (for the expandable row).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorRows = await query(`SELECT * FROM vendors WHERE id = $1`, [id]);
  if (!vendorRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let quotes: unknown[] = [];
  try {
    quotes = await query(
      `SELECT pq.id, pq.work_order_id, pq.quoted_cost, pq.final_cost,
              pq.is_selected, pq.notes,
              wo.project_name, wo.description, wo.status,
              p.address AS property_address
       FROM project_quotes pq
       JOIN work_orders wo ON wo.id = pq.work_order_id
       LEFT JOIN owned_properties p ON p.id = wo.property_id
       WHERE pq.vendor_id = $1
       ORDER BY pq.is_selected DESC, pq.created_at DESC`,
      [id]
    );
  } catch (err) {
    console.error('Vendor quotes query failed, returning empty list:', err);
  }

  return NextResponse.json({ ...vendorRows[0], quotes });
}

// PATCH /api/v2/vendors/[id] — update editable vendor fields.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, trade, phone, email, manual_notes, manual_rating, is_active } = body;

  const rows = await query(
    `UPDATE vendors SET
       name          = COALESCE($1, name),
       trade         = COALESCE($2, trade),
       phone         = COALESCE($3, phone),
       email         = COALESCE($4, email),
       manual_notes  = COALESCE($5, manual_notes),
       manual_rating = COALESCE($6, manual_rating),
       is_active     = COALESCE($7, is_active)
     WHERE id = $8
     RETURNING *`,
    [
      name ?? null, trade ?? null, phone ?? null, email ?? null,
      manual_notes ?? null, manual_rating ?? null, is_active ?? null, id,
    ]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

// DELETE /api/v2/vendors/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(`DELETE FROM vendors WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
