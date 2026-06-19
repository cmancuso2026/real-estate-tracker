/**
 * AI Document Parser
 * Uses the Anthropic API to extract structured data from uploaded PDFs.
 * Handles four document types: leases, work orders, escrow statements, insurance policies.
 *
 * Requires: ANTHROPIC_API_KEY in environment.
 * PDFs are passed as base64-encoded documents in the Messages API.
 */

import type {
  LeaseExtraction,
  WorkOrderExtraction,
  EscrowExtraction,
  InsuranceExtraction,
} from '../db/types-v2.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return key;
}

/** Call Claude with a PDF document and a structured extraction prompt */
async function extractFromPdf<T>(
  pdfBase64: string,
  systemPrompt: string,
  userPrompt: string
): Promise<T> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find(b => b.type === 'text')?.text ?? '';

  // Strip markdown code fences if present
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error(`Claude returned non-JSON response: ${text.slice(0, 300)}`);
  }
}

// ===========================================================================
// LEASE EXTRACTION
// ===========================================================================

const LEASE_SYSTEM = `You are a real estate document parser. Extract structured data from residential lease agreements.
Always respond with valid JSON only — no preamble, no explanation, no markdown fences.
Use null for any field you cannot find or are uncertain about.
Dates must be in YYYY-MM-DD format. Dollar amounts must be integers (whole dollars).
Arrays must always be present (use [] if empty).`;

const LEASE_USER = `Extract the following fields from this lease PDF and return them as a single JSON object:

{
  "start_date": "YYYY-MM-DD or null",
  "end_date": "YYYY-MM-DD or null",
  "rent_amount": integer_dollars_or_null,
  "security_deposit": integer_dollars_or_null,
  "late_fee_amount": integer_dollars_or_null,
  "late_fee_grace_days": integer_or_null,
  "utilities_landlord": ["electric","gas","water","trash","sewer","internet"] (subset the landlord pays),
  "utilities_tenant": ["electric","gas","water","trash","sewer","internet"] (subset the tenant pays),
  "equipment_included": ["refrigerator","stove","dishwasher","washer","dryer","HVAC","microwave"] (included in unit),
  "confidence_notes": "string describing anything you were uncertain about, or null"
}`;

export async function extractLease(pdfBase64: string): Promise<LeaseExtraction> {
  return extractFromPdf<LeaseExtraction>(pdfBase64, LEASE_SYSTEM, LEASE_USER);
}

// ===========================================================================
// WORK ORDER / INVOICE EXTRACTION
// ===========================================================================

const WORK_ORDER_SYSTEM = `You are a real estate maintenance document parser. Extract structured data from contractor invoices, quotes, and work order PDFs.
Always respond with valid JSON only. Use null for missing fields.
Dates must be in YYYY-MM-DD format. Dollar amounts must be integers.
For category, choose from: plumbing | hvac | electrical | roofing | appliance | general | other`;

const WORK_ORDER_USER = `Extract the following fields from this contractor document and return them as a single JSON object:

{
  "vendor_name": "contractor or company name, or null",
  "category": "plumbing|hvac|electrical|roofing|appliance|general|other",
  "description": "brief description of the work performed or quoted",
  "date_received": "YYYY-MM-DD of the document/invoice date, or null",
  "quoted_cost": integer_estimate_or_null,
  "actual_cost": integer_final_invoice_amount_or_null,
  "confidence_notes": "anything you were uncertain about, or null"
}`;

export async function extractWorkOrder(pdfBase64: string): Promise<WorkOrderExtraction> {
  return extractFromPdf<WorkOrderExtraction>(pdfBase64, WORK_ORDER_SYSTEM, WORK_ORDER_USER);
}

// ===========================================================================
// ESCROW STATEMENT EXTRACTION
// ===========================================================================

const ESCROW_SYSTEM = `You are a mortgage document parser specializing in annual escrow analysis statements from lenders.
Always respond with valid JSON only. Use null for missing fields.
Dates must be YYYY-MM-DD. Dollar amounts must be integers (whole dollars).
Shortage is negative, surplus is positive for shortage_surplus_amount.
Disbursements are arrays of objects with date, payee, and amount fields.`;

const ESCROW_USER = `Extract the following fields from this escrow analysis statement and return them as a single JSON object:

{
  "statement_date": "YYYY-MM-DD of the statement",
  "analysis_period_start": "YYYY-MM-DD",
  "analysis_period_end": "YYYY-MM-DD",
  "projected_requirement": integer_what_lender_projected_for_the_year,
  "actual_disbursements": integer_what_was_actually_paid_out,
  "shortage_surplus_amount": integer_negative_if_shortage_positive_if_surplus,
  "new_monthly_escrow": integer_new_monthly_escrow_payment_going_forward,
  "tax_disbursements": [{"date":"YYYY-MM-DD","payee":"county tax authority","amount":1234}],
  "insurance_disbursements": [{"date":"YYYY-MM-DD","payee":"insurance carrier","amount":567}],
  "confidence_notes": "anything uncertain, or null"
}`;

