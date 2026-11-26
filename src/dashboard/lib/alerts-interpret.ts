import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { CADENCES, METRICS, PERIODS, SECTIONS, WEEKDAYS } from '@finance/alerts/catalog.js';

/**
 * Plain English → an alert rule, e.g. "send me a slack notification anytime
 * cash position drops below 30k" → a real-time cash_total < 30000 condition.
 * Claude fills a fixed schema (the same catalog the engine runs), so the
 * result is always one of the alerts the app knows how to check; the Admin
 * page shows it as a form to review before saving.
 */

const MODEL = 'claude-opus-5-5';

const metricKeys = METRICS.map((m) => m.key) as [string, ...string[]];
const sectionKeys = SECTIONS.map((s) => s.key) as [string, ...string[]];

export const InterpretedRule = z.object({
  understood: z.boolean().describe('false when the request is not an alert this app can check'),
  name: z.string().describe('short name for the alert, e.g. "Cash under $30k"'),
  kind: z.enum(['condition', 'summary']),
  cadence: z.enum(CADENCES.map((c) => c.key) as [string, ...string[]]),
  send_time: z.string().nullable().describe('HH:MM, 24-hour, local time; null for real time'),
  weekday: z.number().int().nullable().describe('0 = Sunday … 6 = Saturday, for weekly'),
  month_day: z.number().int().nullable().describe('1-28, for monthly'),
  condition: z
    .object({
      metric: z.enum(metricKeys),
      op: z.enum(['below', 'above']).nullable(),
      threshold: z.number().nullable().describe('dollars, or a count for needs_property'),
      account: z.string().nullable(),
      days: z.number().int().nullable(),
      percent: z.number().nullable(),
      period: z.enum(PERIODS.map((p) => p.key) as [string, ...string[]]).nullable(),
      group: z.string().nullable(),
      category: z.string().nullable(),
      direction: z.enum(['out', 'in', 'any']).nullable(),
      property: z.string().nullable().describe('one property, written exactly as in the property list; null for all'),
      breakdown: z.enum(['property']).nullable().describe('"property" to list the amount for each property'),
      threshold_scope: z.enum(['total', 'each']).nullable().describe('with breakdown: the threshold is for the total, or for any one property'),
    })
    .nullable(),
  include: z.array(z.enum(sectionKeys)).describe('extra sections for the message; required for a summary'),
  channel: z.string().nullable().describe('Slack channel the user named, e.g. "#cash-alerts"; null if none'),
  message: z.string().nullable().describe('a note the user wants at the top of the message, if they asked for one'),
  notes: z.string().describe('one or two sentences: what you assumed, and anything asked for that the app cannot do'),
});
export type InterpretedRule = z.infer<typeof InterpretedRule>;

export interface InterpretContext {
  channels: string[];
  accounts: string[];
  properties: string[];
  groups: { name: string; categories: string[] }[];
  today: string;
}

function systemPrompt(ctx: InterpretContext): string {
  const metrics = METRICS.map((m) => `- ${m.key} (${m.type}${m.params.length ? `; params: ${m.params.join(', ')}` : ''}): ${m.label}. e.g. ${m.example}`).join('\n');
  const sections = SECTIONS.map((s) => `- ${s.key}: ${s.label}`).join('\n');
  return `You turn a landlord's plain-English request into one alert rule for their real-estate and personal-finance tracker. The rule is checked by code, so it must use only the options below.

Cadence: realtime (checked every few minutes and after uploads; use it for "anytime", "as soon as", "whenever", "immediately"), daily, weekly, monthly. A summary can't be realtime. Default send_time 08:00 for scheduled alerts; weekly defaults to Monday (1), monthly to day 1.

kind "condition" watches one metric:
${metrics}
Level metrics need op ("below"/"above") and threshold. For spending / income: "by property", "per property", "for each (investment) property" → breakdown "property" (the message lists each property's amount); the threshold is for the total unless they say any one / a single / each property goes over it (threshold_scope "each"). A named property → property. "Repair spend" means category Repairs; "property costs" or "investment spending" means group Investments. "For a month", "monthly", "each month" → cadence monthly with period last_month (sent on the 1st about the month that just ended), unless they say "this month" or "so far". "drops below 30k" → op below, threshold 30000. For cash_change, a drop of $5k is op below, threshold -5000. large_transaction needs threshold (the minimum absolute amount) and direction (out = money spent, the default; in = deposits; any). Periods: ${PERIODS.map((p) => p.key).join(', ')} (default this_month). Leave unused params null.

kind "summary" sends the sections in include on a schedule ("weekly recap", "daily digest of …").

Sections any message can include:
${sections}
Add sections only when the user asks for more context ("…and include my account balances" → cash_position).

Their Slack channels: ${ctx.channels.length ? ctx.channels.join(', ') : 'none yet'}. If they name a channel, return it as written with a leading #, even if it's not in the list.
Their bank accounts: ${ctx.accounts.length ? ctx.accounts.join(', ') : 'none yet'}. For account_balance, use one of these names.
Their properties: ${ctx.properties.length ? ctx.properties.join('; ') : 'none yet'}.
Spending groups and categories: ${ctx.groups.map((g) => `${g.name} (${g.categories.join(', ')})`).join('; ')}. Use these names exactly for group / category filters.

Today is ${ctx.today}. Set understood=false only when nothing in the request maps to these options; otherwise pick the closest rule and say in notes what you assumed or left out (e.g. email or SMS: only Slack is available).`;
}

