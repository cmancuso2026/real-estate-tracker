/**
 * POST /api/v2/piti/save
 * Saves extracted PITI data to the database after user review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      property_id,
      statement_date,
      principal,
      interest,
      property_taxes,
      escrow_insurance,
      pdf_url,
      ai_confidence_notes,
    } = body;

    if (!statement_date || principal == null || interest == null || property_taxes == null || escrow_insurance == null) {
      return NextResponse.json(
        { error: 'statement_date, principal, interest, property_taxes, escrow_insurance are required' },
        { status: 400 },
      );
    }

    // Extract YYYY-MM from statement_date (YYYY-MM-DD format expected)
    const statementYearMonth = statement_date.slice(0, 7); // "2025-03"
    const totalPayment = principal + interest + property_taxes + escrow_insurance;

    // Insert with UNIQUE (property_id, statement_year_month) conflict handling
    const result = await query(
      `INSERT INTO piti_history (
        property_id,
        statement_date,
        statement_year_month,
        principal,
        interest,
        property_taxes,
        escrow_insurance,
        total_payment,
        pdf_url,
        extracted_by_ai,
        ai_confidence_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (property_id, statement_year_month) DO UPDATE
      SET principal = $4,
          interest = $5,
          property_taxes = $6,
          escrow_insurance = $7,
          total_payment = $8,
          pdf_url = $9,
          extracted_by_ai = $10,
          ai_confidence_notes = $11,
          updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
      RETURNING *`,
      [
        property_id,
        statement_date,
        statementYearMonth,
        principal,
        interest,
        property_taxes,
        escrow_insurance,
        totalPayment,
        pdf_url || null,
        true, // extracted_by_ai
        ai_confidence_notes || null,
      ],
    );

    return NextResponse.json({
      success: true,
      piti: result[0],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('PITI save error:', msg);
    return NextResponse.json({ error: 'Failed to save PITI', details: msg }, { status: 500 });
  }
}
