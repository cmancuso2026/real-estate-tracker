import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    escrow_account_id, statement_date, analysis_period_start, analysis_period_end,
    total_property_taxes, total_insurance,
    projected_requirement, actual_disbursements,
    shortage_surplus_amount, new_monthly_escrow,
    tax_disbursements, insurance_disbursements,
    pdf_url, extracted_by_ai, ai_confidence_notes,
  } = body;

  if (!escrow_account_id) {
    return NextResponse.json({ error: 'escrow_account_id is required' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO escrow_statements
       (escrow_account_id, statement_date, analysis_period_start, analysis_period_end,
        total_property_taxes, total_insurance,
        projected_requirement, actual_disbursements,
        shortage_surplus_amount, new_monthly_escrow,
        tax_disbursements, insurance_disbursements,
        pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      escrow_account_id,
      statement_date ?? null, analysis_period_start ?? null, analysis_period_end ?? null,
      total_property_taxes ?? null, total_insurance ?? null,
      projected_requirement ?? null, actual_disbursements ?? null,
      shortage_surplus_amount ?? null, new_monthly_escrow ?? null,
      tax_disbursements ? JSON.stringify(tax_disbursements) : null,
      insurance_disbursements ? JSON.stringify(insurance_disbursements) : null,
      pdf_url ?? null, extracted_by_ai ?? false, ai_confidence_notes ?? null,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}
