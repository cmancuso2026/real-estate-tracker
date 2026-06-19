import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/insurance?propertyId=1&expiringSoon=true
export async function GET(req: NextRequest) {
  const propertyId   = req.nextUrl.searchParams.get('propertyId');
  const expiringSoon = req.nextUrl.searchParams.get('expiringSoon') === 'true';

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (propertyId)   { conditions.push(`ip.property_id = $${idx++}`); values.push(propertyId); }
  if (expiringSoon) {
    conditions.push(
      `ip.expiration_date BETWEEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')`
    );
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
        renewal_period_days, annual_premium, deductible, coverage_limit,
        coverage_notes, pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      property_id, carrier, policy_number ?? null, policy_type ?? null,
      effective_date, expiration_date, renewal_period_days ?? 365,
      annual_premium ?? null, deductible ?? null, coverage_limit ?? null,
      coverage_notes ?? null, pdf_url ?? null,
      extracted_by_ai ?? false, ai_confidence_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
