// Admin → Notifications: rules and Slack channels (the logic behind
// /api/admin/alerts…). Webhook URLs are secrets: they're stored, never sent
// back to the browser (only whether one is set and its last characters).
import { describeCondition, describeSchedule, normalizeRule } from './catalog.js';
import { deliveryMethod, sendSlack } from './deliver.js';
import { hydrate } from './engine.js';
import { getBalances } from '../lib/balances.js';
import { loadTaxonomy } from '../lib/categories.js';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
const WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/\S+$/;

function publicChannel(c, env) {
  return {
    id: c.id,
    name: c.name,
    slack_channel: c.slack_channel,
    is_default: !!c.is_default,
    has_webhook: !!c.webhook_url,
    webhook_hint: c.webhook_url ? `…${c.webhook_url.slice(-6)}` : null,
    method: deliveryMethod(c, env),
  };
}

// GET /api/admin/alerts → everything the Admin page needs.
export async function getAlertsAdmin(knex, { env = process.env } = {}) {
  const [rules, channels, log, balances, tax] = await Promise.all([
    knex('alert_rules').orderBy('id'),
    knex('notification_channels').orderBy('name'),
    knex('alert_log').orderBy('id', 'desc').limit(30),
    getBalances(knex),
    loadTaxonomy(knex),
  ]);
  const chName = new Map(channels.map((c) => [c.id, c.name]));
  const def = channels.find((c) => c.is_default);
  return {
    rules: rules.map((r) => {
      const h = hydrate(r);
      return {
        ...h,
        condition_json: undefined,
        include_json: undefined,
        summary: h.kind === 'summary' ? `Summary: ${h.include.length} section${h.include.length === 1 ? '' : 's'}` : describeCondition(h.condition),
        schedule: describeSchedule(h),
        channel_name: h.channel_id ? chName.get(h.channel_id) ?? null : def?.name ?? null,
      };
    }),
    channels: channels.map((c) => publicChannel(c, env)),
    log,
    connection: {
      bot_token: !!env.SLACK_BOT_TOKEN,
      default_webhook: !!env.SLACK_WEBHOOK_URL,
      interpreter: !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    },
    accounts: balances.accounts.map((a) => a.account),
    groups: tax.groups.map((g) => ({ name: g.name, categories: g.categories.filter((c) => !c.archived).map((c) => c.name) })),
  };
}

async function checkChannel(knex, id) {
  if (id == null) return;
  if (!(await knex('notification_channels').where({ id }).first())) throw httpError(400, `Channel ${id} not found`);
}

// POST /api/admin/alerts — create a rule.
export async function createRule(knex, body) {
  const cols = normalizeRule(body);
  await checkChannel(knex, cols.channel_id);
  const [row] = await knex('alert_rules').insert(cols).returning('*');
  return hydrate(row);
}

// PATCH /api/admin/alerts/:id — the whole rule, or just { enabled }.
export async function updateRule(knex, params, body) {
  const id = Number(params.id);
  const cur = await knex('alert_rules').where({ id }).first();
  if (!cur) throw httpError(404, `Alert ${id} not found`);
  if (body && Object.keys(body).length === 1 && 'enabled' in body) {
    await knex('alert_rules').where({ id }).update({ enabled: !!body.enabled, updated_at: knex.fn.now() });
  } else {
    const cols = normalizeRule({ ...hydrate(cur), ...body });
    await checkChannel(knex, cols.channel_id);
    const patch = { ...cols, updated_at: knex.fn.now() };
    // What it watches changed: start fresh (re-arm, forget what was sent).
    if (cols.condition_json !== cur.condition_json || cols.kind !== cur.kind) {
      Object.assign(patch, { last_state: null, last_checked_at: null });
      await knex('alert_events').where({ rule_id: id }).del();
    }
    if (cols.cadence !== cur.cadence || cols.send_time !== cur.send_time || cols.weekday !== cur.weekday || cols.month_day !== cur.month_day) patch.last_period = null;
    await knex('alert_rules').where({ id }).update(patch);
  }
  return hydrate(await knex('alert_rules').where({ id }).first());
}

// DELETE /api/admin/alerts/:id
export async function deleteRule(knex, params) {
  const n = await knex('alert_rules').where({ id: Number(params.id) }).del();
  if (!n) throw httpError(404, `Alert ${params.id} not found`);
  return { deleted: true };
}

function channelCols(body, { partial = false } = {}) {
  const out = {};
  if (!partial || 'name' in body) {
    let name = String(body.name ?? '').trim();
    if (!name) throw httpError(400, 'Give the channel a name, e.g. #cash-alerts');
    if (!name.startsWith('#') && !/^[CG][A-Z0-9]{6,}$/.test(name)) name = `#${name}`;
    out.name = name.slice(0, 80);
  }
  if ('slack_channel' in body) out.slack_channel = body.slack_channel ? String(body.slack_channel).trim() : null;
  if ('webhook_url' in body && body.webhook_url !== undefined) {
    const url = body.webhook_url ? String(body.webhook_url).trim() : null;
    if (url && !WEBHOOK.test(url)) throw httpError(400, 'That doesn’t look like a Slack webhook URL (https://hooks.slack.com/services/…)');
    out.webhook_url = url;
  }
  if ('is_default' in body) out.is_default = !!body.is_default;
  return out;
}

// POST /api/admin/alerts/channels
export async function createChannel(knex, body, { env = process.env } = {}) {
  const cols = channelCols(body ?? {});
  if (await knex('notification_channels').where({ name: cols.name }).first()) throw httpError(400, `${cols.name} already exists`);
  const first = !(await knex('notification_channels').first());
  if (cols.is_default || first) {
    await knex('notification_channels').update({ is_default: false });
    cols.is_default = true;
  }
  const [row] = await knex('notification_channels').insert(cols).returning('*');
  return publicChannel(row, env);
}

// PATCH /api/admin/alerts/channels/:id — webhook_url: '' removes it; leaving it out keeps it.
export async function updateChannel(knex, params, body, { env = process.env } = {}) {
  const id = Number(params.id);
  if (!(await knex('notification_channels').where({ id }).first())) throw httpError(404, `Channel ${id} not found`);
  const cols = channelCols(body ?? {}, { partial: true });
  if (cols.name && (await knex('notification_channels').where({ name: cols.name }).whereNot({ id }).first())) throw httpError(400, `${cols.name} already exists`);
  if (cols.is_default) await knex('notification_channels').update({ is_default: false });
  if (Object.keys(cols).length) await knex('notification_channels').where({ id }).update(cols);
  return publicChannel(await knex('notification_channels').where({ id }).first(), env);
}

// DELETE /api/admin/alerts/channels/:id — its alerts go to the default channel.
export async function deleteChannel(knex, params) {
  const id = Number(params.id);
  const n = await knex('notification_channels').where({ id }).del();
  if (!n) throw httpError(404, `Channel ${id} not found`);
  return { deleted: true };
}

// POST /api/admin/alerts/channels/:id/test — post a hello message.
export async function testChannel(knex, params, { send = sendSlack, env = process.env } = {}) {
  const c = await knex('notification_channels').where({ id: Number(params.id) }).first();
  if (!c) throw httpError(404, `Channel ${params.id} not found`);
  try {
    const method = await send(c, `✅ Test from the real estate tracker: alerts for ${c.name} will arrive here.`, { env });
    return { sent: true, method };
  } catch (e) {
    throw httpError(502, e.message);
  }
}
