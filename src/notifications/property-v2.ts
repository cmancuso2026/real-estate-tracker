/**
 * V2 Notifications — Property Management
 *
 * 1. sendPropertyRecap()  — monthly recap via Slack + email
 * 2. sendProactiveAlerts() — lease expiry, unrated WOs, insurance expiry
 * 3. handleSlackBotQuery() — answer NLQ from a Slack slash command / mention
 *
 * Uses the existing SLACK_WEBHOOK_URL from config.
 * Requires ANTHROPIC_API_KEY for the Claude-generated recap and NLQ answers.
 */

import { config } from '../config.js';
import { query } from '../db/index.js';
import { postToSlack } from './slack.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

function apiKey(): string {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set');
  return k;
}

async function askClaude(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.find(b => b.type === 'text')?.text ?? '';
}

// ---------------------------------------------------------------------------
// DATA CONTEXT BUILDER
// ---------------------------------------------------------------------------

async function buildContext(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const [properties, rentThisMonth, openWorkOrders, expiringLeases, unratedWOs, insurance, escrow] =
    await Promise.all([
      query(`SELECT * FROM owned_properties ORDER BY address`),

      query(
        `SELECT rc.*, u.unit_label, p.address AS property_address,
                (t.first_name||' '||t.last_name) AS tenant_name
         FROM rent_collections rc
         JOIN units u ON u.id=rc.unit_id
         JOIN owned_properties p ON p.id=u.property_id
         LEFT JOIN tenants t ON t.unit_id=rc.unit_id AND t.is_active=TRUE
         WHERE rc.due_date LIKE $1`,
        [thisMonth + '%']
      ),

      query(
        `SELECT wo.*, v.name AS vendor_name, v.trade, p.address AS property_address
         FROM work_orders wo
         JOIN vendors v ON v.id=wo.vendor_id
         JOIN owned_properties p ON p.id=wo.property_id
         WHERE wo.status='open'`
      ),

      query(
        `SELECT l.*, t.first_name||' '||t.last_name AS tenant_name,
                u.unit_label, p.address AS property_address
         FROM leases l
         JOIN tenants t ON t.id=l.tenant_id
         JOIN units u ON u.id=l.unit_id
         JOIN owned_properties p ON p.id=u.property_id
         WHERE l.end_date BETWEEN $1 AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')`,
        [today]
      ),

      query(
        `SELECT wo.*, v.name AS vendor_name, p.address AS property_address
         FROM work_orders wo
         JOIN vendors v ON v.id=wo.vendor_id
         JOIN owned_properties p ON p.id=wo.property_id
         WHERE wo.status='complete' AND wo.rating IS NULL`
      ),

      query(
        `SELECT ip.*, p.address AS property_address
         FROM insurance_policies ip
         JOIN owned_properties p ON p.id=ip.property_id
         WHERE ip.expiration_date BETWEEN $1 AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')`,
        [today]
      ),

      query(
        `SELECT ea.*, p.address AS property_address,
                es.statement_date, es.projected_requirement,
                es.actual_disbursements, es.shortage_surplus_amount, es.new_monthly_escrow
         FROM escrow_accounts ea
         JOIN owned_properties p ON p.id=ea.property_id
         LEFT JOIN LATERAL (
           SELECT * FROM escrow_statements WHERE escrow_account_id=ea.id ORDER BY statement_date DESC LIMIT 1
         ) es ON TRUE`
      ),
    ]);

  return JSON.stringify({
    today,
    properties,
    rent_this_month: rentThisMonth,
    open_work_orders: openWorkOrders,
    leases_expiring_60d: expiringLeases,
    unrated_completed_work_orders: unratedWOs,
    insurance_expiring_60d: insurance,
    escrow_accounts_with_latest_statement: escrow,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// MONTHLY RECAP
// ---------------------------------------------------------------------------

export async function sendPropertyRecap(): Promise<void> {
  console.log('[v2-notify] Building monthly property recap...');
  const context = await buildContext();

  const recap = await askClaude(
    `You are a property management analyst for a landlord with three duplexes.
Write a concise monthly recap. Use plain text with clear sections and bullet points.
Format dollar amounts as $X,XXX. Flag anything needing immediate attention with ⚠️.
Sections: Rent Collection | Work Orders | Leases | Escrow | Insurance | Action Items
Today: ${new Date().toISOString().slice(0, 10)}`,
    `Generate a monthly recap from this property management data:\n\n${context}`
  );

  // Post to Slack
  await postToSlack({ text: `📋 *Monthly Property Recap*\n\n${recap}` });
  console.log('[v2-notify] Monthly recap sent to Slack.');

  // Also send via email if SENDGRID_API_KEY / SMTP is configured
  const emailTo = process.env.NOTIFY_EMAIL;
  if (emailTo && process.env.SENDGRID_API_KEY) {
    await sendRecapEmail(emailTo, recap);
    console.log(`[v2-notify] Monthly recap emailed to ${emailTo}.`);
  }
}

async function sendRecapEmail(to: string, recapText: string): Promise<void> {
  const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.NOTIFY_FROM_EMAIL ?? 'noreply@realestate-tracker.com' },
      subject: `Property Recap — ${month}`,
      content: [{ type: 'text/plain', value: recapText }],
    }),
  });
}