export async function extractEscrowStatement(pdfBase64: string): Promise<EscrowExtraction> {
  return extractFromPdf<EscrowExtraction>(pdfBase64, ESCROW_SYSTEM, ESCROW_USER);
}

// ===========================================================================
// INSURANCE POLICY EXTRACTION
// ===========================================================================

const INSURANCE_SYSTEM = `You are an insurance document parser specializing in residential and landlord insurance policies.
Always respond with valid JSON only. Use null for missing fields.
Dates must be YYYY-MM-DD. Dollar amounts must be integers.
For policy_type, choose from: homeowners | landlord | liability | flood | umbrella | other
coverage_notes should capture key coverage details in plain English (loss of rent, named perils, exclusions, etc.)`;

const INSURANCE_USER = `Extract the following fields from this insurance policy PDF and return them as a single JSON object:

{
  "carrier": "insurance company name",
  "policy_number": "policy number or null",
  "policy_type": "homeowners|landlord|liability|flood|umbrella|other",
  "effective_date": "YYYY-MM-DD",
  "expiration_date": "YYYY-MM-DD",
  "renewal_period_days": 365,
  "annual_premium": integer_total_annual_premium,
  "deductible": integer_deductible_amount,
  "coverage_limit": integer_dwelling_coverage_limit,
  "coverage_notes": "plain English summary of key coverage: included perils, loss of rent, exclusions, liability limits, etc.",
  "confidence_notes": "anything uncertain, or null"
}`;

export async function extractInsurancePolicy(pdfBase64: string): Promise<InsuranceExtraction> {
  return extractFromPdf<InsuranceExtraction>(pdfBase64, INSURANCE_SYSTEM, INSURANCE_USER);
}

// ===========================================================================
// BOFA CSV PARSER (client-side, no AI needed)
// ===========================================================================

/**
 * Parses a Bank of America transaction CSV export.
 * BofA's CSV format: Date,Description,Amount,Running Bal.
 * Returns only credit rows (positive amounts = payments received).
 */
export function parseBofaCsv(csvText: string): Array<{
  date: string;
  description: string;
  amount: number;
  balance: number | null;
}> {
  const lines = csvText.trim().split('\n');

  // Find the header row (contains "Date" and "Amount")
  let headerIdx = lines.findIndex(l => l.toLowerCase().includes('date') && l.toLowerCase().includes('amount'));
  if (headerIdx === -1) headerIdx = 0;

  const headers = (lines[headerIdx] ?? "").split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const dateIdx   = headers.findIndex(h => h === 'date');
  const descIdx   = headers.findIndex(h => h.includes('description'));
  const amtIdx    = headers.findIndex(h => h === 'amount');
  const balIdx    = headers.findIndex(h => h.includes('running') || h.includes('balance'));

  const results: Array<{ date: string; description: string; amount: number; balance: number | null }> = [];

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;

    // Handle quoted CSV fields
    const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c => c.replace(/"/g, '').trim()) ?? line.split(',').map(c => c.trim());

    const amount = parseFloat(cols[amtIdx] ?? '0');
    if (isNaN(amount) || amount <= 0) continue;   // skip debits and invalid rows

    results.push({
      date: cols[dateIdx] ?? '',
      description: cols[descIdx] ?? '',
      amount,
      balance: balIdx >= 0 ? (parseFloat(cols[balIdx] ?? '') || null) : null,
    });
  }

  return results;
}

// ===========================================================================
// NATURAL LANGUAGE QUERY (for Slack bot)
// ===========================================================================

/**
 * Answer a natural language question about the user's properties using
 * the provided context data. Used by the Slack bot.
 */
export async function answerPropertyQuery(
  question: string,
  context: string
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: `You are a helpful property management assistant. Answer questions about the landlord's properties, tenants, work orders, vendors, rent collection, escrow, and insurance.
Be concise and direct. Use bullet points for lists. Format dollar amounts as $X,XXX.
If you don't have enough information to answer, say so clearly.
Today's date: ${new Date().toISOString().slice(0, 10)}`,
      messages: [
        {
          role: 'user',
          content: `Here is the current data about my properties:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.find(b => b.type === 'text')?.text ?? 'No response generated.';
}

// ===========================================================================
// MONTHLY RECAP SUMMARY GENERATOR
// ===========================================================================

/**
 * Generate a plain-English monthly recap from a PropertySummary object.
 * Output is suitable for both email and Slack.
 */
export async function generateMonthlyRecap(contextJson: string): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: `You are a property management analyst. Write a concise monthly recap for a landlord who owns three duplexes.
Format: plain text with clear sections. Use bullet points. Dollar amounts as $X,XXX.
Highlight: rent collection status, any outstanding amounts, lease expirations coming up, open work orders, escrow/insurance items needing attention.
Be direct and actionable. Flag anything that needs the landlord's immediate attention.
Today's date: ${new Date().toISOString().slice(0, 10)}`,
      messages: [
        {
          role: 'user',
          content: `Generate a monthly recap from this property data:\n\n${contextJson}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.find(b => b.type === 'text')?.text ?? 'Could not generate recap.';
}
