'use client';

import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { CADENCES, METRICS, PERIODS, SECTIONS, WEEKDAYS } from '@finance/alerts/catalog.js';

interface Channel { id: number; name: string; slack_channel: string | null; is_default: boolean; has_webhook: boolean; webhook_hint: string | null; method: string | null }
interface Condition { metric: string; op?: string; threshold?: number; account?: string; days?: number; percent?: number; period?: string; group?: string; category?: string; direction?: string }
interface Rule {
  id: number; name: string; prompt: string | null; enabled: boolean; kind: 'condition' | 'summary'; cadence: string; send_time: string;
  weekday: number | null; month_day: number | null; timezone: string; condition: Condition | null; include: string[]; message: string | null;
  channel_id: number | null; channel_name: string | null; summary: string; schedule: string; last_sent_at: string | null;
}
interface LogRow { id: number; rule_name: string; channel: string; trigger: string; ok: boolean; error: string | null; text: string; sent_at: string }
interface AdminData {
  rules: Rule[]; channels: Channel[]; log: LogRow[];
  connection: { bot_token: boolean; default_webhook: boolean; interpreter: boolean };
  accounts: string[]; groups: { name: string; categories: string[] }[];
}
type Draft = Omit<Rule, 'id' | 'enabled' | 'channel_name' | 'summary' | 'schedule' | 'last_sent_at' | 'timezone'> & { id?: number; condition: Condition | null };

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm';
const btn = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';
const primary = 'rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
const METHOD: Record<string, string> = { webhook: 'own webhook', bot: 'bot token', default_webhook: 'default webhook' };

const blankDraft = (): Draft => ({
  name: '', prompt: null, kind: 'condition', cadence: 'realtime', send_time: '08:00', weekday: 1, month_day: 1,
  condition: { metric: 'cash_total', op: 'below' }, include: [], message: null, channel_id: null,
});
const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

/**
 * Admin → Notifications: Slack alerts you set up in plain English or with the
 * form. Each alert watches something (cash below a line, a big charge, a lease
 * ending…) or sends a summary, on a cadence, to a Slack channel, with whatever
 * extra sections you pick.
 */
