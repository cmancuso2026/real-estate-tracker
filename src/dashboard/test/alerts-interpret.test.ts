// The plain-English interpreter: what it sends to Claude, how the answer
// becomes a form draft, and its errors. Uses a stub client (no network).
import test from 'node:test';
import assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import { interpretAlert, InterpretError, toRuleDraft, type InterpretedRule } from '../lib/alerts-interpret';
import { normalizeRule } from '@finance/alerts/catalog.js';

const CTX = { channels: ['#cash-alerts'], accounts: ['Checking', 'Savings'], groups: [{ name: 'Food', categories: ['Groceries'] }], today: '2026-11-26' };

const answer: InterpretedRule = {
  understood: true,
  name: 'Cash under $30k',
  kind: 'condition',
  cadence: 'realtime',
  send_time: null,
  weekday: null,
  month_day: null,
  condition: { metric: 'cash_total', op: 'below', threshold: 30000, account: null, days: null, percent: null, period: null, group: null, category: null, direction: null },
  include: ['cash_position'],
  channel: '#cash-alerts',
  message: null,
  notes: 'Checks total cash across all accounts.',
};

function stub(result: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { parse: async (params: Record<string, unknown>) => { calls.push(params); if (result instanceof Error) throw result; return result; } } } };
  return { client: client as unknown as Anthropic, calls };
}

test('interpret: request shape and result', async () => {
  const { client, calls } = stub({ stop_reason: 'end_turn', parsed_output: answer });
  const r = await interpretAlert('send me a slack notification anytime cash position drops below 30k', CTX, client);
  assert.deepEqual(r, answer);
  const p = calls[0]!;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  const oc = p.output_config as { effort: string; format: { type: string } };
  assert.equal(oc.effort, 'low');
  assert.equal(oc.format.type, 'json_schema');
  assert.match(String(p.system), /#cash-alerts/);
  assert.match(String(p.system), /Checking, Savings/);
  assert.match(String(p.system), /cash_total/);
});

test('interpret: draft maps the channel and validates as a rule', () => {
  const d = toRuleDraft(answer, [{ id: 7, name: '#cash-alerts' }], 'cash below 30k');
  assert.equal(d.draft.channel_id, 7);
  assert.equal(d.new_channel, null);
  assert.deepEqual(d.draft.condition, { metric: 'cash_total', op: 'below', threshold: 30000 });
  // The draft passes the same validation as a hand-made rule.
  assert.equal(JSON.parse(normalizeRule(d.draft).condition_json!).threshold, 30000);
  // A channel that isn't set up yet is reported, without a channel id.
  const other = toRuleDraft({ ...answer, channel: 'money' }, [{ id: 7, name: '#cash-alerts' }], 'x');
  assert.deepEqual([other.draft.channel_id, other.new_channel], [null, '#money']);
  // A summary can't be real time: falls back to daily.
  const s = toRuleDraft({ ...answer, kind: 'summary', condition: null, cadence: 'realtime' }, [], 'x');
  assert.equal(s.draft.cadence, 'daily');
});

test('interpret: refusals and API errors', async () => {
  await assert.rejects(interpretAlert('x', CTX, stub({ stop_reason: 'refusal', parsed_output: null }).client), (e: unknown) => e instanceof InterpretError && e.status === 422);
  await assert.rejects(interpretAlert('x', CTX, stub({ stop_reason: 'end_turn', parsed_output: null }).client), /Couldn’t read/);
  const auth = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers());
  await assert.rejects(interpretAlert('x', CTX, stub(auth).client), (e: unknown) => e instanceof InterpretError && e.status === 503 && /ANTHROPIC_API_KEY/.test(e.message));
});
