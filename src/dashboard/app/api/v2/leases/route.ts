import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/leases?propertyId=1  OR  ?unitId=1
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  const unitId     = req.nextUrl.searchParams.get('unitId');

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (propertyId) { conditions.push(`p.id = $${idx++}`);    values.push(propertyId); }
  if (unitId)     { conditions.push(`l.unit_id = $${idx++}`); values.push(unitId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT l.*,
            (t.first_name || ' ' || t.last_name) AS tenant_name,
            u.unit_label,
            p.address AS property_address
     FROM leases l
     JOIN tenants t          ON t.id = l.tenant_id
     JOIN units u            ON u.id = l.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     ${where}
     ORDER BY l.start_date DESC`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  console.log('[leases POST] called at', new Date().toISOString());
  const body = await req.json();
  const {
    tenant_id, unit_id, start_date, end_date, rent_amount,
    security_deposit, late_fee_amount, late_fee_grace_days,
    utilities_landlord, utilities_tenant, equipment_included,
    extracted_by_ai, ai_confidence_notes,
  } = body;

  if (!tenant_id || !unit_id || !start_date || !end_date || !rent_amount) {
    return NextResponse.json(
      { error: 'tenant_id, unit_id, start_date, end_date, rent_amount are required' },
      { status: 400 }
    );
  }

  const rows = await query(
    `INSERT INTO leases
       (tenant_id, unit_id, start_date, end_date, rent_amount, security_deposit,
        late_fee_amount, late_fee_grace_days, utilities_landlord, utilities_tenant,
        equipment_included, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, unit_id, start_date) DO NOTHING
     RETURNING *`,
    [
      tenant_id, unit_id, start_date, end_date, rent_amount,
      security_deposit ?? null, late_fee_amount ?? null, late_fee_grace_days ?? null,
      utilities_landlord ? JSON.stringify(utilities_landlord) : null,
      utilities_tenant   ? JSON.stringify(utilities_tenant)   : null,
      equipment_included ? JSON.stringify(equipment_included) : null,
      extracted_by_ai ?? false, ai_confidence_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0] ?? { ok: true }, { status: 201 });
}
