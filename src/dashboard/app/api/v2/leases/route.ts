import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/leases?unitId=1
export async function GET(req: NextRequest) {
  const unitId = req.nextUrl.searchParams.get('unitId');
  if (!unitId) {
    return NextResponse.json({ error: 'unitId query param required' }, { status: 400 });
  }

  const rows = await query(
    `SELECT l.*,
            t.first_name || ' ' || t.last_name AS tenant_name,
            u.unit_label,
            p.address AS property_address
     FROM leases l
     JOIN tenants t          ON t.id = l.tenant_id
     JOIN units u            ON u.id = l.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     WHERE l.unit_id = $1
     ORDER BY l.start_date DESC`,
    [unitId]
  );
  return NextResponse.json(rows);
}

// POST /api/v2/leases — create a lease (manually entered or from AI extraction)
export async function POST(req: NextRequest) {
  console.log('[leases POST] called at', new Date().toISOString());
  const body = await req.json();
  const {
    tenant_id, unit_id, start_date, end_date, rent_amount,
    security_deposit, late_fee_amount, late_fee_grace_days,
    utilities_landlord, utilities_tenant, equipment_included,
    pdf_url, extracted_by_ai, ai_confidence_notes,
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
        equipment_included, pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id, unit_id, start_date) DO NOTHING
     RETURNING *`,
    [
      tenant_id, unit_id, start_date, end_date, rent_amount,
      security_deposit ?? null, late_fee_amount ?? null, late_fee_grace_days ?? null,
      utilities_landlord ? JSON.stringify(utilities_landlord) : null,
      utilities_tenant   ? JSON.stringify(utilities_tenant)   : null,
      equipment_included ? JSON.stringify(equipment_included) : null,
      pdf_url ?? null,
      extracted_by_ai ?? false,
      ai_confidence_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
