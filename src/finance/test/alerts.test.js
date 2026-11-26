// Configurable alerts: rule validation, schedules, real-time crossings,
// one-time events, summaries, test sends and channel handling (pg-mem).
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { normalizeRule, describeCondition, describeSchedule } from '../alerts/catalog.js';
import { dueSlot, localParts } from '../alerts/schedule.js';
import { runAlerts, sendTest, previewRule } from '../alerts/engine.js';
import { createChannel, createRule, getAlertsAdmin, testChannel, updateRule, updateChannel } from '../alerts/service.js';
import { sendSlack } from '../alerts/deliver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/default' };

test('catalog: rule validation and descriptions', () => {
  const r = normalizeRule({ name: 'Low cash', cadence: 'realtime', condition: { metric: 'cash_total', op: 'below', threshold: '30000' } });
  assert.deepEqual(JSON.parse(r.condition_json), { metric: 'cash_total', op: 'below', threshold: 30000 });
  assert.equal(describeCondition(JSON.parse(r.condition_json)), 'Total cash drops below $30,000');
  assert.equal(JSON.parse(normalizeRule({ name: 'x', cadence: 'daily', condition: { metric: 'lease_expiring' } }).condition_json).days, 60);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'hourly', condition: { metric: 'cash_total', op: 'below', threshold: 1 } }), /how often/);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'realtime', kind: 'summary', include: ['cash_position'] }), /schedule/);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'weekly', kind: 'summary', include: [] }), /at least one/);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'daily', condition: { metric: 'cash_total', op: 'below' } }), /threshold/);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'daily', condition: { metric: 'nope' } }), /Unknown metric/);
  assert.throws(() => normalizeRule({ name: 'x', cadence: 'daily', send_time: '8am', condition: { metric: 'lease_expiring' } }), /08:00/);
  assert.equal(describeSchedule({ cadence: 'weekly', weekday: 1, send_time: '07:30' }), 'Weekly on Monday at 07:30');
});

test('schedule: due once per slot, in the rule’s time zone', () => {
  // 2026-11-26 13:05 UTC = 08:05 in New York (EST), a Thursday.
  const now = new Date('2026-11-26T13:05:00Z');
  assert.deepEqual(localParts(now, 'America/New_York'), { date: '2026-11-26', time: '08:05', weekday: 4, day: 26 });
  const daily = { cadence: 'daily', send_time: '08:00', timezone: 'America/New_York' };
  assert.equal(dueSlot(daily, now), '2026-11-26');
  assert.equal(dueSlot({ ...daily, last_period: '2026-11-26' }, now), null);
  assert.equal(dueSlot({ ...daily, send_time: '09:00' }, now), null);
  assert.equal(dueSlot({ ...daily, cadence: 'weekly', weekday: 4 }, now), '2026-11-26');
  assert.equal(dueSlot({ ...daily, cadence: 'weekly', weekday: 1 }, now), null);
  assert.equal(dueSlot({ ...daily, cadence: 'monthly', month_day: 1 }, now), null);
  assert.equal(dueSlot({ ...daily, cadence: 'realtime' }, now), null);
});

test('deliver: webhook, bot token, default, errors', async () => {
  const calls = [];
  const fake = (status, body) => async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  await sendSlack({ name: '#a', webhook_url: 'https://hooks.slack.com/services/X' }, 'hi', { fetchImpl: fake(200, {}), env: {} });
  assert.equal(calls.at(-1).url, 'https://hooks.slack.com/services/X');
  await sendSlack({ name: '#cash' }, 'hi', { fetchImpl: fake(200, { ok: true }), env: { SLACK_BOT_TOKEN: 'xoxb-1' } });
  assert.deepEqual([calls.at(-1).url, calls.at(-1).body.channel, calls.at(-1).auth], ['https://slack.com/api/chat.postMessage', '#cash', 'Bearer xoxb-1']);
  await assert.rejects(sendSlack({ name: '#cash' }, 'hi', { fetchImpl: fake(200, { ok: false, error: 'not_in_channel' }), env: { SLACK_BOT_TOKEN: 'x' } }), /invite it/);
  await assert.rejects(sendSlack(null, 'hi', { fetchImpl: fake(200, {}), env: {} }), /No Slack connection/);
  await sendSlack(null, 'hi', { fetchImpl: fake(200, {}), env: ENV });
  assert.equal(calls.at(-1).url, ENV.SLACK_WEBHOOK_URL);
});

