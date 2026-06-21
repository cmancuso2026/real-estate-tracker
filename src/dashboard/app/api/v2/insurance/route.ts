import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const propertyId   = req.nextUrl.searchParams.get('propertyId');
  const expiringSoon = req.nextUrl.searchParams.get('expiringSoon') === 'true';

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (propertyId)   { conditions.push(`ip.property_id = $${idx++}`); values.push(propertyId); }
  if (expiringSoon) {
    conditions.push(`ip.expiration_date BETWEEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT ip.*, p.address AS property_address
     FROM insurance_policies ip
     JOIN owned_properties p ON p.id = ip.property_id
     ${where}
     ORDER BY ip.expiration_date`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    property_id, carrier, policy_number, policy_type,
    effective_date, expiration_date, renewal_period_days,
    annual_premium, deductible, coverage_limit, coverage_notes,
    dwelling_coverage, other_structures_coverage, personal_property_coverage,
    loss_of_use_coverage, liability_coverage, medical_payments_coverage,
    hurricane_deductible, wind_hail_deductible, flood_coverage,
    loss_of_rent_coverage, loss_of_rent_months,
    pdf_url, extracted_by_ai, ai_confidence_notes,
  } = body;

  if (!property_id || !carrier || !effective_date || !expiration_date) {
    return NextResponse.json(
      { error: 'property_id, carrier, effective_date, expiration_date are required' },
      { status: 400 }
    );
  }

  const rows = await query(
    `INSERT INTO insurance_policies
       (property_id, carrier, policy_number, policy_type, effective_date, expiration_date,
        renewal_period_days, annual_premium, deductible, coverage_limit, coverage_notes,
        dwelling_coverage, other_structures_coverage, personal_property_coverage,
        loss_of_use_coverage, liability_coverage, medical_payments_coverage,
        hurricane_deductible, wind_hail_deductible, flood_coverage,
        loss_of_rent_coverage, loss_of_rent_months,
        pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [
      property_id, carrier, policy_number ?? null, policy_type ?? null,
      effective_date, expiration_date, renewal_period_days ?? 365,
      annual_premium ?? null, deductible ?? null, coverage_limit ?? null, coverage_notes ?? null,
      dwelling_coverage ?? null, other_structures_coverage ?? null, personal_property_coverage ?? null,
      loss_of_use_coverage ?? null, liability_coverage ?? null, medical_payments_coverage ?? null,
      hurricane_deductible ?? null, wind_hail_deductible ?? null, flood_coverage ?? null,
      loss_of_rent_coverage ?? null, loss_of_rent_months ?? null,
      pdf_url ?? null, extracted_by_ai ?? false, ai_confidence_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
