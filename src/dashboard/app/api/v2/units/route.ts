import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT u.*,
            t.id          AS tenant_id,
            t.first_name || ' ' || t.last_name AS tenant_name,
            l.rent_amount,
            l.start_date  AS lease_start_date,
            l.end_date    AS lease_end_date,
            -- Earliest lease for the CURRENT tenant on this unit (years in unit)
            first_t_lease.start_date AS first_lease_start_date,
            rc.amount_due,
            rc.amount_paid,
            rc.is_late
     FROM units u
     -- Most recent active tenant
     LEFT JOIN LATERAL (
       SELECT * FROM tenants
       WHERE unit_id = u.id AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1
     ) t ON TRUE
     -- Most recent lease
     LEFT JOIN LATERAL (
       SELECT * FROM leases
       WHERE unit_id = u.id
       ORDER BY start_date DESC
       LIMIT 1
     ) l ON TRUE
     -- Earliest lease for the current tenant specifically
     LEFT JOIN LATERAL (
       SELECT * FROM leases
       WHERE unit_id = u.id AND tenant_id = t.id
       ORDER BY start_date ASC
       LIMIT 1
     ) first_t_lease ON TRUE
     -- This month's rent
     LEFT JOIN LATERAL (
       SELECT * FROM rent_collections
       WHERE unit_id = u.id
         AND due_date LIKE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') || '%'
       LIMIT 1
     ) rc ON TRUE
     WHERE u.property_id = $1
     ORDER BY u.unit_label`,
    [propertyId]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { property_id, unit_label, bedrooms, bathrooms, sqft, notes, is_owner_unit } = body;

  if (!property_id || !unit_label) {
    return NextResponse.json({ error: 'property_id and unit_label are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO units (property_id, unit_label, bedrooms, bathrooms, sqft, notes, is_owner_unit)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (property_id, unit_label) DO UPDATE
       SET bedrooms=$3, bathrooms=$4, sqft=$5, notes=$6, is_owner_unit=$7
     RETURNING *`,
    [property_id, unit_label, bedrooms ?? null, bathrooms ?? null, sqft ?? null, notes ?? null, is_owner_unit ?? false]
  );
  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { unit_id, is_owner_unit } = body;

  if (!unit_id) return NextResponse.json({ error: 'unit_id required' }, { status: 400 });

  const rows = await query(
    `UPDATE units SET is_owner_unit = $1 WHERE id = $2 RETURNING *`,
    [is_owner_unit ?? false, unit_id]
  );
  return NextResponse.json(rows[0]);
}
