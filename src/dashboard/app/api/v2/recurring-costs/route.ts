import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { recurringFields } from '@/lib/recurring';

export const dynamic = 'force-dynamic';

// GET /api/v2/recurring-costs?propertyId=1 (or ?workOrderId=5)
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  const workOrderId = req.nextUrl.searchParams.get('workOrderId');
  if (!propertyId && !workOrderId) {
    return NextResponse.json({ error: 'propertyId or workOrderId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT rc.*, v.name AS vendor_name
     FROM recurring_costs rc
     LEFT JOIN vendors v ON v.id = rc.vendor_id
     WHERE ${propertyId ? 'rc.property_id = $1' : 'rc.work_order_id = $1'}
     ORDER BY rc.is_active DESC, rc.created_at DESC`,
    [propertyId ?? workOrderId],
  );
  return NextResponse.json(rows);
}

// POST /api/v2/recurring-costs — { property_id, description, frequency:
// 'monthly' | 'yearly', amount, start_date?, end_date?, vendor_id?,
// work_order_id? }. Older callers may send monthly_amount instead of amount.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { property_id, vendor_id, description, is_active, work_order_id } = body;

  if (!property_id || !description) {
    return NextResponse.json({ error: 'property_id and description are required' }, { status: 400 });
  }
  let f;
  try {
    f = recurringFields(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO recurring_costs
       (property_id, vendor_id, description, monthly_amount, is_active, frequency, amount, start_date, end_date, work_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [property_id, vendor_id ?? null, description, f.monthly_amount, is_active ?? true, f.frequency, f.amount, f.start_date, f.end_date, work_order_id ?? null],
  );
  return NextResponse.json(rows[0], { status: 201 });
}
