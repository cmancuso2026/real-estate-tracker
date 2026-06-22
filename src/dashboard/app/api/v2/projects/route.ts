import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT w.id,
            COALESCE(w.project_name, w.description, 'Untitled Project') AS project_name,
            w.property_id,
            w.status,
            w.is_recurring,
            w.created_at,
            w.updated_at,
            (
              SELECT COALESCE(
                json_agg(json_build_object('unit_id', pu.unit_id, 'unit_label', u.unit_label, 'cost_share', pu.cost_share))
                  FILTER (WHERE pu.id IS NOT NULL),
                '[]'
              )
              FROM project_units pu
              JOIN units u ON u.id = pu.unit_id
              WHERE pu.project_id = w.id
            ) AS units,
            (
              SELECT COUNT(*)::int FROM project_quotes pq WHERE pq.project_id = w.id
            ) AS quote_count,
            sel.vendor_name AS selected_vendor_name,
            sel.selected_cost AS selected_cost
     FROM work_orders w
     LEFT JOIN LATERAL (
       SELECT v.name AS vendor_name,
              COALESCE(pq.final_cost, pq.quoted_cost) AS selected_cost
       FROM project_quotes pq
       LEFT JOIN vendors v ON v.id = pq.vendor_id
       WHERE pq.project_id = w.id AND pq.is_selected = TRUE
       LIMIT 1
     ) sel ON TRUE
     WHERE w.property_id = $1
     ORDER BY w.updated_at DESC NULLS LAST, w.created_at DESC`,
    [propertyId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { project_name, property_id, status, is_recurring } = body;

  if (!project_name || !property_id || !status) {
    return NextResponse.json({ error: 'project_name, property_id and status are required' }, { status: 400 });
  }
  if (!['received', 'open', 'completed'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const rows = await query(
    `INSERT INTO work_orders
       (project_name, property_id, status, is_recurring, description, date_received, source)
     VALUES ($1,$2,$3,$4,$1,$5,'manual')
     RETURNING *`,
    [project_name, property_id, status, is_recurring ?? false, today]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
