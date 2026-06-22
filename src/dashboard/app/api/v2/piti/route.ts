/**
 * POST /api/v2/piti
 * Accepts a PDF mortgage statement file (multipart/form-data),
 * runs Claude extraction to parse Principal, Interest, Taxes, Insurance,
 * and returns the structured result for review.
 *
 * Form fields:
 *   file        — the mortgage statement PDF (required)
 *   property_id — the property ID (required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v2/piti?propertyId=1
 * Returns PITI history for a property (for the escrow/mortgage tab)
 */
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');

  if (!propertyId) {
    return NextResponse.json(
      { error: 'propertyId query parameter is required' },
      { status: 400 },
    );
  }

  try {
    const rows = await query(
      `SELECT * FROM piti_history
       WHERE property_id = $1
       ORDER BY statement_year_month DESC`,
      [propertyId],
    );

    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('PITI fetch error:', msg);
    return NextResponse.json(
      { error: 'Failed to fetch PITI history', details: msg },
      { status: 500 },
    );
  }
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const PITI_PROMPT = {
  system: `You are a mortgage statement parser. Extract Principal, Interest, Property Taxes, and Insurance from monthly mortgage statements.
Always respond with valid JSON only — no preamble, no markdown fences.
Dates must be YYYY-MM-DD. Dollar amounts must be decimals with cents (e.g., 1234.56).
For statement_date, extract the month/year the statement covers (typically shown in the header).
For amounts: if the statement shows a range or "as of" date, use that specific month's amounts.`,
  user: `Extract and return this JSON from the mortgage statement:
{
  "statement_date": "YYYY-MM-DD (the month/year this statement covers)",
  "principal": decimal,
  "interest": decimal,
  "property_taxes": decimal,
  "escrow_insurance": decimal,
  "confidence_notes": "string or null (flag any ambiguous fields)"
}`,
};

export async function POST(req: NextRequest) {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 500 },
    );
  }

  // Parse multipart form
  const data = await req.formData();
  const file = data.get('file') as File | null;
  const propertyId = data.get('property_id') as string | null;

  if (!file || !propertyId) {
    return NextResponse.json(
      { error: 'file and property_id are required' },
      { status: 400 },
    );
  }

  // Read file into base64
  const buffer = await file.arrayBuffer();
  const b64 = Buffer.from(buffer).toString('base64');

  // Call Claude with the PDF
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: b64,
                },
              },
              {
                type: 'text',
                text: PITI_PROMPT.user,
              },
            ],
          },
        ],
        system: PITI_PROMPT.system,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', errText);
      return NextResponse.json(
        { error: 'Claude API call failed', details: errText },
        { status: response.status },
      );
    }

    const result = await response.json();
    const textContent = result.content.find(
      (c: { type: string }) => c.type === 'text',
    );

    if (!textContent) {
      return NextResponse.json(
        { error: 'No text response from Claude' },
        { status: 500 },
      );
    }

    // Parse the JSON response
    const cleanedText = textContent.text.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(cleanedText);

    return NextResponse.json({ extracted, file_name: file.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('PITI extraction error:', msg);
    return NextResponse.json(
      { error: 'Failed to extract PITI', details: msg },
      { status: 500 },
    );
  }
}