export default function NotificationsPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [interpreting, setInterpreting] = useState(false);
  const [interp, setInterp] = useState<{ understood: boolean; notes: string; new_channel: string | null } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await financeApi.get<AdminData>('/api/admin/alerts'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  async function interpret() {
    setInterpreting(true);
    setError(null);
    setInterp(null);
    try {
      const r = await financeApi.post<{ draft: Draft; understood: boolean; notes: string; new_channel: string | null }>('/api/admin/alerts/interpret', { text });
      setInterp({ understood: r.understood, notes: r.notes, new_channel: r.new_channel });
      setDraft(r.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInterpreting(false);
    }
  }

  if (!data) return <div className="py-12 text-center text-gray-400">{error ?? 'Loading…'}</div>;
  const slackReady = data.connection.bot_token || data.connection.default_webhook || data.channels.some((c) => c.has_webhook);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-gray-500">
          Slack alerts: describe one in plain English or build it with the form. Pick how often it runs, which channel it goes to, and
          what else the message includes. Real-time alerts are checked every few minutes and right after uploads.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          <span>{notice}</span>
          <button className="text-xs text-green-700" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {!slackReady && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Slack isn&apos;t connected yet. Add a channel below with its incoming webhook URL, or set <code>SLACK_BOT_TOKEN</code> (to post to
          any channel by name) or <code>SLACK_WEBHOOK_URL</code> on the server.
        </div>
      )}

      {/* New alert */}
      <section className={`${card} space-y-3 p-4`} data-testid="new-alert">
        <h3 className="font-semibold">New alert</h3>
        <textarea
          aria-label="Describe the alert"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Send me a Slack notification anytime cash position drops below 30k, to #cash-alerts, and include my account balances"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button className={primary} disabled={!text.trim() || interpreting || !data.connection.interpreter} onClick={() => void interpret()}>
            {interpreting ? 'Reading…' : 'Turn into an alert'}
          </button>
          <span className="text-xs text-gray-400">or</span>
          <button className={btn} onClick={() => { setInterp(null); setDraft({ ...blankDraft(), prompt: text.trim() || null }); }}>Build it yourself</button>
          {!data.connection.interpreter && (
            <span className="text-xs text-gray-500">Plain-English alerts need <code>ANTHROPIC_API_KEY</code> on the server; the form works without it.</span>
          )}
        </div>
        {interp && (
          <div className={`rounded-lg px-3 py-2 text-sm ${interp.understood ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`} data-testid="interpret-notes">
            {interp.understood ? 'Here’s the alert I understood — check it below, then save. ' : 'I couldn’t map that to an alert this app can check. '}
            {interp.notes}
            {interp.new_channel && (
              <button
                className="ml-2 rounded-full border border-blue-300 bg-white px-2 py-0.5 text-xs font-medium text-blue-700"
                onClick={() => void act(async () => {
                  const c = await financeApi.post<Channel>('/api/admin/alerts/channels', { name: interp.new_channel });
                  setDraft((d) => (d ? { ...d, channel_id: c.id } : d));
                  setInterp({ ...interp, new_channel: null });
                }, `Added ${interp.new_channel}. Add its webhook below (or use the bot token) so messages can reach it.`)}
              >
                + Add {interp.new_channel}
              </button>
            )}
          </div>
        )}
        {draft && !draft.id && (
          <RuleForm
            draft={draft}
            setDraft={setDraft}
            data={data}
            onCancel={() => { setDraft(null); setInterp(null); }}
            onSaved={async (msg) => { setDraft(null); setInterp(null); setText(''); setNotice(msg); await load(); }}
          />
        )}
      </section>

      {/* Alerts */}
      <section className={card} data-testid="alert-list">
        <div className="border-b border-gray-100 px-4 py-2.5 font-semibold">Alerts</div>
        {data.rules.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">No alerts yet.</p>}
        <ul className="divide-y divide-gray-100">
          {data.rules.map((r) => (
            <li key={r.id} className="px-4 py-3" data-testid={`alert-${r.id}`}>
              <div className="flex flex-wrap items-start gap-3">
                <label className="mt-0.5 inline-flex cursor-pointer items-center">
                  <input type="checkbox" aria-label={`Enabled: ${r.name}`} checked={r.enabled} onChange={() => void act(() => financeApi.patch(`/api/admin/alerts/${r.id}`, { enabled: !r.enabled }))} />
                </label>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${r.enabled ? '' : 'text-gray-400'}`}>{r.name}</div>
                  <div className="text-sm text-gray-600">{r.summary}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-400">
                    <span>⏱ {r.schedule}</span>
                    <span># {r.channel_name ?? 'default webhook'}</span>
                    {r.include.length > 0 && <span>+ {r.include.map((k) => SECTIONS.find((s) => s.key === k)?.label.split(' (')[0] ?? k).join(', ')}</span>}
                    <span>Last sent {when(r.last_sent_at)}</span>
                  </div>
                  {r.prompt && <div className="mt-0.5 text-xs italic text-gray-400">“{r.prompt}”</div>}
                </div>
                <span className="flex shrink-0 gap-1">
                  <button className={btn} onClick={() => setDraft({ ...r })}>Edit</button>
                  <button className={btn} onClick={() => void act(async () => {
                    const t = await financeApi.post<{ channel: string; triggered: boolean }>(`/api/admin/alerts/${r.id}/test`);
                    setNotice(`Test sent to ${t.channel}. ${t.triggered ? 'It would send right now.' : 'Its condition isn’t met right now.'}`);
                  })}>Send test</button>
                  <button className={`${btn} text-red-600`} onClick={() => { if (confirm(`Delete “${r.name}”?`)) void act(() => financeApi.del(`/api/admin/alerts/${r.id}`), 'Alert deleted.'); }}>Delete</button>
                </span>
              </div>
              {draft?.id === r.id && (
                <div className="mt-3">
                  <RuleForm draft={draft} setDraft={setDraft} data={data} onCancel={() => setDraft(null)} onSaved={async (msg) => { setDraft(null); setNotice(msg); await load(); }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Channels data={data} act={act} />

      {/* Recent sends */}
      <section className={card}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <span className="font-semibold">Recent sends</span>
          <button className={btn} onClick={() => void act(async () => {
            const r = await financeApi.post<{ results: { rule: string; sent: boolean; error?: string }[] }>('/api/admin/alerts/run');
            const sent = r.results.filter((x) => x.sent).length;
            setNotice(`Checked ${r.results.length} alert${r.results.length === 1 ? '' : 's'} that were due or real time; ${sent} sent.`);
          })}>Check now</button>
        </div>
        {data.log.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing sent yet.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.log.map((l) => (
              <li key={l.id} className="px-4 py-2">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3">
                    <span className={l.ok ? 'text-green-600' : 'text-red-600'}>{l.ok ? '✓' : '✗'}</span>
                    <span className="text-gray-500">{when(l.sent_at)}</span>
                    <span className="font-medium">{l.rule_name}</span>
                    <span className="text-gray-400">→ {l.channel} · {l.trigger}</span>
                    {l.error && <span className="text-red-600">{l.error}</span>}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{l.text}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The alert form (new or edit), with a live preview of the message. */
function RuleForm({ draft, setDraft, data, onCancel, onSaved }: {
  draft: Draft; setDraft: (d: Draft) => void; data: AdminData; onCancel: () => void; onSaved: (msg: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ text: string; triggered: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const cond = draft.condition ?? { metric: 'cash_total' };
  const setCond = (p: Partial<Condition>) => set({ condition: { ...cond, ...p } });
  const meta = METRICS.find((m) => m.key === cond.metric)!;
  const cats = data.groups.find((g) => g.name === cond.group)?.categories ?? data.groups.flatMap((g) => g.categories);
  const toggleSection = (k: string) => set({ include: draft.include.includes(k) ? draft.include.filter((x) => x !== k) : [...draft.include, k] });
  const body = () => ({ ...draft, condition: draft.kind === 'condition' ? draft.condition : null });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (draft.id) await financeApi.patch(`/api/admin/alerts/${draft.id}`, body());
      else await financeApi.post('/api/admin/alerts', body());
      await onSaved(draft.id ? 'Alert saved.' : `Alert “${draft.name}” created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  async function showPreview() {
    setError(null);
    try {
      setPreview(await financeApi.post('/api/admin/alerts/preview', body()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const pill = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;
  const L = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <label className={`block text-xs text-gray-500 ${className}`}>{children}</label>;

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4" data-testid="rule-form">
      <div className="flex flex-wrap items-end gap-3">
        <L className="min-w-[14rem] flex-1">Name<input aria-label="Alert name" className={`${input} mt-1 block w-full`} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></L>
        <div className="flex gap-1" role="group" aria-label="Alert type">
          <button className={pill(draft.kind === 'condition')} onClick={() => set({ kind: 'condition', condition: draft.condition ?? { metric: 'cash_total', op: 'below' } })}>Alert when…</button>
          <button className={pill(draft.kind === 'summary')} onClick={() => set({ kind: 'summary', cadence: draft.cadence === 'realtime' ? 'daily' : draft.cadence })}>Summary</button>
        </div>
      </div>

      {draft.kind === 'condition' && (
        <div className="flex flex-wrap items-end gap-3" data-testid="condition-fields">
          <L>Watch
            <select aria-label="Metric" className={`${input} mt-1 block`} value={cond.metric} onChange={(e) => setCond({ metric: e.target.value, op: METRICS.find((m) => m.key === e.target.value)?.type === 'level' ? cond.op ?? 'below' : undefined })}>
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </L>
          {meta.params.includes('account') && (
            <L>Account
              <select aria-label="Account" className={`${input} mt-1 block`} value={cond.account ?? ''} onChange={(e) => setCond({ account: e.target.value })}>
                <option value="">Pick…</option>
                {data.accounts.map((a) => <option key={a}>{a}</option>)}
              </select>
            </L>
          )}
          {meta.params.includes('period') && (
            <L>Period
              <select aria-label="Period" className={`${input} mt-1 block`} value={cond.period ?? 'this_month'} onChange={(e) => setCond({ period: e.target.value })}>
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </L>
          )}
          {meta.params.includes('direction') && (
            <L>Which
              <select aria-label="Direction" className={`${input} mt-1 block`} value={cond.direction ?? 'out'} onChange={(e) => setCond({ direction: e.target.value })}>
                <option value="out">Charges (money out)</option>
                <option value="in">Deposits (money in)</option>
                <option value="any">Either</option>
              </select>
            </L>
          )}
          {meta.params.includes('group') && (
            <L>Group
              <select aria-label="Group" className={`${input} mt-1 block`} value={cond.group ?? ''} onChange={(e) => setCond({ group: e.target.value || undefined, category: undefined })}>
                <option value="">Any</option>
                {data.groups.map((g) => <option key={g.name}>{g.name}</option>)}
              </select>
            </L>
          )}
          {meta.params.includes('category') && (
            <L>Category
              <select aria-label="Category" className={`${input} mt-1 block`} value={cond.category ?? ''} onChange={(e) => setCond({ category: e.target.value || undefined })}>
                <option value="">Any</option>
                {cats.map((c) => <option key={c}>{c}</option>)}
              </select>
            </L>
          )}
          {meta.type === 'level' && (
            <L>Is
              <select aria-label="Comparison" className={`${input} mt-1 block`} value={cond.op ?? 'below'} onChange={(e) => setCond({ op: e.target.value })}>
                <option value="below">below</option>
                <option value="above">above</option>
              </select>
            </L>
          )}
          {(meta.type === 'level' || cond.metric === 'large_transaction') && (
            <L>{cond.metric === 'large_transaction' ? 'At least ($)' : meta.unit === 'count' ? 'Count' : 'Amount ($)'}
              <input aria-label="Threshold" type="number" className={`${input} mt-1 block w-32`} value={cond.threshold ?? ''} onChange={(e) => setCond({ threshold: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </L>
          )}
          {meta.params.includes('days') && (
            <L>{cond.metric === 'cash_change' ? 'Over (days)' : cond.metric === 'rent_overdue' ? 'Days late' : 'Within (days)'}
              <input aria-label="Days" type="number" className={`${input} mt-1 block w-24`} value={cond.days ?? ''} placeholder={String(({ cash_change: 7, rent_overdue: 3, lease_expiring: 60, insurance_expiring: 30 } as Record<string, number>)[cond.metric] ?? '')} onChange={(e) => setCond({ days: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </L>
          )}
          {meta.params.includes('percent') && (
            <L>Over by (%)
              <input aria-label="Percent" type="number" className={`${input} mt-1 block w-24`} value={cond.percent ?? ''} placeholder="0" onChange={(e) => setCond({ percent: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </L>
          )}
          <p className="w-full text-xs text-gray-400">
            {meta.type === 'event'
              ? `Each ${cond.metric === 'large_transaction' ? 'new transaction' : 'item'} is sent once.${meta.key === 'large_transaction' ? ' Ones already there when you save aren’t sent.' : ''}`
              : 'Real time sends when it crosses the line, then waits until it clears. Daily / weekly / monthly send a reminder while it’s true.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="block text-xs text-gray-500">How often</span>
          <div className="mt-1 flex gap-1" role="group" aria-label="Cadence">
            {CADENCES.filter((c) => draft.kind === 'condition' || c.key !== 'realtime').map((c) => (
              <button key={c.key} title={c.help} className={pill(draft.cadence === c.key)} onClick={() => set({ cadence: c.key })}>{c.label}</button>
            ))}
          </div>
        </div>
        {draft.cadence === 'weekly' && (
          <L>Day<select aria-label="Weekday" className={`${input} mt-1 block`} value={draft.weekday ?? 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select></L>
        )}
        {draft.cadence === 'monthly' && (
          <L>Day of month<input aria-label="Day of month" type="number" min={1} max={28} className={`${input} mt-1 block w-20`} value={draft.month_day ?? 1} onChange={(e) => set({ month_day: Number(e.target.value) })} /></L>
        )}
        {draft.cadence !== 'realtime' && (
          <L>Time (Eastern)<input aria-label="Time" type="time" className={`${input} mt-1 block`} value={draft.send_time} onChange={(e) => set({ send_time: e.target.value })} /></L>
        )}
        <L>Slack channel
          <select aria-label="Channel" className={`${input} mt-1 block`} value={draft.channel_id ?? ''} onChange={(e) => set({ channel_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Default{data.channels.find((c) => c.is_default) ? ` (${data.channels.find((c) => c.is_default)!.name})` : ''}</option>
            {data.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </L>
      </div>

      <div>
        <span className="block text-xs text-gray-500">{draft.kind === 'summary' ? 'The summary includes' : 'Also include in the message'}</span>
        <div className="mt-1 grid gap-1 sm:grid-cols-2" role="group" aria-label="Include">
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.include.includes(s.key)} onChange={() => toggleSection(s.key)} /> {s.label}
            </label>
          ))}
        </div>
      </div>
      <L>Note at the top of the message (optional)
        <input aria-label="Message note" className={`${input} mt-1 block w-full`} value={draft.message ?? ''} placeholder="e.g. Move money from savings before rent is due." onChange={(e) => set({ message: e.target.value || null })} />
      </L>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? 'Saving…' : draft.id ? 'Save alert' : 'Create alert'}</button>
        <button className={btn} onClick={() => void showPreview()}>Preview message</button>
        <button className={btn} onClick={onCancel}>Cancel</button>
      </div>
      {preview && (
        <div data-testid="preview">
          <p className="mb-1 text-xs text-gray-500">{preview.triggered ? 'This would send right now:' : 'Not true right now. When it is, the message will read like this:'}</p>
          <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-800">{preview.text}</pre>
        </div>
      )}
    </div>
  );
}

/** Slack channels: where alerts go and how they get there. */
function Channels({ data, act }: { data: AdminData; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [hook, setHook] = useState('');
  const [editing, setEditing] = useState<{ id: number; hook: string } | null>(null);
  return (
    <section className={card} data-testid="channels">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <span className="font-semibold">Slack channels</span>
        <p className="mt-0.5 text-xs text-gray-500">
          Each channel needs a way in: its own incoming webhook (Slack → your app → Incoming Webhooks → add one per channel), or the
          bot token (<code>SLACK_BOT_TOKEN</code>{data.connection.bot_token ? ' ✓ set' : ', not set'}) posting by name after you invite the bot.
          Without either, messages go to the default webhook{data.connection.default_webhook ? ' ✓' : ' (not set)'}.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {data.channels.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" data-testid={`channel-${c.name}`}>
            <span className="font-medium">{c.name}</span>
            {c.is_default && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">default</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs ${c.method ? 'bg-gray-100 text-gray-600' : 'bg-red-50 text-red-700'}`}>
              {c.method ? `via ${METHOD[c.method]}${c.webhook_hint ? ` ${c.webhook_hint}` : ''}` : 'not connected'}
            </span>
            <span className="ml-auto flex flex-wrap gap-1">
              {editing?.id === c.id ? (
                <>
                  <input aria-label="Webhook URL" type="password" className={`${input} w-72 text-xs`} placeholder="https://hooks.slack.com/services/…" value={editing.hook} onChange={(e) => setEditing({ ...editing, hook: e.target.value })} />
                  <button className={btn} onClick={() => void act(() => financeApi.patch(`/api/admin/alerts/channels/${c.id}`, { webhook_url: editing.hook }), editing.hook ? 'Webhook saved.' : 'Webhook removed.').then(() => setEditing(null))}>Save</button>
                  <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <button className={btn} onClick={() => setEditing({ id: c.id, hook: '' })}>{c.has_webhook ? 'Change webhook' : 'Add webhook'}</button>
              )}
              {!c.is_default && <button className={btn} onClick={() => void act(() => financeApi.patch(`/api/admin/alerts/channels/${c.id}`, { is_default: true }))}>Make default</button>}
              <button className={btn} onClick={() => void act(async () => { await financeApi.post(`/api/admin/alerts/channels/${c.id}/test`); }, `Test message sent to ${c.name}.`)}>Test</button>
              <button className={`${btn} text-red-600`} onClick={() => { if (confirm(`Remove ${c.name}? Its alerts will go to the default channel.`)) void act(() => financeApi.del(`/api/admin/alerts/channels/${c.id}`)); }}>Remove</button>
            </span>
          </li>
        ))}
        {!data.channels.length && <li className="px-4 py-4 text-center text-sm text-gray-400">No channels yet.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-4 py-3">
        <label className="text-xs text-gray-500">Channel<input aria-label="New channel name" className={`${input} mt-1 block w-44`} placeholder="#cash-alerts" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-xs text-gray-500">Incoming webhook URL (optional)<input aria-label="New channel webhook" type="password" className={`${input} mt-1 block w-80`} placeholder="https://hooks.slack.com/services/…" value={hook} onChange={(e) => setHook(e.target.value)} /></label>
        <button className={primary} disabled={!name.trim()} onClick={() => void act(async () => { await financeApi.post('/api/admin/alerts/channels', { name, webhook_url: hook || undefined }); setName(''); setHook(''); }, 'Channel added.')}>Add channel</button>
      </div>
    </section>
  );
}
