'use client';

import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { useConfirm, type Preview } from '@/components/admin/Confirm';
import type { PropertyOption } from '@/lib/finance-ui/types';

interface Rule {
  id: number;
  pattern: string;
  match_type: 'contains' | 'regex';
  category: string;
  property_id: number | null;
  work_order_id: number | null;
  priority: number;
  enabled: boolean;
  property_name: string | null;
  project_name: string | null;
}
interface Builtin {
  source: string;
  rules: { when: string; category: string; note: string | null }[];
  otherwise: string;
}
interface TestResult {
  steps: { step: string; result: Record<string, unknown> | null }[];
  winner: { from: string; category: string };
}

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm';
const btn = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';
const SOURCES = ['Bank of America', 'Amex Gold', 'Amex Blue', 'SoFi', 'Capital One'];
const EMPTY = { pattern: '', match_type: 'contains', category: '', property_id: '', work_order_id: '', priority: '100' };

export default function AdminMerchantRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [builtin, setBuiltin] = useState<Builtin[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [props, setProps] = useState<PropertyOption[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [tester, setTester] = useState({ description: '', source: 'Bank of America' });
  const [result, setResult] = useState<TestResult | null>(null);
  const { ask, dialog, showError } = useConfirm();

  const load = useCallback(async () => {
    try {
      const [r, b, c, p] = await Promise.all([
        financeApi.get<{ rules: Rule[] }>('/api/admin/merchant-rules'),
        financeApi.get<{ rulesets: Builtin[] }>('/api/admin/merchant-rules/builtin'),
        financeApi.get<{ groups: Record<string, string[]> }>('/api/finance/categories'),
        financeApi.get<{ properties: PropertyOption[] }>('/api/finance/property-options'),
      ]);
      setRules(r.rules);
      setBuiltin(b.rulesets);
      setCats(Object.values(c.groups).flat().sort((x, y) => x.localeCompare(y)));
      setProps(p.properties);
    } catch (err) {
      showError(err);
    }
  }, [showError]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTest() {
    try {
      setResult(await financeApi.post<TestResult>('/api/admin/merchant-rules/test', tester));
    } catch (err) {
      showError(err);
    }
  }
  async function create() {
    try {
      await financeApi.post('/api/admin/merchant-rules', {
        pattern: form.pattern,
        match_type: form.match_type,
        category: form.category,
        property_id: form.property_id ? Number(form.property_id) : null,
        work_order_id: form.work_order_id ? Number(form.work_order_id) : null,
        priority: Number(form.priority || 100),
      });
      setForm(EMPTY);
      await load();
      if (tester.description) await runTest();
    } catch (err) {
      showError(err);
    }
  }
  async function update(r: Rule, patch: Partial<Rule>) {
    try {
      await financeApi.put(`/api/admin/merchant-rules/${r.id}`, patch);
      await load();
    } catch (err) {
      showError(err);
    }
  }
  const formProp = props.find((p) => String(p.id) === form.property_id);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Merchant rules</h2>
        <p className="mt-1 text-sm text-gray-500">
          Your rules run before the built-in ones on every upload and re-categorization. Lower priority numbers run first, and the
          first match wins. A rule with a property also sets the transaction&apos;s property. Your own edits to a transaction always win.
        </p>
      </div>

      <section className={`${card} space-y-3 p-4`}>
        <h3 className="font-semibold">Test a description</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Description to test"
            className={`${input} w-80`}
            placeholder="e.g. HOME DEPOT #6321"
            value={tester.description}
            onChange={(e) => setTester({ ...tester, description: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && void runTest()}
          />
          <select aria-label="Bank" className={input} value={tester.source} onChange={(e) => setTester({ ...tester, source: e.target.value })}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" onClick={() => void runTest()}>
            Test
          </button>
        </div>
        {result && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm" data-testid="test-result">
            <div className="mb-2">
              Winner: <strong>{result.winner.category}</strong> <span className="text-gray-500">({result.winner.from})</span>
            </div>
            <ol className="space-y-1 text-xs">
              {result.steps.map((s, i) => (
                <li key={s.step} className="flex gap-2">
                  <span className="w-28 shrink-0 text-gray-500">
                    {i + 1}. {s.step}
                  </span>
                  <span>
                    {s.result
                      ? `${s.result.category}${s.result.pattern ? ` (rule “${s.result.pattern}”)` : ''}${s.result.confidence != null ? ` (confidence ${Math.round(Number(s.result.confidence) * 100)}%)` : ''}`
                      : 'no match'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="border-b border-gray-100 px-4 py-2.5">
          <h3 className="font-semibold">Your rules ({rules.length})</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
          <input aria-label="Rule pattern" className={`${input} w-48`} placeholder="Pattern" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          <select aria-label="Match type" className={input} value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value })}>
            <option value="contains">contains</option>
            <option value="regex">regex</option>
          </select>
          <select aria-label="Rule category" className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Category…</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Rule property" className={input} value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value, work_order_id: '' })}>
            <option value="">No property</option>
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {formProp && (
            <select aria-label="Rule project" className={input} value={form.work_order_id} onChange={(e) => setForm({ ...form, work_order_id: e.target.value })}>
              <option value="">No project</option>
              {formProp.projects.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <input aria-label="Rule priority" type="number" className={`${input} w-20`} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} title="Lower runs first" />
          <button
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={!form.pattern.trim() || !form.category}
            onClick={() => void create()}
          >
            Add rule
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="rules">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 text-left font-medium">Priority</th>
                <th className="px-2 py-2 text-left font-medium">When the description</th>
                <th className="px-2 py-2 text-left font-medium">Category</th>
                <th className="px-2 py-2 text-left font-medium">Property / project</th>
                <th className="px-2 py-2 text-left font-medium">On</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={`border-t border-gray-100 ${r.enabled ? '' : 'text-gray-400'}`}>
                  <td className="px-4 py-2">
                    <input
                      aria-label={`Priority of ${r.pattern}`}
                      type="number"
                      className={`${input} w-20`}
                      defaultValue={r.priority}
                      onBlur={(e) => Number(e.target.value) !== r.priority && void update(r, { priority: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    {r.match_type === 'regex' ? 'matches ' : 'contains '}
                    <code className="rounded bg-gray-100 px-1">{r.pattern}</code>
                  </td>
                  <td className="px-2 py-2">{r.category}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.property_name ?? '—'}
                    {r.project_name && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">{r.project_name}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <input type="checkbox" aria-label={`Enabled: ${r.pattern}`} checked={r.enabled} onChange={() => void update(r, { enabled: !r.enabled })} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <span className="inline-flex gap-1">
                      <button
                        className={btn}
                        onClick={() =>
                          void ask({
                            title: `Apply “${r.pattern}” → ${r.category} to existing transactions?`,
                            preview: () => financeApi.post<Preview>(`/api/admin/merchant-rules/${r.id}/apply`, { dry_run: true }),
                            run: () => financeApi.post(`/api/admin/merchant-rules/${r.id}/apply`, {}),
                            onDone: load,
                          })
                        }
                      >
                        Apply to existing…
                      </button>
                      <button
                        className={`${btn} text-red-600`}
                        onClick={() =>
                          void ask({
                            title: `Delete rule “${r.pattern}”?`,
                            preview: async () => ({ summary: 'Future uploads stop using this rule. Transactions it already categorized keep their category.' }),
                            run: () => financeApi.del(`/api/admin/merchant-rules/${r.id}`),
                            onDone: load,
                            danger: true,
                          })
                        }
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No rules yet. Built-in rules below still apply.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <div className="border-b border-gray-100 px-4 py-2.5">
          <h3 className="font-semibold">Built-in rules (read-only)</h3>
          <p className="text-xs text-gray-500">
            From lib/categorize.js, checked top to bottom per bank, after your rules and the history vote. First match wins.
          </p>
        </div>
        <div className="divide-y divide-gray-100" data-testid="builtin-rules">
          {builtin.map((b) => (
            <details key={b.source} className="px-4 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {b.source} <span className="font-normal text-gray-400">({b.rules.length} rules)</span>
              </summary>
              <ol className="mt-2 space-y-1 text-xs">
                {b.rules.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-6 shrink-0 text-right text-gray-400">{i + 1}.</span>
                    <span className="flex-1">{r.when}</span>
                    <span className="shrink-0 font-medium">→ {r.category}</span>
                  </li>
                ))}
                <li className="flex gap-2 text-gray-500">
                  <span className="w-6" />
                  <span className="flex-1">anything else</span>
                  <span>→ {b.otherwise}</span>
                </li>
              </ol>
            </details>
          ))}
        </div>
      </section>
      {dialog}
    </div>
  );
}
