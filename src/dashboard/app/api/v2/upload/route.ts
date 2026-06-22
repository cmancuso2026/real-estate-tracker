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
    system: `You are parsing an annual Escrow Account Disclosure Statement PDF from any mortgage lender (Wells Fargo, Freedom Mortgage, Chase, etc.).
Respond with valid JSON only. No markdown, no preamble, no explanation. All amounts are decimals with exact cents. Dates are YYYY-MM-DD. Shortage = NEGATIVE number.

WHAT TO EXTRACT:

1. statement_date: The "Statement Date" shown in the header/account info section. Convert to YYYY-MM-DD.

2. analysis_period_start / analysis_period_end: The date range of the most recent FULL 12-month actual period analyzed. Look for phrases like "analysis period", "escrow account history", or the period covered by the previous year's actual disbursements table. Use the start and end dates of that 12-month window.

3. total_property_taxes: Total property/county tax disbursements paid out in the most recent full 12-month actual period. Look in "Actual Activity" or "Your Escrow Account History" tables for rows labeled "COUNTY TAX", "PROPERTY TAX", "REAL ESTATE TAX" etc. Sum all tax rows for the full year.

4. total_insurance: Total homeowners/hazard insurance disbursements in the most recent full 12-month actual period. Look for rows labeled "HOMEOWNERS", "HAZARD INSURANCE", "PROPERTY INSURANCE" etc. Sum all insurance rows. FHA MIP / mortgage insurance premium is NOT homeowners insurance — exclude it.

5. shortage_surplus_amount: The shortage or surplus dollar amount. Look for "Shortage Amount", "escrow shortage of $X", "surplus of $X". Make shortage NEGATIVE, surplus POSITIVE.

6. new_monthly_escrow: The new monthly escrow payment amount going forward. Look for "New Monthly Escrow Payment", "Escrow Payment" under "New Monthly Payment", or "New Payment" breakdown table. This is the escrow-only portion, NOT the total mortgage payment.

7. options: Payment options if presented (some lenders offer Option 1 / Option 2 for paying shortage). If no options are presented, return an empty array []. Each option: {"label": string, "new_monthly_escrow": decimal, "total_payment": decimal}.

8. tax_disbursements: Array of individual tax payment rows from the actual activity table. Each: {"date": "YYYY-MM-DD", "payee": "COUNTY TAX or similar", "amount": decimal}.

9. insurance_disbursements: Array of individual homeowners/hazard insurance payment rows from the actual activity table. Each: {"date": "YYYY-MM-DD", "payee": "HOMEOWNERS or similar", "amount": decimal}. Exclude FHA MIP.

10. confidence_notes: Note anything uncertain, ambiguous, or approximated. Null if confident.

IMPORTANT: FHA MIP (FHA Mortgage Insurance Premium / FHA MIP RBP MON) is NOT property insurance. Do not include it in total_insurance or insurance_disbursements.`,
    user: `Return this JSON with values extracted from the escrow statement:
{
  "statement_date": "YYYY-MM-DD",
  "analysis_period_start": "YYYY-MM-DD",
  "analysis_period_end": "YYYY-MM-DD",
  "total_property_taxes": decimal,
  "total_insurance": decimal,
  "shortage_surplus_amount": decimal_negative_for_shortage_positive_for_surplus,
  "new_monthly_escrow": decimal,
  "options": [],
  "tax_disbursements": [{"date":"YYYY-MM-DD","payee":"string","amount":decimal}],
  "insurance_disbursements": [{"date":"YYYY-MM-DD","payee":"string","amount":decimal}],
  "confidence_notes": "string or null"
}`,
  },
  vendor_quote: {
    system: `You are parsing a vendor quote, invoice, or contractor email/PDF for a real estate property. Extract all available information. Respond with valid JSON only. No markdown. Dates YYYY-MM-DD. Amounts as decimals.`,
    user: `Extract and return this JSON:
{
  "vendor_name": "string or null",
  "vendor_phone": "string or null",
  "vendor_email": "string or null",
  "trade": "plumbing|hvac|electrical|roofing|appliance|landscaping|pest_control|general|other",
  "project_name": "brief description of the work e.g. 'AC Repair' or null",
  "quoted_cost": decimal or null,
  "scope_of_work": "string description of what's included or null",
  "quote_date": "YYYY-MM-DD or null",
  "valid_until": "YYYY-MM-DD or null",
  "confidence_notes": "string or null"
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
  const pastedText = ((formData.get('text') as string | null) ?? '').trim() || null;
  const type = formData.get('type') as string | null;

  if (!file && !pastedText) {
    return NextResponse.json({ error: 'file or text is required' }, { status: 400 });
  }
  if (!type || !PROMPTS[type]) {
    return NextResponse.json(
      { error: 'type must be one of: lease, work_order, escrow, insurance, vendor_quote' },
      { status: 400 }
    );
  }

  const { system, user } = PROMPTS[type];

  // Build the user content: a PDF document when a file is uploaded, otherwise the
  // pasted email/quote text. The instruction block (`user`) always comes last.
  const content: Array<Record<string, unknown>> = [];
  if (file) {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
  } else if (pastedText) {
    content.push({ type: 'text', text: `Document content:\n\n${pastedText}` });
  }
  content.push({ type: 'text', text: user });

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
      messages: [{ role: 'user', content }],
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
