'use client';

import { useCallback, useEffect, useState } from 'react';
import { TradePicker, TradePills } from './TradePicker';
import { ProjectTxnPicker, type CandidateTxn } from './ProjectTxnPicker';
import { useTrades } from '@/lib/useTrades';
import { describeRecurring, type Frequency } from '@/lib/recurring';

// ── Types ───────────────────────────────────────────────────────────────────
interface UnitLite { id: number; unit_label: string; }
interface AssignedUnit { unit_id: number; unit_label: string; cost_share: number | string | null; }
interface RecurringRow {
  id: number; description: string; frequency: Frequency; amount: number | string;
  monthly_amount: number | string; start_date: string | null; end_date: string | null; is_active: boolean;
}
interface Quote {
  id: number; vendor_id: number; vendor_name: string; vendor_trade: string | null;
  quoted_cost: number | string | null; final_cost: number | string | null;
  is_selected: boolean; notes: string | null;
}
interface Project {
  id: number;
  project_name: string | null;
  description: string | null;
  property_id: number;
  status: ProjectStatus;
  is_recurring: boolean;
  trades?: string[];
  rating?: number | null;
  recurring?: RecurringRow[];
  /** Starting cost (whole dollars), e.g. set when a project is created from a transaction. */
  quoted_cost?: number | string | null;
  created_at: string;
  updated_at: string | null;
  units: AssignedUnit[];
  quotes: Quote[];
}
interface VendorOption { id: number; name: string; trade: string; }
interface VendorQuoteExtracted {
  vendor_name: string | null; vendor_phone: string | null; vendor_email: string | null;
  trade: string | null; project_name: string | null; quoted_cost: number | null;
  scope_of_work: string | null; quote_date: string | null; confidence_notes: string | null;
}

type ProjectStatus = 'received' | 'open' | 'completed';

