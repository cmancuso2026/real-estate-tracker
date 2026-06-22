import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/work-orders?propertyId=1&status=open&vendorId=3
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.get('propertyId')) { conditions.push(`wo.property_id = $${idx++}`); values.push(params.get('propertyId')); }
  if (params.get('status'))     { conditions.push(`wo.status = $${idx++}`);       values.push(params.get('status')); }
  if (params.get('vendorId'))   { conditions.push(`wo.vendor_id = $${idx++}`);    values.push(params.get('vendorId')); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT wo.*,
            v.name  AS vendor_name,
            v.trade AS vendor_trade,
            v.phone AS vendor_phone,
            p.address AS property_address,
            u.unit_label,
            COALESCE((
              SELECT json_agg(json_build_object('unit_id', pu.unit_id, 'unit_label', uu.unit_label, 'cost_share', pu.cost_share))
              FROM project_units pu JOIN units uu ON uu.id = pu.unit_id
              WHERE pu.work_order_id = wo.id
            ), '[]') AS units,
            COALESCE((
              SELECT json_agg(json_build_object('id', pq.id, 'vendor_id', pq.vendor_id, 'vendor_name', vv.name, 'vendor_trade', vv.trade, 'quoted_cost', pq.quoted_cost, 'final_cost', pq.final_cost, 'is_selected', pq.is_selected, 'notes', pq.notes) ORDER BY pq.is_selected DESC, pq.created_at)
              FROM project_quotes pq JOIN vendors vv ON vv.id = pq.vendor_id
              WHERE pq.work_order_id = wo.id
            ), '[]') AS quotes
     FROM work_orders wo
     LEFT JOIN vendors v          ON v.id = wo.vendor_id
     JOIN owned_properties p ON p.id = wo.property_id
     LEFT JOIN units u       ON u.id = wo.unit_id
     ${where}
     ORDER BY wo.created_at DESC NULLS LAST, wo.id DESC`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    property_id, unit_id, vendor_id, category, description,
    status, date_received, quoted_cost, actual_cost,
    rating, review_notes, source, attachment_url,
    project_name, is_recurring,
  } = body;

  if (!property_id) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const rows = await query(
    `INSERT INTO work_orders
       (property_id, unit_id, vendor_id, category, description, status, date_received,
        quoted_cost, actual_cost, rating, review_notes, source, attachment_url, project_name, is_recurring)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      property_id, unit_id ?? null, vendor_id ?? null, category ?? null, description ?? null,
      status ?? 'received', date_received ?? today,
      quoted_cost ?? null, actual_cost ?? null,
      rating ?? null, review_notes ?? null,
      source ?? 'manual', attachment_url ?? null,
      project_name ?? null, is_recurring ?? false,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
