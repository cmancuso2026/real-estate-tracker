/**
 * POST /api/v2/query
 * Natural language query against all property management data.
 * Used by the Slack bot and the dashboard chat widget.
 *
 * Body: { question: string }
 * Returns: { answer: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { question } = await req.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  // Build context from all relevant tables
  const [properties, units, tenants, leases, rentLast3Months, workOrders, vendors, escrow, insurance] =
    await Promise.all([
      query(`SELECT id, address, city, state, unit_count FROM owned_properties ORDER BY address`),
      query(`SELECT u.*, p.address AS property_address FROM units u JOIN owned_properties p ON p.id = u.property_id ORDER BY p.address, u.unit_label`),
      query(`SELECT t.*, u.unit_label FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.is_active = TRUE`),
      query(`
        SELECT l.*, t.first_name||' '||t.last_name AS tenant_name, u.unit_label, p.address AS property_address
        FROM leases l
        JOIN tenants t ON t.id = l.tenant_id
        JOIN units u ON u.id = l.unit_id
        JOIN owned_properties p ON p.id = u.property_id
        WHERE l.end_date >= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') - INTERVAL '6 months'
        ORDER BY l.end_date DESC
      `),
      query(`
        SELECT rc.*, u.unit_label, p.address AS property_address
        FROM rent_collections rc
        JOIN units u ON u.id = rc.unit_id
        JOIN owned_properties p ON p.id = u.property_id
        WHERE rc.due_date >= to_char((now() AT TIME ZONE 'UTC' - INTERVAL '3 months'),'YYYY-MM-DD')
        ORDER BY rc.due_date DESC
      `),
      query(`
        SELECT wo.*, v.name AS vendor_name, v.trade, p.address AS property_address, u.unit_label
        FROM work_orders wo
        JOIN vendors v ON v.id = wo.vendor_id
        JOIN owned_properties p ON p.id = wo.property_id
        LEFT JOIN units u ON u.id = wo.unit_id
        ORDER BY wo.date_received DESC
        LIMIT 50
      `),
      query(`SELECT * FROM vendors WHERE is_active = TRUE ORDER BY name`),
      query(`
        SELECT ea.*, p.address AS property_address,
               es.statement_date, es.projected_requirement, es.actual_disbursements,
               es.shortage_surplus_amount, es.new_monthly_escrow
        FROM escrow_accounts ea
        JOIN owned_properties p ON p.id = ea.property_id
        LEFT JOIN LATERAL (
          SELECT * FROM escrow_statements WHERE escrow_account_id = ea.id ORDER BY statement_date DESC LIMIT 1
        ) es ON TRUE
      `),
      query(`
        SELECT ip.*, p.address AS property_address
        FROM insurance_policies ip
        JOIN owned_properties p ON p.id = ip.property_id
        ORDER BY ip.expiration_date DESC
      `),
    ]);

  const context = JSON.stringify({
    properties,
    units,
    active_tenants: tenants,
    leases,
    rent_collections_last_3_months: rentLast3Months,
    work_orders: workOrders,
    vendors,
    escrow_accounts: escrow,
    insurance_policies: insurance,
  }, null, 2);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: `You are a helpful property management assistant for a landlord who owns three duplexes.
Answer questions about properties, tenants, work orders, vendors, rent collection, escrow, and insurance.
Be concise and direct. Format dollar amounts as $X,XXX. Use bullet points for lists.
If the data doesn't contain enough information to answer, say so clearly.
Today's date: ${new Date().toISOString().slice(0, 10)}`,
      messages: [
        {
          role: 'user',
          content: `Here is all current property management data:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: `Anthropic API error ${response.status}` }, { status: 502 });
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const answer = data.content.find(b => b.type === 'text')?.text ?? 'No response generated.';

  return NextResponse.json({ answer });
}