const STATUSES: ProjectStatus[] = ['received', 'open', 'completed'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
function num(n: number | string | null | undefined): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function fmt$(n: number | string | null | undefined) {
  if (n == null || n === '') return '—';
  return '$' + num(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
const projName = (p: Project) => p.project_name || p.description || 'Untitled Project';
const selectedQuote = (p: Project) => p.quotes.find(q => q.is_selected) ?? null;
const quoteCost = (q: Quote | null) => (q ? (q.final_cost ?? q.quoted_cost) : null);

/** Actual spend from linked finance transactions vs. the selected quote (or starting cost). */
interface ActualSpend { actual_spend: number; transaction_count: number; }
function SpendVsQuote({ project, actual }: { project: Project; actual?: ActualSpend }) {
  const sel = selectedQuote(project);
  const budget = sel ? quoteCost(sel) : project.quoted_cost ?? null;
  const budgetLabel = sel ? 'Quote' : 'Starting cost';
  const spent = actual?.actual_spend ?? 0;
  const diff = budget != null && budget !== '' ? spent - num(budget) : null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid={`project-spend-${project.id}`}>
      {budget != null && budget !== '' && <span className="text-gray-500">{budgetLabel} {fmt$(budget)}</span>}
      <span className="font-medium text-gray-700">Actual {fmt$(spent)}</span>
      {actual && diff != null && Math.abs(diff) >= 0.005 && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${diff > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {diff > 0 ? 'Over' : 'Under'} by {fmt$(Math.abs(diff))}
        </span>
      )}
      {actual ? (
        <a href={`/finance/transactions?project=${project.id}`} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
          {actual.transaction_count} transaction{actual.transaction_count === 1 ? '' : 's'} →
        </a>
      ) : (
        <span className="text-gray-400">No linked transactions</span>
      )}
    </span>
  );
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  received: 'bg-gray-100 text-gray-600',
  open: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};
function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? STATUS_BADGE.received}`}>{capitalize(status)}</span>;
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
    </div>
  );
}

async function sendJson<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Link transactions to a project; returns a note about any that were skipped. */
async function linkTxns(projectId: number, ids: number[]): Promise<string | null> {
  if (!ids.length) return null;
  const r = await sendJson<{ skipped: { description: string; reason: string }[] }>(`/api/finance/projects/${projectId}/transactions`, 'POST', { ids });
  return r.skipped.length ? `Not linked: ${r.skipped.map((x) => `${x.description} (${x.reason.toLowerCase()})`).join(', ')}` : null;
}

// ── Recurring cost form (monthly / yearly, amount, start / end) ─────────────────
interface RecurringDraft { frequency: Frequency; amount: string; start: string; end: string; description: string; }
const emptyRecurring = (): RecurringDraft => ({ frequency: 'monthly', amount: '', start: new Date().toISOString().slice(0, 10), end: '', description: '' });
function RecurringFields({ draft, setDraft, placeholder }: { draft: RecurringDraft; setDraft: (d: RecurringDraft) => void; placeholder: string }) {
  const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="recurring-fields">
      <label className="col-span-2 text-xs text-gray-500 sm:col-span-5">
        Description
        <input className={`${input} mt-1 block w-full`} value={draft.description} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <label className="text-xs text-gray-500">
        Frequency
        <select aria-label="Frequency" className={`${input} mt-1 block w-full`} value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as Frequency })}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Amount ($ {draft.frequency === 'yearly' ? 'per year' : 'per month'})
        <input aria-label="Recurring amount" type="number" min="0" step="0.01" className={`${input} mt-1 block w-full`} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      </label>
      <label className="text-xs text-gray-500">
        Start date
        <input aria-label="Start date" type="date" className={`${input} mt-1 block w-full`} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
      </label>
      <label className="text-xs text-gray-500">
        End date <span className="text-gray-400">(optional)</span>
        <input aria-label="End date" type="date" className={`${input} mt-1 block w-full`} value={draft.end} min={draft.start || undefined} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
      </label>
      {draft.frequency === 'yearly' && draft.amount && (
        <p className="self-end pb-2 text-xs text-gray-400">≈ {fmt$(Math.round((Number(draft.amount) / 12) * 100) / 100)} / month in cash flow</p>
      )}
    </div>
  );
}
const recurringBody = (d: RecurringDraft, fallbackName: string) => ({
  description: d.description.trim() || fallbackName, frequency: d.frequency, amount: parseFloat(d.amount),
  start_date: d.start || null, end_date: d.end || null,
});

function StarInput({ value, onChange, label }: { value: number | null | undefined; onChange: (n: number | null) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(value === n ? null : n); }}
          className={`text-lg leading-none ${value && n <= value ? 'text-amber-500' : 'text-gray-300 hover:text-amber-300'}`}>★</button>
      ))}
    </span>
  );
}

// ── Vendor import (side-by-side confirmation) ───────────────────────────────────
function VendorImport({ vendors, prefillProjectName, onCancel, onConfirm, onVendorCreated }: {
  vendors: VendorOption[];
  prefillProjectName?: string;
  onCancel: () => void;
  onConfirm: (result: { vendor_id: number; quoted_cost: number | null; notes: string | null }) => Promise<void> | void;
  onVendorCreated: () => void;
}) {
  const { trades, label: tradeLabel } = useTrades();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [extracted, setExtracted] = useState<VendorQuoteExtracted | null>(null);
  const [createVendor, setCreateVendor] = useState(true);
  const [matchedVendorId, setMatchedVendorId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function applyExtraction(data: VendorQuoteExtracted) {
    setExtracted(data);
    const match = data.vendor_name
      ? vendors.find(v => v.name.toLowerCase().trim() === data.vendor_name!.toLowerCase().trim())
      : undefined;
    if (match) { setMatchedVendorId(String(match.id)); setCreateVendor(false); }
    else { setMatchedVendorId(''); setCreateVendor(true); }
  }

  async function send(form: FormData) {
    setParsing(true); setError('');
    try {
      const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Parse failed'); return; }
      applyExtraction(data.extracted as VendorQuoteExtracted);
    } catch { setError('Upload error'); }
    finally { setParsing(false); }
  }
  function handleFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file.type === 'application/pdf' ? URL.createObjectURL(file) : null);
    const form = new FormData(); form.append('file', file); form.append('type', 'vendor_quote');
    send(form);
  }
  function parsePastedText() {
    if (!pastedText.trim()) return;
    setPreviewUrl(null);
    const form = new FormData(); form.append('text', pastedText); form.append('type', 'vendor_quote');
    send(form);
  }
  function patch(p: Partial<VendorQuoteExtracted>) { setExtracted(prev => (prev ? { ...prev, ...p } : prev)); }

  async function confirm() {
    if (!extracted || saving) return;
    setSaving(true);
    try {
      let vendorId: number | null;
      if (createVendor) {
        const res = await fetch('/api/v2/vendors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: extracted.vendor_name ?? 'Unknown Vendor', trades: [extracted.trade ?? 'general'],
            phone: extracted.vendor_phone ?? null, email: extracted.vendor_email ?? null,
          }),
        });
        const v = await res.json();
        vendorId = v?.id ?? null;
        onVendorCreated();
      } else {
        vendorId = matchedVendorId ? parseInt(matchedVendorId) : null;
      }
      if (!vendorId) { setError('Select or create a vendor'); setSaving(false); return; }
      await onConfirm({ vendor_id: vendorId, quoted_cost: extracted.quoted_cost ?? null, notes: extracted.scope_of_work ?? null });
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-blue-800">Import Quote from PDF / Email</h3>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      {!extracted ? (
        <div className="space-y-3">
          <label className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-blue-300 px-4 py-8 text-sm text-blue-600 hover:bg-blue-100/50 ${parsing ? 'opacity-50' : ''}`}>
            {parsing ? 'Parsing…' : 'Drop a quote, invoice, or email (PDF / .eml / .txt)'}
            <input type="file" accept=".pdf,.eml,.txt,image/*" className="hidden" disabled={parsing}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
          <div className="text-center text-xs text-gray-400">or paste email/quote text here</div>
          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={4}
            placeholder="Paste the contractor email or quote text…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          <button onClick={parsePastedText} disabled={parsing || !pastedText.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {parsing ? 'Parsing…' : 'Parse'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* LEFT: source preview */}
          <div className="min-h-[300px] overflow-hidden rounded-lg border border-gray-200 bg-white">
            {previewUrl
              ? <iframe src={previewUrl} className="h-[500px] w-full" title="Quote preview" />
              : <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-600">{pastedText || 'No preview available'}</pre>}
          </div>

          {/* RIGHT: editable extracted fields */}
          <div className="space-y-3">
            {extracted.confidence_notes && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠ {extracted.confidence_notes}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor Name" value={extracted.vendor_name ?? ''} onChange={v => patch({ vendor_name: v })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Trade</label>
                <select value={extracted.trade ?? 'general'} onChange={e => patch({ trade: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  {trades.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <Field label="Phone" value={extracted.vendor_phone ?? ''} onChange={v => patch({ vendor_phone: v })} />
              <Field label="Email" value={extracted.vendor_email ?? ''} onChange={v => patch({ vendor_email: v })} />
              <Field label="Project Name" value={extracted.project_name ?? prefillProjectName ?? ''} onChange={v => patch({ project_name: v })} />
              <Field label="Quoted Cost ($)" type="number" value={extracted.quoted_cost?.toString() ?? ''} onChange={v => patch({ quoted_cost: v ? parseFloat(v) : null })} />
              <Field label="Quote Date" type="date" value={extracted.quote_date ?? ''} onChange={v => patch({ quote_date: v })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Scope of Work</label>
              <textarea value={extracted.scope_of_work ?? ''} onChange={e => patch({ scope_of_work: e.target.value })} rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createVendor} onChange={e => setCreateVendor(e.target.checked)} />
              Create new vendor record
            </label>
            {!createVendor && (
              <select value={matchedVendorId} onChange={e => setMatchedVendorId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">Select existing vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({tradeLabel(v.trade)})</option>)}
              </select>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={confirm} disabled={saving || (!createVendor && !matchedVendorId)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm & Add Quote'}
              </button>
              <button onClick={() => { setExtracted(null); setError(''); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Re-upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Unit assignment editor (checkboxes + cost split) ────────────────────────────
interface UnitDraft { checked: boolean; share: string; }
function UnitAssigner({ units, draft, setDraft }: {
  units: UnitLite[]; draft: Record<number, UnitDraft>; setDraft: (d: Record<number, UnitDraft>) => void;
}) {
  const toggle = (uid: number) => setDraft({ ...draft, [uid]: { checked: !draft[uid]?.checked, share: draft[uid]?.share ?? '' } });
  const setShare = (uid: number, share: string) => setDraft({ ...draft, [uid]: { checked: draft[uid]?.checked ?? true, share } });
  const splitEvenly = () => {
    const checked = units.filter(u => draft[u.id]?.checked);
    if (checked.length === 0) return;
    const share = (100 / checked.length).toFixed(2);
    const next = { ...draft };
    for (const u of units) next[u.id] = { checked: draft[u.id]?.checked ?? false, share: draft[u.id]?.checked ? share : (draft[u.id]?.share ?? '') };
    setDraft(next);
  };
  return (
    <div className="space-y-2">
      {units.map(u => (
        <div key={u.id} className="flex items-center gap-3 text-sm">
          <label className="flex flex-1 items-center gap-2">
            <input type="checkbox" checked={draft[u.id]?.checked ?? false} onChange={() => toggle(u.id)} />
            Unit {u.unit_label}
          </label>
          {draft[u.id]?.checked && (
            <div className="flex items-center gap-1">
              <input type="number" value={draft[u.id]?.share ?? ''} onChange={e => setShare(u.id, e.target.value)}
                placeholder="even" min="0" max="100"
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          )}
        </div>
      ))}
      {units.length === 0 && <p className="text-xs text-gray-400">No units on this property.</p>}
      {units.length > 0 && <button type="button" onClick={splitEvenly} className="text-xs text-blue-600 hover:underline">Split evenly</button>}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
/** Arriving from Finance → "New project": the transaction to start from. */
export interface NewProjectSeed { txnId?: number; name?: string; amount?: number; date?: string; }

export function ProjectsTab({ id, units, seed, focusProjectId }: { id: string; units: UnitLite[]; seed?: NewProjectSeed | null; focusProjectId?: number | null }) {
  const { label: tradeLabel } = useTrades();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(focusProjectId ?? null);
  const [showNew, setShowNew] = useState(!!seed);
  const [notice, setNotice] = useState<string | null>(null);
  const [actuals, setActuals] = useState<Record<number, ActualSpend>>({});

  const loadProjects = useCallback(async () => {
    const res = await fetch(`/api/v2/work-orders?propertyId=${id}`);
    const d = await res.json();
    setProjects(Array.isArray(d) ? d : []);
    // Actual spend per project from linked finance transactions (optional: an
    // error just leaves the column empty).
    const a = await fetch(`/api/finance/rollups/projects?propertyId=${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setActuals(a?.projects ?? {});
  }, [id]);
  const loadVendors = useCallback(async () => {
    const res = await fetch('/api/v2/vendors');
    const d = await res.json();
    setVendors(Array.isArray(d) ? d.map((v: VendorOption) => ({ id: v.id, name: v.name, trade: v.trade })) : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadProjects(), loadVendors()]).finally(() => setLoading(false));
  }, [loadProjects, loadVendors]);

  // Spend summary (only shown on "all").
  const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); })();
  const spend90 = projects.reduce((s, p) => {
    const activity = (p.updated_at ?? p.created_at ?? '').slice(0, 10);
    return activity >= cutoff ? s + num(quoteCost(selectedQuote(p))) : s;
  }, 0);
  const spendAll = projects.reduce((s, p) => s + num(quoteCost(selectedQuote(p))), 0);

  const visibleProjects = unitFilter === 'all'
    ? projects
    : projects.filter(p => p.units.some(u => String(u.unit_id) === unitFilter));

  if (loading) return <div className="py-12 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">Projects</h2>
        <button onClick={() => { setShowNew(v => !v); setExpandedId(null); }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ New Project</button>
      </div>

      {/* Unit pill slicers */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setUnitFilter('all')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unitFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>All Projects</button>
        {units.map(u => (
          <button key={u.id} onClick={() => setUnitFilter(String(u.id))}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unitFilter === String(u.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Unit {u.unit_label}
          </button>
        ))}
      </div>

      {/* Spend cards (only on All) */}
      {unitFilter === 'all' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">Last 90 Days</p>
            <p className="mt-1 text-2xl font-bold tabular text-blue-600">{fmt$(spend90)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">All-Time Spend</p>
            <p className="mt-1 text-2xl font-bold tabular">{fmt$(spendAll)}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs text-amber-600 hover:text-amber-800">Dismiss</button>
        </div>
      )}

      {/* New project flow */}
      {showNew && (
        <NewProjectPanel
          id={id} units={units} vendors={vendors} seed={seed ?? null}
          onClose={() => setShowNew(false)}
          onCreated={async (projectId, note) => { setShowNew(false); setNotice(note); setExpandedId(projectId); await loadProjects(); await loadVendors(); }}
          onVendorCreated={loadVendors}
        />
      )}

      {/* Project list */}
      <div className="space-y-3">
        {visibleProjects.length === 0 && !showNew ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400">
            No projects yet. Create one with “+ New Project”.
          </div>
        ) : visibleProjects.map(p => {
          const sel = selectedQuote(p);
          return (
            <div key={p.id} id={`project-${p.id}`} className="overflow-hidden rounded-xl border border-gray-200">
              <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{projName(p)}</span>
                    <StatusBadge status={p.status} />
                    {p.is_recurring && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">Recurring</span>}
                    {(p.trades ?? []).length > 0 && <TradePills keys={p.trades ?? []} label={tradeLabel} />}
                    {p.units.map(u => (
                      <span key={u.unit_id} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{u.unit_label}</span>
                    ))}
                  </div>
                  {p.description && p.project_name && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{p.description}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    {p.quotes.length} quote{p.quotes.length === 1 ? '' : 's'}
                    {' · '}{sel ? `${sel.vendor_name} — ${fmt$(quoteCost(sel))}` : 'No vendor selected'}
                  </p>
                  <div className="mt-1.5">
                    <SpendVsQuote project={p} actual={actuals[p.id]} />
                  </div>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{expandedId === p.id ? '▲' : '▼'}</span>
              </button>
              {expandedId === p.id && (
                <ProjectDetail project={p} units={units} vendors={vendors}
                  onChanged={loadProjects} onVendorCreated={loadVendors} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── New project panel ───────────────────────────────────────────────────────────
function NewProjectPanel({ id, units, vendors, seed, onClose, onCreated, onVendorCreated }: {
  id: string; units: UnitLite[]; vendors: VendorOption[]; seed: NewProjectSeed | null;
  onClose: () => void; onCreated: (projectId: number, note: string | null) => Promise<void> | void; onVendorCreated: () => void;
}) {
  const { trades, label: tradeLabel } = useTrades();
  const [name, setName] = useState(seed?.name ?? '');
  const [description, setDescription] = useState('');
  const [projectTrades, setProjectTrades] = useState<string[]>([]);
  const [txnIds, setTxnIds] = useState<number[]>(seed?.txnId ? [seed.txnId] : []);
  const [recurring, setRecurring] = useState(false);
  const [recDraft, setRecDraft] = useState<RecurringDraft>(emptyRecurring);
  const [error, setError] = useState<string | null>(null);
  const seedTxn: CandidateTxn[] = seed?.txnId
    ? [{ id: seed.txnId, description: seed.name ?? 'Transaction', amount: seed.amount ?? 0, date: seed.date ?? '', category: '', source: '' }]
    : [];
  const [status, setStatus] = useState<ProjectStatus>(seed ? 'open' : 'received');
  const [draft, setDraft] = useState<Record<number, UnitDraft>>(
    () => Object.fromEntries(units.map(u => [u.id, { checked: true, share: '' }])),
  );
  const [quoteVendor, setQuoteVendor] = useState('');
  const [quoteCostVal, setQuoteCostVal] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim() || saving) return;
    if (recurring && !(Number(recDraft.amount) > 0)) { setError('Enter the recurring amount (or untick Recurring).'); return; }
    setSaving(true);
    setError(null);
    try {
      const selectedUnits = units.filter(u => draft[u.id]?.checked)
        .map(u => ({ unit_id: u.id, cost_share: draft[u.id]?.share ? parseFloat(draft[u.id]!.share) : null }));
      const res = await fetch('/api/v2/work-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: name.trim(), description: description.trim() || null, trades: projectTrades,
          property_id: parseInt(id), status, unit_id: selectedUnits[0]?.unit_id ?? null, is_recurring: recurring,
        }),
      });
      const project = await res.json();
      if (!res.ok || !project?.id) { setError(project?.error ?? 'Could not create the project'); setSaving(false); return; }

      if (selectedUnits.length > 0) {
        await fetch('/api/v2/project-units', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_order_id: project.id, units: selectedUnits }),
        });
      }
      if (quoteVendor) {
        await fetch('/api/v2/project-quotes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_order_id: project.id, vendor_id: parseInt(quoteVendor), quoted_cost: quoteCostVal ? parseFloat(quoteCostVal) : null, notes: quoteNotes || null }),
        });
      }
      const notes: string[] = [];
      if (recurring) {
        try {
          await sendJson('/api/v2/recurring-costs', 'POST', {
            property_id: parseInt(id), work_order_id: project.id, vendor_id: quoteVendor ? parseInt(quoteVendor) : null,
            ...recurringBody(recDraft, name.trim()),
          });
        } catch (e) { notes.push(`Recurring cost not saved: ${(e as Error).message}`); }
      }
      try {
        const skipped = await linkTxns(project.id, txnIds);
        if (skipped) notes.push(skipped);
      } catch (e) { notes.push(`Transactions not linked: ${(e as Error).message}`); }
      await onCreated(project.id, notes.length ? `Project created. ${notes.join(' ')}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800">New Project</h3>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      <Field label="Project Name *" value={name} onChange={setName} placeholder="e.g. Roof Repair" />

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
        <textarea aria-label="Project description" value={description} onChange={e => setDescription(e.target.value)} rows={2}
          placeholder="Scope, what was found, anything worth remembering…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Categories <span className="font-normal text-gray-400">(pick all that apply · edit the list in Admin → Trades)</span></p>
        <TradePicker trades={trades} value={projectTrades} onChange={setProjectTrades} label={tradeLabel} ariaLabel="Project categories" />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Assign Units (cost split %, blank = even)</p>
        <UnitAssigner units={units} draft={draft} setDraft={setDraft} />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Status *</p>
        <div className="flex gap-2">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{capitalize(s)}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">First Quote (optional)</p>
        {!showImport ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <select value={quoteVendor} onChange={e => setQuoteVendor(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">Skip — add quotes later</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({tradeLabel(v.trade)})</option>)}
              </select>
              <Field label="" value={quoteCostVal} onChange={setQuoteCostVal} type="number" placeholder="Quoted cost ($)" />
            </div>
            {quoteVendor && <div className="mt-2"><Field label="" value={quoteNotes} onChange={setQuoteNotes} placeholder="Notes (optional)" /></div>}
            <button onClick={() => setShowImport(true)} className="mt-2 text-xs text-blue-600 hover:underline">Import from PDF/email instead</button>
          </>
        ) : (
          <VendorImport vendors={vendors} prefillProjectName={name} onCancel={() => setShowImport(false)} onVendorCreated={onVendorCreated}
            onConfirm={({ vendor_id, quoted_cost, notes }) => {
              setQuoteVendor(String(vendor_id));
              setQuoteCostVal(quoted_cost != null ? String(quoted_cost) : '');
              setQuoteNotes(notes ?? '');
              setShowImport(false);
            }} />
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Transactions already paid <span className="font-normal text-gray-400">(optional — link what you&apos;ve spent so far)</span></p>
        <ProjectTxnPicker propertyId={id} selected={txnIds} onChange={setTxnIds} preload={seedTxn} />
      </div>

      <div className="rounded-lg bg-white/70 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
          Recurring cost (e.g. lawn care, pest control)
        </label>
        {recurring && <div className="mt-3"><RecurringFields draft={recDraft} setDraft={setRecDraft} placeholder={name.trim() || 'Defaults to the project name'} /></div>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={create} disabled={saving || !name.trim()}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Creating…' : 'Create Project'}
      </button>
    </div>
  );
}

// ── Project detail (expanded inline) ─────────────────────────────────────────────
function ProjectDetail({ project, units, vendors, onChanged, onVendorCreated }: {
  project: Project; units: UnitLite[]; vendors: VendorOption[];
  onChanged: () => Promise<void> | void; onVendorCreated: () => void;
}) {
  const { trades, label: tradeLabel } = useTrades();
  const [name, setName] = useState(projName(project));
  const [description, setDescription] = useState(project.description ?? '');
  const [linked, setLinked] = useState<CandidateTxn[] | null>(null);
  const [linking, setLinking] = useState(false);
  const [toLink, setToLink] = useState<number[]>([]);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [recDraft, setRecDraft] = useState<RecurringDraft>(emptyRecurring);
  const [recError, setRecError] = useState<string | null>(null);

  const loadLinked = useCallback(async () => {
    try {
      const r = await sendJson<{ transactions: CandidateTxn[] }>(`/api/finance/projects/${project.id}/transactions`, 'GET');
      setLinked(r.transactions);
    } catch { setLinked([]); }
  }, [project.id]);
  useEffect(() => { void loadLinked(); }, [loadLinked]);
  const [draft, setDraft] = useState<Record<number, UnitDraft>>({});
  const [savingUnits, setSavingUnits] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addVendor, setAddVendor] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [finalDrafts, setFinalDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    const seed: Record<number, UnitDraft> = {};
    for (const u of units) {
      const a = project.units.find(x => x.unit_id === u.id);
      seed[u.id] = { checked: !!a, share: a?.cost_share != null ? String(num(a.cost_share)) : '' };
    }
    setDraft(seed);
  }, [project.units, units]);

  async function patchProject(patch: Record<string, unknown>) {
    await fetch(`/api/v2/work-orders/${project.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    await onChanged();
  }
  async function saveUnits() {
    setSavingUnits(true);
    const selected = units.filter(u => draft[u.id]?.checked)
      .map(u => ({ unit_id: u.id, cost_share: draft[u.id]?.share ? parseFloat(draft[u.id]!.share) : null }));
    await fetch('/api/v2/project-units', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_order_id: project.id, units: selected }),
    });
    setSavingUnits(false);
    await onChanged();
  }
  async function addQuote() {
    if (!addVendor) return;
    await fetch('/api/v2/project-quotes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_order_id: project.id, vendor_id: parseInt(addVendor), quoted_cost: addCost ? parseFloat(addCost) : null, notes: addNotes || null }),
    });
    setAddVendor(''); setAddCost(''); setAddNotes('');
    await onChanged();
  }
  async function patchQuote(qid: number, body: Record<string, unknown>) {
    await fetch(`/api/v2/project-quotes/${qid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await onChanged();
  }
  async function deleteQuote(qid: number) {
    if (!confirm('Delete this quote?')) return;
    await fetch(`/api/v2/project-quotes/${qid}`, { method: 'DELETE' });
    await onChanged();
  }
  async function deleteProject() {
    if (!confirm('Delete this project and all its quotes?')) return;
    await fetch(`/api/v2/work-orders/${project.id}`, { method: 'DELETE' });
    await onChanged();
  }
  async function saveRecurring() {
    if (!(Number(recDraft.amount) > 0)) { setRecError('Enter an amount'); return; }
    setRecError(null);
    try {
      await sendJson('/api/v2/recurring-costs', 'POST', {
        property_id: project.property_id, work_order_id: project.id,
        vendor_id: selectedQuote(project)?.vendor_id ?? null,
        ...recurringBody(recDraft, projName(project)),
      });
      setRecDraft(emptyRecurring());
      await patchProject({ is_recurring: true });
    } catch (e) { setRecError((e as Error).message); }
  }
  async function deleteRecurring(rid: number) {
    if (!confirm('Delete this recurring cost?')) return;
    await fetch(`/api/v2/recurring-costs/${rid}`, { method: 'DELETE' });
    await onChanged();
  }
  async function linkSelected() {
    try {
      setLinkNote(await linkTxns(project.id, toLink));
      setToLink([]); setLinking(false);
      await loadLinked(); await onChanged();
    } catch (e) { setLinkNote((e as Error).message); }
  }
  async function unlink(tid: number) {
    await sendJson(`/api/finance/projects/${project.id}/transactions`, 'DELETE', { ids: [tid] });
    await loadLinked(); await onChanged();
  }

  return (
    <div className="border-t border-gray-100 p-5 space-y-5">
      {/* Name + delete */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">Project Name</label>
          <input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== projName(project)) patchProject({ project_name: name.trim() }); }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <button onClick={deleteProject} className="text-xs text-red-400 hover:text-red-600">Delete project</button>
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
        <textarea aria-label="Project description" value={description} rows={2} onChange={e => setDescription(e.target.value)}
          onBlur={() => { if (description !== (project.description ?? '')) patchProject({ description }); }}
          placeholder="Scope, what was found, anything worth remembering…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      </div>

      {/* Categories + my rating */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[200px] flex-1">
          <p className="mb-2 text-xs font-medium text-gray-500">Categories</p>
          <TradePicker trades={trades} value={project.trades ?? []} onChange={next => patchProject({ trades: next })} label={tradeLabel} ariaLabel="Project categories" />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">My rating</p>
          <StarInput value={project.rating ?? null} onChange={n => patchProject({ rating: n })} label="My rating" />
        </div>
      </div>

      {/* Status */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Status</p>
        <div className="flex gap-2">
          {STATUSES.map(s => (
            <button key={s} onClick={() => patchProject({ status: s })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${project.status === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{capitalize(s)}</button>
          ))}
        </div>
      </div>

      {/* Units */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">Units Assigned (cost split %, blank = even)</p>
          <button onClick={saveUnits} disabled={savingUnits} className="text-xs text-blue-600 hover:underline disabled:opacity-50">{savingUnits ? 'Saving…' : 'Save units'}</button>
        </div>
        <UnitAssigner units={units} draft={draft} setDraft={setDraft} />
      </div>

      {/* Quotes */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Quotes</p>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Vendor', 'Quoted Cost', 'Final Cost', 'Notes', 'Winner', 'Actions'].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {project.quotes.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-gray-400">No quotes yet.</td></tr>
              ) : project.quotes.map(q => (
                <tr key={q.id} className={q.is_selected ? 'border-l-4 border-green-500 bg-green-50' : ''}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{q.vendor_name}</span>
                    <span className="block text-xs text-gray-400">{tradeLabel(q.vendor_trade)}</span>
                  </td>
                  <td className="px-3 py-2 tabular">{fmt$(q.quoted_cost)}</td>
                  <td className="px-3 py-2">
                    <input type="number" defaultValue={q.final_cost != null ? String(num(q.final_cost)) : ''}
                      onChange={e => setFinalDrafts(p => ({ ...p, [q.id]: e.target.value }))}
                      onBlur={() => { if (finalDrafts[q.id] != null) patchQuote(q.id, { final_cost: finalDrafts[q.id] ? parseFloat(finalDrafts[q.id]!) : null }); }}
                      placeholder="—" className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[160px] truncate" title={q.notes ?? ''}>{q.notes ?? '—'}</td>
                  <td className="px-3 py-2">
                    <input type="radio" name={`sel-${project.id}`} checked={q.is_selected} onChange={() => patchQuote(q.id, { is_selected: true })} />
                  </td>
                  <td className="px-3 py-2"><button onClick={() => deleteQuote(q.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add quote */}
        {!showImport ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <select value={addVendor} onChange={e => setAddVendor(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({tradeLabel(v.trade)})</option>)}
            </select>
            <input type="number" value={addCost} onChange={e => setAddCost(e.target.value)} placeholder="Quoted $"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={addNotes} onChange={e => setAddNotes(e.target.value)} placeholder="Notes"
              className="flex-1 min-w-[120px] rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={addQuote} disabled={!addVendor} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ Add Quote</button>
            <button onClick={() => setShowImport(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Import from PDF/email</button>
          </div>
        ) : (
          <div className="mt-3">
            <VendorImport vendors={vendors} prefillProjectName={projName(project)} onCancel={() => setShowImport(false)} onVendorCreated={onVendorCreated}
              onConfirm={async ({ vendor_id, quoted_cost, notes }) => {
                await fetch('/api/v2/project-quotes', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ work_order_id: project.id, vendor_id, quoted_cost, notes }),
                });
                setShowImport(false);
                await onChanged();
              }} />
          </div>
        )}
      </div>

      {/* Linked transactions */}
      <div data-testid={`project-txns-${project.id}`}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">Transactions {linked && linked.length > 0 && <span className="font-normal text-gray-400">({linked.length} · {fmt$(-linked.reduce((s, t) => s + Number(t.amount), 0))} spent)</span>}</p>
          <button onClick={() => { setLinking(v => !v); setToLink([]); }} className="text-xs text-blue-600 hover:underline">{linking ? 'Cancel' : '+ Link transactions'}</button>
        </div>
        {linkNote && <p className="mb-2 text-xs text-amber-700">{linkNote}</p>}
        {linking && (
          <div className="mb-3 space-y-2">
            <ProjectTxnPicker propertyId={project.property_id} projectId={project.id} selected={toLink} onChange={setToLink} />
            <button onClick={linkSelected} disabled={!toLink.length} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              Link {toLink.length || ''} transaction{toLink.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
        {linked === null ? <p className="text-xs text-gray-400">Loading…</p> : linked.length === 0 ? (
          <p className="text-xs text-gray-400">No transactions linked yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs">
            {linked.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-20 shrink-0 text-gray-500">{new Date(String(t.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                <span className="min-w-0 flex-1 truncate" title={t.description}>{t.description}</span>
                <span className="shrink-0 text-gray-400">{t.category}</span>
                <span className={`w-24 shrink-0 text-right tabular ${Number(t.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt$(Math.abs(Number(t.amount)))}</span>
                <button onClick={() => void unlink(t.id)} className="shrink-0 text-gray-400 hover:text-red-600" title="Take off this project (stays on the property)">Unlink</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recurring cost */}
      <div className="rounded-lg bg-gray-50 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={project.is_recurring} onChange={() => patchProject({ is_recurring: !project.is_recurring })} />
          Recurring cost
        </label>
        {(project.recurring ?? []).length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {(project.recurring ?? []).map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-1.5">
                <span><span className="font-medium">{r.description}</span> <span className="text-gray-500">· {describeRecurring(r)}</span></span>
                <button onClick={() => void deleteRecurring(r.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
              </li>
            ))}
          </ul>
        )}
        {project.is_recurring && (
          <div className="mt-3 space-y-2">
            <RecurringFields draft={recDraft} setDraft={setRecDraft} placeholder={projName(project)} />
            {recError && <p className="text-xs text-red-600">{recError}</p>}
            <button onClick={saveRecurring} disabled={!recDraft.amount} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Add recurring cost</button>
          </div>
        )}
      </div>
    </div>
  );
}