test('engine: crossings, events, summaries, tests (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    const sent = [];
    const send = async (channel, text) => {
      sent.push({ channel: channel?.name ?? null, text });
      return 'webhook';
    };
    const balance = (date, balance, account = 'Checking') => knex('account_balances').insert({ account, date, balance }).onConflict(['account', 'date']).merge();
    await balance('2026-11-20', 42000);
    await balance('2026-11-20', 10000, 'Savings');

    const cash = await createChannel(knex, { name: 'cash-alerts', webhook_url: 'https://hooks.slack.com/services/T/B/cash' }, { env: ENV });
    assert.equal(cash.name, '#cash-alerts');
    assert.equal(cash.is_default, true); // the first channel becomes the default
    assert.equal(cash.has_webhook, true);
    assert.equal(cash.webhook_hint, '…B/cash');
    await assert.rejects(createChannel(knex, { name: '#x', webhook_url: 'https://evil.example/hook' }), /Slack webhook URL/);

    const low = await createRule(knex, { name: 'Cash under 30k', cadence: 'realtime', condition: { metric: 'cash_total', op: 'below', threshold: 30000 }, include: ['cash_position'], channel_id: cash.id });
    const now = new Date('2026-11-26T15:00:00Z');

    // 52k: not below 30k → nothing.
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 0);
    // Drops to 25k → sent once, to #cash-alerts, with the cash section.
    await balance('2026-11-25', 15000);
    await runAlerts(knex, { now, send, env: ENV, mode: 'realtime' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, '#cash-alerts');
    assert.match(sent[0].text, /Cash under 30k/);
    assert.match(sent[0].text, /Total cash is \*\$25,000\*/);
    assert.match(sent[0].text, /\*Cash position\*\n• Total \*\$25,000\*/);
    // Still below → not again.
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 1);
    // Recovers, then drops again → sent again.
    await balance('2026-11-25', 40000);
    await runAlerts(knex, { now, send, env: ENV });
    await balance('2026-11-25', 12000);
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 2);

    // Large transactions: existing ones are the baseline; only new ones are sent, each once.
    const txn = (d, amount, date = '2026-11-24') => ({ date, description: d, amount, source: 'Bank of America', category: 'Repairs', category_group: 'Investments', dedup_hash: d });
    await knex('transactions').insert(txn('OLD ROOFER', -3000));
    await createRule(knex, { name: 'Big charges', cadence: 'realtime', condition: { metric: 'large_transaction', threshold: 1000 } });
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 2, 'baseline: the old charge is not sent');
    await knex('transactions').insert([txn('NEW PLUMBER', -1500, '2026-11-26'), txn('COFFEE', -5, '2026-11-26')]);
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 3);
    assert.match(sent[2].text, /NEW PLUMBER/);
    assert.doesNotMatch(sent[2].text, /OLD ROOFER|COFFEE/);
    assert.equal(sent[2].channel, '#cash-alerts', 'no channel picked → the default channel');
    await runAlerts(knex, { now, send, env: ENV });
    assert.equal(sent.length, 3, 'each charge once');

    // A weekly summary: sends at its time on its day, once.
    const summary = await createRule(knex, { name: 'Weekly money', kind: 'summary', cadence: 'weekly', weekday: 4, send_time: '09:00', include: ['cash_position', 'month_to_date', 'top_transactions'] });
    await runAlerts(knex, { now: new Date('2026-11-26T13:30:00Z'), send, env: ENV }); // 08:30 New York
    assert.equal(sent.length, 3);
    await runAlerts(knex, { now: new Date('2026-11-26T14:05:00Z'), send, env: ENV }); // 09:05
    assert.equal(sent.length, 4);
    assert.match(sent[3].text, /Weekly money/);
    assert.match(sent[3].text, /This month so far/);
    assert.match(sent[3].text, /NEW PLUMBER · -\$1,500/);
    await runAlerts(knex, { now: new Date('2026-11-26T14:10:00Z'), send, env: ENV });
    assert.equal(sent.length, 4, 'once per slot');

    // Scheduled level condition: daily reminder while true.
    await createRule(knex, { name: 'Daily low cash', cadence: 'daily', send_time: '07:00', condition: { metric: 'cash_total', op: 'below', threshold: 30000 } });
    await runAlerts(knex, { now: new Date('2026-11-27T12:30:00Z'), send, env: ENV }); // 07:30 NY next day
    assert.equal(sent.filter((s) => /Daily low cash/.test(s.text)).length, 1);

    // Disabled rules don't run; a failed send is logged and retried.
    await updateRule(knex, { id: summary.id }, { enabled: false });
    const failing = async () => { throw new Error('Slack webhook failed: HTTP 404'); };
    await balance('2026-11-25', 50000);
    await runAlerts(knex, { now, send, env: ENV });
    await balance('2026-11-25', 1000);
    const res = await runAlerts(knex, { now, send: failing, env: ENV });
    assert.equal(res.find((r) => r.rule === 'Cash under 30k').error, 'Slack webhook failed: HTTP 404');
    await runAlerts(knex, { now, send, env: ENV });
    assert.match(sent.at(-1).text, /Total cash is \*\$11,000\*/, 'retried after the failure');
    const failed = await knex('alert_log').where({ ok: false }).first();
    assert.equal(failed.error, 'Slack webhook failed: HTTP 404');

    // Test send: says whether it would fire, marks nothing as sent.
    const t = await sendTest(knex, low.id, { now, send, env: ENV });
    assert.equal(t.triggered, true);
    assert.match(sent.at(-1).text, /Test — this would send now/);
    // Preview an unsaved rule.
    const pv = await previewRule(knex, { cadence: 'daily', condition: { metric: 'cash_total', op: 'above', threshold: 100000 } }, { now, env: ENV });
    assert.equal(pv.triggered, false);
    assert.match(pv.text, /condition not met right now/);

    // Changing what a rule watches forgets what was sent.
    const big = await knex('alert_rules').where({ name: 'Big charges' }).first();
    await updateRule(knex, { id: big.id }, { condition: { metric: 'large_transaction', threshold: 2000 } });
    assert.equal(Number((await knex('alert_events').where({ rule_id: big.id }).count({ c: '*' }).first()).c), 0);

    // Admin data never includes webhook URLs.
    const admin = await getAlertsAdmin(knex, { env: ENV });
    assert.ok(!JSON.stringify(admin).includes('hooks.slack.com'));
    assert.equal(admin.rules.find((r) => r.id === low.id).channel_name, '#cash-alerts');
    assert.equal(admin.rules.find((r) => r.id === low.id).summary, 'Total cash drops below $30,000');
    assert.deepEqual(admin.accounts.sort(), ['Checking', 'Savings']);
    // Removing a webhook: '' clears it.
    const cleared = await updateChannel(knex, { id: cash.id }, { webhook_url: '' }, { env: ENV });
    assert.equal(cleared.has_webhook, false);
    assert.equal(cleared.method, 'default_webhook');
    assert.deepEqual(await testChannel(knex, { id: cash.id }, { send, env: ENV }), { sent: true, method: 'webhook' });
  } finally {
    await knex.destroy();
  }
});
