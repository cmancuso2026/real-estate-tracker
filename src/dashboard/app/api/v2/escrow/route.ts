import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/v2/escrow?propertyId=1
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  const where = propertyId ? 'WHERE ea.property_id = $1' : '';
  const values = propertyId ? [propertyId] : [];

  const accounts = await query(
    `SELECT ea.*,
            p.address AS property_address,
            es.statement_date,
            es.projected_requirement,
            es.actual_disbursements,
            es.shortage_surplus_amount,
            es.new_monthly_escrow
     FROM escrow_accounts ea
     JOIN owned_properties p ON p.id = ea.property_id
     LEFT JOIN LATERAL (
       SELECT * FROM escrow_statements
       WHERE escrow_account_id = ea.id
       ORDER BY statement_date DESC
       LIMIT 1
     ) es ON TRUE
     ${where}
     ORDER BY p.address`,
    values
  );
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { property_id, lender_name, loan_number, notes } = body;

  if (!property_id || !lender_name) {
    return NextResponse.json({ error: 'property_id and lender_name are required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO escrow_accounts (property_id, lender_name, loan_number, notes)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (property_id, loan_number) DO UPDATE SET lender_name=EXCLUDED.lender_name
     RETURNING *`,
    [property_id, lender_name, loan_number ?? null, notes ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
