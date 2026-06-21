/**
 * POST /api/v2/upload
 * Accepts a PDF file (multipart/form-data) and a document type,
 * runs Claude extraction, and returns the structured result.
 * The caller reviews the result and then POSTs to the appropriate
 * data endpoint (/api/v2/leases, /api/v2/work-orders, etc.).
 *
 * Form fields:
 *   file        — the PDF (required)
 *   type        — 'lease' | 'work_order' | 'escrow' | 'insurance' (required)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const PROMPTS: Record<string, { system: string; user: string }> = {
  lease: {
    system: `You are a real estate document parser. Extract structured data from residential lease agreements.
Always respond with valid JSON only — no preamble, no markdown fences.
Dates must be YYYY-MM-DD. Dollar amounts must be integers. Arrays must be present (use [] if empty).`,
    user: `Extract and return this JSON from the lease:
{
  "tenant_first_name": "tenant first name or null",
  "tenant_last_name": "tenant last name or null",
  "start_date": "YYYY-MM-DD or null",
  "end_date": "YYYY-MM-DD or null",
  "rent_amount": integer_or_null,
  "security_deposit": integer_or_null,
  "late_fee_amount": integer_or_null,
  "late_fee_grace_days": integer_or_null,
  "utilities_landlord": [],
  "utilities_tenant": [],
  "equipment_included": [],
  "confidence_notes": "string or null"
}`,
  },

  work_order: {
    system: `You are a real estate maintenance document parser. Extract data from contractor invoices and quotes.
Always respond with valid JSON only. Dates must be YYYY-MM-DD. Amounts must be integers.
For category choose from: plumbing | hvac | electrical | roofing | appliance | general | other`,
    user: `Extract and return this JSON from the contractor document:
{
  "vendor_name": "string or null",
  "category": "plumbing|hvac|electrical|roofing|appliance|general|other",
  "description": "string",
  "date_received": "YYYY-MM-DD or null",
  "quoted_cost": integer_or_null,
  "actual_cost": integer_or_null,
  "confidence_notes": "string or null"
}`,
  },

  escrow: {
    system: `You are a mortgage document parser specializing in annual escrow analysis statements from US lenders (Wells Fargo, Chase, Rocket Mortgage, etc).
Always respond with valid JSON only. No markdown, no explanation.
Dates must be YYYY-MM-DD. Dollar amounts must be DECIMAL numbers with cents (e.g. 9984.03), NOT integers.
Shortage is NEGATIVE, surplus is POSITIVE for shortage_surplus_amount.

Key fields to find:
- statement_date: the date the statement was issued or mailed
- analysis_period_start / analysis_period_end: the 12-month period being analyzed
- total_property_taxes: sum of ALL property tax disbursements for the year (look for county tax, city tax, school tax lines)
- total_insurance: sum of ALL insurance premium disbursements for the year (homeowners, flood, etc.)
- shortage_surplus_amount: the EXACT shortage or surplus dollar amount stated on the document. Shortage is negative. This is typically between -$2,000 and +$2,000.
- options: the payment options offered (Option 1 = spread shortage over 12 months, Option 2 = pay shortage in full). Extract the new escrow PORTION ONLY (not the total mortgage payment) and the total new mortgage payment for each.
- tax_disbursements: each individual property tax payment with exact date and amount
- insurance_disbursements: each individual insurance payment with exact date and amount`,
    user: `Extract and return this JSON from the escrow analysis statement:
{
  "statement_date": "YYYY-MM-DD or null",
  "analysis_period_start": "YYYY-MM-DD or null",
  "analysis_period_end": "YYYY-MM-DD or null",
  "total_property_taxes": decimal_sum_of_all_tax_disbursements_or_null,
  "total_insurance": decimal_sum_of_all_insurance_disbursements_or_null,
  "shortage_surplus_amount": decimal_negative_if_shortage_positive_if_surplus_or_null,
  "new_monthly_escrow": null,
  "options": [
    {"label": "Option 1 - Pay shortage over 12 months", "new_monthly_escrow": decimal_escrow_portion_only, "total_payment": decimal_total_mortgage_payment},
    {"label": "Option 2 - Pay shortage in full", "new_monthly_escrow": decimal_escrow_portion_only, "total_payment": decimal_total_mortgage_payment}
  ],
  "tax_disbursements": [{"date":"YYYY-MM-DD","payee":"county or tax authority name","amount":decimal}],
  "insurance_disbursements": [{"date":"YYYY-MM-DD","payee":"insurance carrier name","amount":decimal}],
  "confidence_notes": "describe anything you were uncertain about, or null"
}`,  
  },

  insurance: {
    system: `You are an insurance document parser for residential and landlord policies.
Always respond with valid JSON only. No markdown, no explanation. Dates must be YYYY-MM-DD. All dollar amounts must be integers (whole dollars).
For policy_type choose from: homeowners | landlord | liability | flood | umbrella | other.
Extract every individual coverage limit and deductible you can find — dwelling, other structures, personal property, loss of use, liability, medical payments, hurricane deductible, wind/hail deductible, flood, loss of rent. These are typically listed in a coverage summary table.`,
    user: `Extract and return this JSON from the insurance policy:
{
  "carrier": "insurance company name or null",
  "policy_number": "policy number or null",
  "policy_type": "homeowners|landlord|liability|flood|umbrella|other",
  "effective_date": "YYYY-MM-DD or null",
  "expiration_date": "YYYY-MM-DD or null",
  "renewal_period_days": 365,
  "annual_premium": integer_total_annual_premium_or_null,
  "deductible": integer_standard_deductible_or_null,
  "coverage_limit": integer_total_dwelling_coverage_or_null,
  "dwelling_coverage": integer_or_null,
  "other_structures_coverage": integer_or_null,
  "personal_property_coverage": integer_or_null,
  "loss_of_use_coverage": integer_or_null,
  "liability_coverage": integer_or_null,
  "medical_payments_coverage": integer_or_null,
  "hurricane_deductible": integer_or_null,
  "wind_hail_deductible": integer_or_null,
  "flood_coverage": integer_or_null,
  "loss_of_rent_coverage": integer_or_null,
  "loss_of_rent_months": integer_number_of_months_loss_of_rent_covered_or_null,
  "coverage_notes": "any other notable coverage details, exclusions, or endorsements not captured above",
  "confidence_notes": "anything you were uncertain about or null"
}`,
  },
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const type = formData.get('type') as string | null;

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!type || !PROMPTS[type]) {
    return NextResponse.json(
      { error: 'type must be one of: lease, work_order, escrow, insurance' },
      { status: 400 }
    );
  }

  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const { system, user } = PROMPTS[type];

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: user },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    return NextResponse.json(
      { error: `Anthropic API error ${response.status}`, detail: errBody },
      { status: 502 }
    );
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find(b => b.type === 'text')?.text ?? '';
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    const extracted = JSON.parse(clean);
    return NextResponse.json({ type, extracted });
  } catch {
    return NextResponse.json(
      { error: 'Claude returned non-JSON response', raw: text.slice(0, 500) },
      { status: 502 }
    );
  }
}
