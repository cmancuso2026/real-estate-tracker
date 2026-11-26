// Running alerts: decide which rules are due, evaluate them, write the message,
// send it, and remember what was sent.
//
//   condition, level metric (cash below $30k…):
//     real time  → sent when it becomes true; not again until it clears.
//     scheduled  → sent at its time while it's true.
//   condition, event metric (a large transaction, a lease ending…):
//     each item is sent once (alert_events). Real time sends new items as they
//     appear; scheduled sends the new ones at its time. Metrics marked
//     `baseline` skip what already existed when the alert was created.
//   summary → sent at its time with the sections it includes.
import { METRICS, describeCondition, normalizeRule } from './catalog.js';
import { buildSection, evaluateCondition } from './data.js';
import { localParts, dueSlot } from './schedule.js';
import { sendSlack } from './deliver.js';

const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

/** A rule row with its JSON columns parsed. */
export function hydrate(row) {
  return { ...row, condition: parse(row.condition_json, null), include: parse(row.include_json, []) };
}

/** Today's date in the rule's time zone. */
const todayFor = (rule, now) => localParts(now, rule.timezone || 'America/New_York').date;

/**
 * Evaluate a rule now and write its message (nothing is sent or saved).
 * `seen`: event keys already sent. → { triggered, text, newEvents, value }
 */
export async function composeRule(knex, rule, { now = new Date(), seen = new Set(), force = false, env = process.env } = {}) {
  const today = todayFor(rule, now);
  const lines = [];
  let triggered = rule.kind === 'summary';
  let newEvents = [];
  let value = null;
  if (rule.kind === 'condition' && rule.condition) {
    const r = await evaluateCondition(knex, rule.condition, today);
    value = r.value;
    const meta = METRICS.find((m) => m.key === rule.condition.metric);
    if (meta?.type === 'event') {
      newEvents = (r.events ?? []).filter((e) => !seen.has(e.key));
      triggered = newEvents.length > 0;
      const shown = (force && !newEvents.length ? r.events ?? [] : newEvents).slice(0, 15);
      lines.push(`_${describeCondition(rule.condition)}_`);
      if (shown.length) lines.push(...shown.map((e) => `• ${e.line}`));
      else lines.push('Nothing matches right now.');
      const extra = (force && !newEvents.length ? r.events ?? [] : newEvents).length - shown.length;
      if (extra > 0) lines.push(`…and ${extra} more`);
    } else {
      triggered = r.triggered;
      lines.push(`_${describeCondition(rule.condition)}_`);
      lines.push(r.detail + (r.triggered ? '' : ' (condition not met right now)'));
    }
  }
  const sections = [];
  for (const key of rule.include ?? []) sections.push(await buildSection(knex, key, today));
  const head = `🔔 *${rule.name}*`;
  const link = env.DASHBOARD_URL ? `\n<${env.DASHBOARD_URL.replace(/\/$/, '')}|Open the dashboard>` : '';
  const text = [head, rule.message ? rule.message : null, lines.join('\n') || null, ...sections].filter(Boolean).join('\n\n') + link;
  return { triggered, text, newEvents, value };
}

async function channelFor(knex, rule) {
  if (rule.channel_id) {
    const c = await knex('notification_channels').where({ id: rule.channel_id }).first();
    if (c) return c;
  }
  return (await knex('notification_channels').where({ is_default: true }).first()) ?? null;
}

async function log(knex, rule, channel, trigger, ok, error, text) {
  await knex('alert_log').insert({ rule_id: rule.id ?? null, rule_name: rule.name, channel: channel?.name ?? '(default webhook)', trigger, ok, error: error ?? null, text });
}

async function seenKeys(knex, ruleId) {
  return new Set((await knex('alert_events').where({ rule_id: ruleId }).select('event_key')).map((r) => r.event_key));
}
async function remember(knex, ruleId, events) {
  for (const e of events) await knex('alert_events').insert({ rule_id: ruleId, event_key: e.key }).onConflict(['rule_id', 'event_key']).ignore();
}