export class InterpretError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Ask Claude to map the text onto the catalog. Needs ANTHROPIC_API_KEY (or another SDK credential). */
export async function interpretAlert(text: string, ctx: InterpretContext, client = new Anthropic()): Promise<InterpretedRule> {
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // A short mapping task: low effort keeps it quick.
      output_config: { effort: 'low', format: betaZodOutputFormat(InterpretedRule) },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt(ctx),
      messages: [{ role: 'user', content: text }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new InterpretError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', 503);
    if (err instanceof Anthropic.RateLimitError) throw new InterpretError('The interpreter is busy (rate limited). Try again in a minute.', 429);
    if (err instanceof Anthropic.APIConnectionError) throw new InterpretError('Couldn’t reach the Anthropic API.', 502);
    if (err instanceof Anthropic.APIError) throw new InterpretError(`Anthropic API error ${err.status ?? ''}: ${err.message}`, 502);
    if (err instanceof Error && /api key|apiKey|authToken|credentials/i.test(err.message)) {
      throw new InterpretError('Set ANTHROPIC_API_KEY to describe alerts in plain English, or build the alert with the form.', 503);
    }
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new InterpretError('The request was declined. Try rephrasing it, or use the form.', 422);
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new InterpretError('Couldn’t read the interpreter’s answer. Try again or use the form.', 502);
  return response.parsed_output;
}

/** Turn the interpreted rule into the Admin form's shape (channel by name → id). */
export function toRuleDraft(r: InterpretedRule, channels: { id: number; name: string }[], prompt: string, properties: { id: number; name: string }[] = []) {
  const ch = r.channel ? channels.find((c) => c.name.toLowerCase() === r.channel!.toLowerCase().replace(/^(?!#)/, '#')) : undefined;
  let condition: Record<string, unknown> | null = null;
  if (r.condition) {
    const { property, ...rest } = r.condition;
    condition = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
    if (property) {
      const want = property.toLowerCase().trim();
      const hit = properties.find((p) => p.name.toLowerCase() === want) ?? properties.find((p) => p.name.toLowerCase().includes(want) || want.includes(p.name.toLowerCase()));
      if (hit) condition.property_id = hit.id;
    }
    if (condition.breakdown && !condition.threshold_scope) condition.threshold_scope = 'total';
  }
  return {
    draft: {
      name: r.name,
      prompt,
      kind: r.kind,
      cadence: r.kind === 'summary' && r.cadence === 'realtime' ? 'daily' : r.cadence,
      send_time: r.send_time ?? '08:00',
      weekday: r.weekday ?? (r.cadence === 'weekly' ? 1 : null),
      month_day: r.month_day ?? (r.cadence === 'monthly' ? 1 : null),
      condition,
      include: r.include,
      channel_id: ch?.id ?? null,
      message: r.message,
    },
    understood: r.understood,
    notes: r.notes,
    /** A channel the text named that isn't set up yet. */
    new_channel: r.channel && !ch ? (r.channel.startsWith('#') ? r.channel : `#${r.channel}`) : null,
  };
}