// ---------------------------------------------------------------------------
// PROACTIVE ALERTS
// ---------------------------------------------------------------------------

export async function sendProactiveAlerts(): Promise<void> {
  console.log('[v2-notify] Checking for proactive alerts...');
  const alerts: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Leases expiring in 60 days
  const expiringLeases = await query(
    `SELECT l.end_date, t.first_name||' '||t.last_name AS tenant_name,
            u.unit_label, p.address AS property_address
     FROM leases l
     JOIN tenants t ON t.id=l.tenant_id
     JOIN units u ON u.id=l.unit_id
     JOIN owned_properties p ON p.id=u.property_id
     WHERE l.end_date BETWEEN $1 AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')
     ORDER BY l.end_date`,
    [today]
  );

  if (expiringLeases.length > 0) {
    alerts.push(`⚠️ *Leases expiring within 60 days:*`);
    for (const l of expiringLeases as Array<Record<string, string>>) {
      alerts.push(`  • ${l['tenant_name']} — Unit ${l['unit_label']} at ${l['property_address']} (expires ${l['end_date']})`);
    }
  }

  // Unrated completed work orders
  const unratedWOs = await query(
    `SELECT wo.id, wo.date_completed, wo.description,
            v.name AS vendor_name, p.address AS property_address
     FROM work_orders wo
     JOIN vendors v ON v.id=wo.vendor_id
     JOIN owned_properties p ON p.id=wo.property_id
     WHERE wo.status='complete' AND wo.rating IS NULL`
  );

  if (unratedWOs.length > 0) {
    alerts.push(`\n⭐ *Work orders awaiting your rating:*`);
    for (const wo of unratedWOs as Array<Record<string, string>>) {
      alerts.push(`  • ${wo['vendor_name']} — ${wo['description']} at ${wo['property_address']} (completed ${wo['date_completed']})`);
    }
  }

  // Insurance expiring in 60 days
  const expiringInsurance = await query(
    `SELECT ip.carrier, ip.expiration_date, ip.policy_type, p.address AS property_address
     FROM insurance_policies ip
     JOIN owned_properties p ON p.id=ip.property_id
     WHERE ip.expiration_date BETWEEN $1 AND to_char((now() AT TIME ZONE 'UTC' + INTERVAL '60 days'),'YYYY-MM-DD')`,
    [today]
  );

  if (expiringInsurance.length > 0) {
    alerts.push(`\n🏷️ *Insurance policies expiring within 60 days:*`);
    for (const ip of expiringInsurance as Array<Record<string, string>>) {
      alerts.push(`  • ${ip['carrier']} (${ip['policy_type']}) at ${ip['property_address']} — expires ${ip['expiration_date']}`);
    }
  }

  if (alerts.length === 0) {
    console.log('[v2-notify] No proactive alerts to send.');
    return;
  }

  await postToSlack({ text: `🔔 *Property Management Alerts*\n\n${alerts.join('\n')}` });
  console.log(`[v2-notify] Sent ${alerts.length} alert groups to Slack.`);
}

