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
            -- This month's rent (same rule as lib/rentMonth.js): due from the
            -- lease in force this month, else the largest amount_due recorded;
            -- paid = every payment this month (a split payment is several rows).
            due.amount AS amount_due,
            rc.paid AS amount_paid,
            rc.payments AS payment_count,
            COALESCE(rc.late, FALSE) AS is_late,
            (rc.payments > 0 AND COALESCE(rc.paid, 0) > 0 AND rc.paid < due.amount) AS is_partial,
            CASE
              WHEN rc.payments = 0 THEN 'no_record'
              WHEN COALESCE(rc.paid, 0) = 0 THEN 'outstanding'
              WHEN rc.paid >= due.amount THEN 'paid'
              ELSE 'partial'
            END AS payment_status
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
     -- This month's payments, all of them
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS payments, SUM(amount_paid)::int AS paid, MAX(amount_due)::int AS max_due, BOOL_OR(is_late) AS late
       FROM rent_collections
       WHERE unit_id = u.id
         AND due_date LIKE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') || '%'
     ) rc ON TRUE
     -- The lease in force this month (latest start), for the amount due
     LEFT JOIN LATERAL (
       SELECT rent_amount FROM leases
       WHERE unit_id = u.id
         AND start_date <= to_char((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month - 1 day'), 'YYYY-MM-DD')
         AND end_date   >= to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
       ORDER BY start_date DESC
       LIMIT 1
     ) month_lease ON TRUE
     LEFT JOIN LATERAL (SELECT COALESCE(month_lease.rent_amount, rc.max_due) AS amount) due ON TRUE
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