/**
 * Check every enabled rule. mode 'tick' (the scheduler, every few minutes)
 * runs real-time and due scheduled rules; mode 'realtime' (right after an
 * upload) runs only real-time rules. → [{ rule, sent, error? }]
 */
export async function runAlerts(knex, { now = new Date(), mode = 'tick', send = sendSlack, env = process.env } = {}) {
  const rules = (await knex('alert_rules').where({ enabled: true }).orderBy('id')).map(hydrate);
  const out = [];
  for (const rule of rules) {
    const slot = mode === 'tick' ? dueSlot(rule, now) : null;
    if (rule.cadence !== 'realtime' && !slot) continue;
    try {
      out.push(await runRule(knex, rule, { now, slot, send, env }));
    } catch (e) {
      out.push({ rule: rule.name, sent: false, error: e.message });
    }
  }
  return out;
}

async function runRule(knex, rule, { now, slot, send, env }) {
  const meta = rule.condition ? METRICS.find((m) => m.key === rule.condition.metric) : null;
  const isEvent = meta?.type === 'event';
  const seen = isEvent ? await seenKeys(knex, rule.id) : new Set();
  const msg = await composeRule(knex, rule, { now, seen, env });
  const patch = { last_checked_at: now };
  if (slot) patch.last_period = slot;

  let shouldSend;
  if (rule.kind === 'summary') shouldSend = true;
  else if (isEvent) {
    // First check of a "new things only" alert: take what's there as already seen.
    if (meta.baseline && !rule.last_checked_at) {
      await remember(knex, rule.id, msg.newEvents);
      shouldSend = false;
    } else shouldSend = msg.newEvents.length > 0;
  } else if (rule.cadence === 'realtime') {
    shouldSend = msg.triggered && rule.last_state !== true;
    patch.last_state = msg.triggered;
  } else shouldSend = msg.triggered;

  let sent = false;
  let error = null;
  if (shouldSend) {
    const channel = await channelFor(knex, rule);
    try {
      await send(channel, msg.text, { env });
      sent = true;
      patch.last_sent_at = now;
      if (isEvent) await remember(knex, rule.id, msg.newEvents);
    } catch (e) {
      error = e.message;
      // try again next time: a failed real-time crossing stays "not sent"
      if ('last_state' in patch) patch.last_state = false;
    }
    await log(knex, rule, channel, slot ? 'schedule' : 'realtime', sent, error, msg.text);
  }
  await knex('alert_rules').where({ id: rule.id }).update(patch);
  return { rule: rule.name, sent, error, triggered: msg.triggered };
}

/**
 * "Send test" from Admin: compose the message as it would read now and send it
 * whether or not the condition is met. Nothing is marked as sent.
 */
export async function sendTest(knex, id, { now = new Date(), send = sendSlack, env = process.env } = {}) {
  const row = await knex('alert_rules').where({ id: Number(id) }).first();
  if (!row) throw Object.assign(new Error(`Alert ${id} not found`), { status: 404 });
  const rule = hydrate(row);
  const msg = await composeRule(knex, rule, { now, force: true, env });
  const channel = await channelFor(knex, rule);
  const text = `🧪 _Test — ${msg.triggered ? 'this would send now' : 'the condition isn’t met right now, so this wouldn’t send yet'}_\n${msg.text}`;
  let error = null;
  try {
    await send(channel, text, { env });
  } catch (e) {
    error = e.message;
  }
  await log(knex, rule, channel, 'test', !error, error, text);
  if (error) throw Object.assign(new Error(error), { status: 502 });
  return { sent: true, channel: channel?.name ?? '(default webhook)', triggered: msg.triggered };
}

/** Preview an unsaved rule from the Admin form. → { text, triggered } */
export async function previewRule(knex, body, { now = new Date(), env = process.env } = {}) {
  const cols = normalizeRule({ ...body, name: body?.name || 'Preview' });
  const msg = await composeRule(knex, hydrate(cols), { now, force: true, env });
  return { text: msg.text, triggered: msg.triggered };
}