// ---------------------------------------------------------------------------
// SLACK BOT QUERY HANDLER
// ---------------------------------------------------------------------------

/**
 * Handle a natural language query from a Slack slash command or mention.
 * Call this from your Slack event handler / slash command endpoint.
 *
 * @param question  The user's question text
 * @returns         A formatted answer string to post back to Slack
 */
export async function handleSlackBotQuery(question: string): Promise<string> {
  // Build full context and query all data
  const [properties, workOrders, vendors, tenants, leases, rent, escrow, insurance] =
    await Promise.all([
      query(`SELECT * FROM owned_properties`),
      query(
        `SELECT wo.*, v.name AS vendor_name, v.trade, v.phone AS vendor_phone,
                p.address AS property_address, u.unit_label
         FROM work_orders wo
         JOIN vendors v ON v.id=wo.vendor_id
         JOIN owned_properties p ON p.id=wo.property_id
         LEFT JOIN units u ON u.id=wo.unit_id
         ORDER BY wo.date_received DESC LIMIT 100`
      ),
      query(`SELECT * FROM vendors WHERE is_active=TRUE`),
      query(`SELECT t.*, u.unit_label FROM tenants t JOIN units u ON u.id=t.unit_id WHERE t.is_active=TRUE`),
      query(
        `SELECT l.*, t.first_name||' '||t.last_name AS tenant_name, u.unit_label, p.address AS property_address
         FROM leases l
         JOIN tenants t ON t.id=l.tenant_id
         JOIN units u ON u.id=l.unit_id
         JOIN owned_properties p ON p.id=u.property_id
         WHERE l.end_date >= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') - INTERVAL '6 months'
         ORDER BY l.end_date DESC`
      ),
      query(
        `SELECT rc.*, u.unit_label, p.address AS property_address
         FROM rent_collections rc
         JOIN units u ON u.id=rc.unit_id
         JOIN owned_properties p ON p.id=u.property_id
         ORDER BY rc.due_date DESC LIMIT 36`
      ),
      query(
        `SELECT ea.*, p.address AS property_address,
                es.statement_date, es.projected_requirement, es.actual_disbursements,
                es.shortage_surplus_amount, es.new_monthly_escrow
         FROM escrow_accounts ea
         JOIN owned_properties p ON p.id=ea.property_id
         LEFT JOIN LATERAL (
           SELECT * FROM escrow_statements WHERE escrow_account_id=ea.id ORDER BY statement_date DESC LIMIT 1
         ) es ON TRUE`
      ),
      query(
        `SELECT ip.*, p.address AS property_address FROM insurance_policies ip
         JOIN owned_properties p ON p.id=ip.property_id ORDER BY ip.expiration_date DESC`
      ),
    ]);

  const context = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    properties, work_orders: workOrders, vendors, active_tenants: tenants,
    leases, rent_collections: rent, escrow_accounts: escrow, insurance_policies: insurance,
  }, null, 2);

  return askClaude(
    `You are a helpful property management assistant for a landlord with three duplexes.
Answer questions about properties, tenants, work orders, vendors, rent, escrow, and insurance.
Be concise. Format amounts as $X,XXX. Use bullet points for lists.
If you don't have enough information, say so.
Today: ${new Date().toISOString().slice(0, 10)}`,
    `Property data:\n\n${context}\n\nQuestion: ${question}`
  );
}
