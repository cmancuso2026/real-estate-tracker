import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/units?propertyId=1
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT u.*,
            t.first_name || ' ' || t.last_name AS tenant_name,
            t.id AS tenant_id,
            l.rent_amount,
            l.end_date AS lease_end_date
     FROM units u
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.is_active = TRUE
     LEFT JOIN leases l  ON l.unit_id = u.id
       AND l.start_date <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       AND l.end_date   >= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
     WHERE u.property_id = $1
     ORDER BY u.unit_label`,
    [propertyId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { property_id, unit_label, bedrooms, bathrooms, sqft, notes } = body;

  if (!property_id || !unit_label) {
    return NextResponse.json({ error: 'property_id and unit_label are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO units (property_id, unit_label, bedrooms, bathrooms, sqft, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (property_id, unit_label) DO UPDATE SET bedrooms=$3, bathrooms=$4, sqft=$5, notes=$6
     RETURNING *`,
    [property_id, unit_label, bedrooms ?? null, bathrooms ?? null, sqft ?? null, notes ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
