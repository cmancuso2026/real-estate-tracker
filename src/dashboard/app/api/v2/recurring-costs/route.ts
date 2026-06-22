import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT rc.*, v.name AS vendor_name
     FROM recurring_costs rc
     LEFT JOIN vendors v ON v.id = rc.vendor_id
     WHERE rc.property_id = $1
     ORDER BY rc.is_active DESC, rc.created_at DESC`,
    [propertyId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { property_id, vendor_id, description, monthly_amount, is_active } = body;

  if (!property_id || !description || monthly_amount == null) {
    return NextResponse.json({ error: 'property_id, description and monthly_amount are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO recurring_costs (property_id, vendor_id, description, monthly_amount, is_active)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [property_id, vendor_id ?? null, description, monthly_amount, is_active ?? true]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
