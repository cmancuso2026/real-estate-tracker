'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────
interface UnitLite { id: number; unit_label: string; }
interface AssignedUnit { unit_id: number; unit_label: string; cost_share: number | string | null; }
interface Project {
  id: number;
  project_name: string;
  property_id: number;
  status: ProjectStatus;
  is_recurring: boolean;
  created_at: string;
  updated_at: string | null;
  units: AssignedUnit[];
  quote_count: number;
  selected_vendor_name: string | null;
  selected_cost: number | string | null;
}
interface Quote {
  id: number; project_id: number; vendor_id: number;
  vendor_name: string; vendor_trade: string;
  quoted_cost: number | string | null; final_cost: number | string | null;
  is_selected: boolean; notes: string | null; created_at: string;
}
interface VendorOption { id: number; name: string; trade: string; }
interface RecurringCost {
  id: number; property_id: number; vendor_id: number | null; vendor_name: string | null;
  description: string; monthly_amount: number | string; is_active: boolean;
}
interface SpendVendor { vendor_id: number; vendor_name: string; trade: string; total_spend: number; last_90_days_spend: number; last_active_date: string | null; }
interface SpendByPropertyUnit { unit_id: number; unit_label: string; total_spend: number; }
interface SpendByProperty { property_id: number; address: string; total_spend: number; units: SpendByPropertyUnit[]; }
interface SpendResponse { vendors: SpendVendor[]; by_property: SpendByProperty[]; }

interface VendorQuoteExtracted {
  vendor_name: string | null; vendor_phone: string | null; vendor_email: string | null;
  trade: string | null; project_name: string | null; quoted_cost: number | null;
  scope_of_work: string | null; quote_date: string | null; valid_until: string | null;
  confidence_notes: string | null;
}

type ProjectStatus = 'received' | 'open' | 'completed';

const STATUSES: ProjectStatus[] = ['received', 'open', 'completed'];
const TRADES = ['plumbing', 'hvac', 'electrical', 'roofing', 'appliance', 'landscaping', 'pest_control', 'general', 'other'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tradeLabel = (s: string | null | undefined) => (s ? s.split('_').map(capitalize).join(' ') : '—');
function num(n: number | string | null | undefined): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function fmt$(n: number | string | null | undefined) {
  if (n == null || n === '') return '—';
  return '$' + num(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  received: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
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
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
    </div>
  );
}

// ── Vendor import (side-by-side confirmation) ───────────────────────────────────
function VendorImport({ propertyId, vendors, prefillProjectName, onCancel, onConfirm, onVendorCreated }: {
  propertyId: string;
  vendors: VendorOption[];
  prefillProjectName?: string;
  onCancel: () => void;
  onConfirm: (result: { vendor_id: number; quoted_cost: number | null; notes: string | null }) => Promise<void> | void;
  onVendorCreated: () => void;
}) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [extracted, setExtracted] = useState<VendorQuoteExtracted | null>(null);
  const [createVendor, setCreateVendor] = useState(true);
  const [matchedVendorId, setMatchedVendorId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Clean up the object URL for the PDF preview.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function applyExtraction(data: VendorQuoteExtracted) {
    setExtracted(data);
    // Try to match an existing vendor by name (case-insensitive).
    const match = data.vendor_name
      ? vendors.find(v => v.name.toLowerCase().trim() === data.vendor_name!.toLowerCase().trim())
      : undefined;
    if (match) { setMatchedVendorId(String(match.id)); setCreateVendor(false); }
    else { setMatchedVendorId(''); setCreateVendor(true); }
  }

  async function handleFile(file: File) {
    setParsing(true); setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file.type === 'application/pdf' ? URL.createObjectURL(file) : null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', 'vendor_quote');
      const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Parse failed'); return; }
      applyExtraction(data.extracted as VendorQuoteExtracted);
    } catch { setError('Upload error'); }
    finally { setParsing(false); }
  }

  async function parsePastedText() {
    if (!pastedText.trim()) return;
    setParsing(true); setError('');
    setPreviewUrl(null);
    try {
      const form = new FormData();
      form.append('text', pastedText);
      form.append('type', 'vendor_quote');
      const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Parse failed'); return; }
      applyExtraction(data.extracted as VendorQuoteExtracted);
    } catch { setError('Upload error'); }
    finally { setParsing(false); }
  }

  function patch(p: Partial<VendorQuoteExtracted>) { setExtracted(prev => (prev ? { ...prev, ...p } : prev)); }

  async function confirm() {
    if (!extracted || saving) return;
    setSaving(true);
    try {
      let vendorId: number | null = null;
      if (createVendor) {
        const res = await fetch('/api/v2/vendors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: extracted.vendor_name ?? 'Unknown Vendor',
            trade: extracted.trade ?? 'general',
            phone: extracted.vendor_phone ?? null,
            email: extracted.vendor_email ?? null,
          }),
        });
        const v = await res.json();
        vendorId = v?.id ?? null;
        onVendorCreated();
      } else {
        vendorId = matchedVendorId ? parseInt(matchedVendorId) : null;
      }
      if (!vendorId) { setError('Select or create a vendor'); setSaving(false); return; }
      const notes = extracted.scope_of_work ?? null;
      await onConfirm({ vendor_id: vendorId, quoted_cost: extracted.quoted_cost ?? null, notes });
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300">Import Quote from PDF / Email</h3>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      {!extracted ? (
        <div className="space-y-3">
          <label className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-blue-300 px-4 py-8 text-sm text-blue-600 hover:bg-blue-100/50 dark:border-blue-700 dark:hover:bg-blue-900/20 ${parsing ? 'opacity-50' : ''}`}>
            {parsing ? 'Parsing…' : 'Drop or choose a PDF / file'}
            <input type="file" accept=".pdf,.eml,.txt,image/*" className="hidden" disabled={parsing}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
          <div className="text-center text-xs text-gray-400">or paste email / quote text below</div>
          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={4}
            placeholder="Paste the contractor email or quote text…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          <button onClick={parsePastedText} disabled={parsing || !pastedText.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {parsing ? 'Parsing…' : 'Parse Text'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* LEFT: source preview */}
          <div className="min-h-[300px] overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            {previewUrl
              ? <iframe src={previewUrl} className="h-[420px] w-full" title="Quote preview" />
              : <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-600 dark:text-gray-400">{pastedText || 'No preview available'}</pre>}
          </div>

          {/* RIGHT: editable extracted fields */}
          <div className="space-y-3">
            {extracted.confidence_notes && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {extracted.confidence_notes}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor Name" value={extracted.vendor_name ?? ''} onChange={v => patch({ vendor_name: v })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Trade</label>
                <select value={extracted.trade ?? 'general'} onChange={e => patch({ trade: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                  {TRADES.map(t => <option key={t} value={t}>{tradeLabel(t)}</option>)}
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createVendor} onChange={e => setCreateVendor(e.target.checked)} />
              Create new vendor record
            </label>
            {!createVendor && (
              <select value={matchedVendorId} onChange={e => setMatchedVendorId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
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
              <button onClick={() => { setExtracted(null); setError(''); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Re-upload</button>
            </div>
            <p className="text-xs text-gray-400">Property #{propertyId}</p>
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
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          )}
        </div>
      ))}
      {units.length === 0 && <p className="text-xs text-gray-400">No units on this property.</p>}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
export function ProjectsTab({ id, units }: { id: string; units: UnitLite[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [recurring, setRecurring] = useState<RecurringCost[]>([]);
  const [spend, setSpend] = useState<SpendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadProjects = useCallback(async () => {
    const res = await fetch(`/api/v2/projects?propertyId=${id}`);
    const d = await res.json();
    setProjects(Array.isArray(d) ? d : []);
  }, [id]);
  const loadSpend = useCallback(async () => {
    const res = await fetch(`/api/v2/vendors/spend?propertyId=${id}`);
    if (res.ok) setSpend(await res.json());
  }, [id]);
  const loadRecurring = useCallback(async () => {
    const res = await fetch(`/api/v2/recurring-costs?propertyId=${id}`);
    const d = await res.json();
    setRecurring(Array.isArray(d) ? d : []);
  }, [id]);
  const loadVendors = useCallback(async () => {
    const res = await fetch('/api/v2/vendors');
    const d = await res.json();
    setVendors(Array.isArray(d) ? d.map((v: VendorOption) => ({ id: v.id, name: v.name, trade: v.trade })) : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadProjects(), loadVendors(), loadRecurring(), loadSpend()]).finally(() => setLoading(false));
  }, [loadProjects, loadVendors, loadRecurring, loadSpend]);

  const refreshAfterChange = useCallback(async () => {
    await Promise.all([loadProjects(), loadSpend()]);
  }, [loadProjects, loadSpend]);

  // Summary card numbers (scoped to this property).
  const spend90 = spend ? spend.vendors.reduce((s, v) => s + num(v.last_90_days_spend), 0) : 0;
  const thisProp = spend?.by_property.find(p => String(p.property_id) === id) ?? spend?.by_property[0] ?? null;

  // Apply unit pill filter.
  const visibleProjects = unitFilter === 'all'
    ? projects
    : projects.filter(p => p.units.some(u => String(u.unit_id) === unitFilter));

  if (loading) return <div className="py-12 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">Projects</h2>
        <button onClick={() => { setShowNew(v => !v); setExpandedId(null); }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">+ New Project</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Spend Last 90 Days</p>
          <p className="mt-1 text-2xl font-bold tabular text-blue-600 dark:text-blue-400">{fmt$(spend90)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Spend by Property (all time)</p>
          <p className="mt-1 text-2xl font-bold tabular">{fmt$(thisProp?.total_spend ?? 0)}</p>
          {thisProp && thisProp.units.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {thisProp.units.map(u => `Unit ${u.unit_label}: ${fmt$(u.total_spend)}`).join('   ')}
            </p>
          )}
        </div>
      </div>

      {/* Unit pill slicers */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setUnitFilter('all')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unitFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>All Projects</button>
        {units.map(u => (
          <button key={u.id} onClick={() => setUnitFilter(String(u.id))}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${unitFilter === String(u.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}>
            Unit {u.unit_label}
          </button>
        ))}
      </div>

      {/* New project flow */}
      {showNew && (
        <NewProjectPanel
          id={id} units={units} vendors={vendors}
          onClose={() => setShowNew(false)}
          onCreated={async () => { setShowNew(false); await refreshAfterChange(); await loadVendors(); }}
        />
      )}

      {/* Project list */}
      <div className="space-y-3">
        {visibleProjects.length === 0 && !showNew ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-gray-700">
            No projects yet. Create one with “+ New Project”.
          </div>
        ) : visibleProjects.map(p => (
          <div key={p.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            {/* Row */}
            <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.project_name}</span>
                  {p.is_recurring && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Recurring</span>}
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {p.units.length > 0 ? p.units.map(u => `Unit ${u.unit_label}`).join(', ') : 'No units'}
                  {' · '}{p.quote_count} quote{p.quote_count === 1 ? '' : 's'}
                  {p.selected_vendor_name && ` · ${p.selected_vendor_name} ${fmt$(p.selected_cost)}`}
                </p>
              </div>
              <span className="shrink-0 text-xs text-gray-400">{expandedId === p.id ? '▲' : '▼'}</span>
            </button>
            {/* Detail */}
            {expandedId === p.id && (
              <ProjectDetail
                project={p} units={units} vendors={vendors}
                onChanged={refreshAfterChange} onVendorCreated={loadVendors}
              />
            )}
          </div>
        ))}
      </div>

      {/* Recurring costs */}
      <RecurringCosts id={id} vendors={vendors} recurring={recurring} onChanged={loadRecurring} />
    </div>
  );
}

// ── New project panel ───────────────────────────────────────────────────────────
function NewProjectPanel({ id, units, vendors, onClose, onCreated }: {
  id: string; units: UnitLite[]; vendors: VendorOption[];
  onClose: () => void; onCreated: () => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('received');
  const [draft, setDraft] = useState<Record<number, UnitDraft>>(
    () => Object.fromEntries(units.map(u => [u.id, { checked: true, share: '' }])),
  );
  const [quoteVendor, setQuoteVendor] = useState('');
  const [quoteCost, setQuoteCost] = useState('');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v2/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_name: name.trim(), property_id: parseInt(id), status }),
      });
      const project = await res.json();
      if (!res.ok || !project?.id) { setSaving(false); return; }

      const selectedUnits = units.filter(u => draft[u.id]?.checked)
        .map(u => ({ unit_id: u.id, cost_share: draft[u.id]?.share ? parseFloat(draft[u.id]!.share) : null }));
      if (selectedUnits.length > 0) {
        await fetch(`/api/v2/projects/${project.id}/units`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ units: selectedUnits }),
        });
      }
      if (quoteVendor) {
        await fetch(`/api/v2/projects/${project.id}/quotes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor_id: parseInt(quoteVendor), quoted_cost: quoteCost ? parseFloat(quoteCost) : null }),
        });
      }
      await onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4 dark:border-blue-700 dark:bg-blue-950/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300">New Project</h3>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      <Field label="Project Name *" value={name} onChange={setName} placeholder="e.g. Roof Repair" />

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Assign Units (cost split %, blank = even)</p>
        <UnitAssigner units={units} draft={draft} setDraft={setDraft} />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Initial Status *</p>
        <div className="flex gap-2">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>{capitalize(s)}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">First Quote (optional — add more later)</p>
        <div className="grid grid-cols-2 gap-3">
          <select value={quoteVendor} onChange={e => setQuoteVendor(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
            <option value="">No quote yet</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({tradeLabel(v.trade)})</option>)}
          </select>
          <Field label="" value={quoteCost} onChange={setQuoteCost} type="number" placeholder="Quoted cost ($)" />
        </div>
      </div>

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
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [name, setName] = useState(project.project_name);
  const [draft, setDraft] = useState<Record<number, UnitDraft>>({});
  const [savingUnits, setSavingUnits] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addVendor, setAddVendor] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [finalDrafts, setFinalDrafts] = useState<Record<number, string>>({});
  const nameRef = useRef(project.project_name);

  const loadQuotes = useCallback(async () => {
    const res = await fetch(`/api/v2/projects/${project.id}/quotes`);
    const d = await res.json();
    setQuotes(Array.isArray(d) ? d : []);
  }, [project.id]);

  useEffect(() => {
    loadQuotes();
    // Seed the unit draft from the project's current assignments.
    const seed: Record<number, UnitDraft> = {};
    for (const u of units) {
      const assigned = project.units.find(a => a.unit_id === u.id);
      seed[u.id] = { checked: !!assigned, share: assigned?.cost_share != null ? String(num(assigned.cost_share)) : '' };
    }
    setDraft(seed);
  }, [loadQuotes, project.units, units]);

  async function saveName() {
    if (name.trim() === nameRef.current) return;
    nameRef.current = name.trim();
    await fetch(`/api/v2/projects/${project.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: name.trim() }),
    });
    await onChanged();
  }
  async function setStatus(status: ProjectStatus) {
    await fetch(`/api/v2/projects/${project.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    await onChanged();
  }
  async function toggleRecurring() {
    await fetch(`/api/v2/projects/${project.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_recurring: !project.is_recurring }),
    });
    await onChanged();
  }
  async function saveUnits() {
    setSavingUnits(true);
    const selected = units.filter(u => draft[u.id]?.checked)
      .map(u => ({ unit_id: u.id, cost_share: draft[u.id]?.share ? parseFloat(draft[u.id]!.share) : null }));
    await fetch(`/api/v2/projects/${project.id}/units`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units: selected }),
    });
    setSavingUnits(false);
    await onChanged();
  }
  async function addQuote() {
    if (!addVendor) return;
    await fetch(`/api/v2/projects/${project.id}/quotes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: parseInt(addVendor), quoted_cost: addCost ? parseFloat(addCost) : null, notes: addNotes || null }),
    });
    setAddVendor(''); setAddCost(''); setAddNotes('');
    await loadQuotes(); await onChanged();
  }
  async function selectQuote(qid: number) {
    await fetch(`/api/v2/projects/${project.id}/quotes/${qid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_selected: true }),
    });
    await loadQuotes(); await onChanged();
  }
  async function saveFinal(qid: number) {
    const raw = finalDrafts[qid];
    if (raw == null) return;
    await fetch(`/api/v2/projects/${project.id}/quotes/${qid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ final_cost: raw ? parseFloat(raw) : null }),
    });
    await loadQuotes(); await onChanged();
  }
  async function deleteQuote(qid: number) {
    if (!confirm('Delete this quote?')) return;
    await fetch(`/api/v2/projects/${project.id}/quotes/${qid}`, { method: 'DELETE' });
    await loadQuotes(); await onChanged();
  }
  async function deleteProject() {
    if (!confirm('Delete this project and all its quotes?')) return;
    await fetch(`/api/v2/projects/${project.id}`, { method: 'DELETE' });
    await onChanged();
  }

  return (
    <div className="border-t border-gray-100 p-5 space-y-5 dark:border-gray-800">
      {/* Name + status + delete */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">Project Name</label>
          <input value={name} onChange={e => setName(e.target.value)} onBlur={saveName}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
        </div>
        <button onClick={deleteProject} className="text-xs text-red-400 hover:text-red-600">Delete project</button>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Status</p>
        <div className="flex gap-2">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${project.status === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>{capitalize(s)}</button>
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
        <p className="mb-2 text-xs font-medium text-gray-500">Vendor Quotes</p>
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>{['Vendor', 'Quoted', 'Final', 'Notes', 'Selected', ''].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {quotes.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-gray-400">No quotes yet.</td></tr>
              ) : quotes.map(q => (
                <tr key={q.id} className={q.is_selected ? 'bg-green-50 dark:bg-green-950/20' : ''}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{q.vendor_name}</span>
                    {q.is_selected && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Winner</span>}
                    <span className="block text-xs text-gray-400">{tradeLabel(q.vendor_trade)}</span>
                  </td>
                  <td className="px-3 py-2 tabular">{fmt$(q.quoted_cost)}</td>
                  <td className="px-3 py-2">
                    <input type="number" defaultValue={q.final_cost != null ? String(num(q.final_cost)) : ''}
                      onChange={e => setFinalDrafts(p => ({ ...p, [q.id]: e.target.value }))}
                      onBlur={() => saveFinal(q.id)} placeholder="—"
                      className="w-24 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[160px] truncate" title={q.notes ?? ''}>{q.notes ?? '—'}</td>
                  <td className="px-3 py-2">
                    <input type="radio" name={`sel-${project.id}`} checked={q.is_selected} onChange={() => selectQuote(q.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => deleteQuote(q.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add quote */}
        {!showImport ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <select value={addVendor} onChange={e => setAddVendor(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({tradeLabel(v.trade)})</option>)}
            </select>
            <input type="number" value={addCost} onChange={e => setAddCost(e.target.value)} placeholder="Quoted $"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
            <input value={addNotes} onChange={e => setAddNotes(e.target.value)} placeholder="Notes"
              className="flex-1 min-w-[120px] rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
            <button onClick={addQuote} disabled={!addVendor} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ Add Quote</button>
            <button onClick={() => setShowImport(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Import from PDF/email</button>
          </div>
        ) : (
          <div className="mt-3">
            <VendorImport
              propertyId={String(project.property_id)} vendors={vendors} prefillProjectName={project.project_name}
              onCancel={() => setShowImport(false)}
              onVendorCreated={onVendorCreated}
              onConfirm={async ({ vendor_id, quoted_cost, notes }) => {
                await fetch(`/api/v2/projects/${project.id}/quotes`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ vendor_id, quoted_cost, notes }),
                });
                setShowImport(false);
                await loadQuotes(); await onChanged();
              }}
            />
          </div>
        )}
      </div>

      {/* Recurring toggle */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={project.is_recurring} onChange={toggleRecurring} />
        Mark this project as a recurring cost
      </label>
    </div>
  );
}

// ── Recurring costs section ─────────────────────────────────────────────────────
function RecurringCosts({ id, vendors, recurring, onChanged }: {
  id: string; vendors: VendorOption[]; recurring: RecurringCost[]; onChanged: () => Promise<void> | void;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!desc.trim() || !amount || saving) return;
    setSaving(true);
    await fetch('/api/v2/recurring-costs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: parseInt(id), description: desc.trim(), monthly_amount: parseFloat(amount), vendor_id: vendorId ? parseInt(vendorId) : null }),
    });
    setDesc(''); setAmount(''); setVendorId(''); setSaving(false);
    await onChanged();
  }
  async function toggle(rc: RecurringCost) {
    await fetch(`/api/v2/recurring-costs/${rc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !rc.is_active }),
    });
    await onChanged();
  }
  async function remove(rcId: number) {
    if (!confirm('Delete this recurring cost?')) return;
    await fetch(`/api/v2/recurring-costs/${rcId}`, { method: 'DELETE' });
    await onChanged();
  }

  const total = recurring.filter(r => r.is_active).reduce((s, r) => s + num(r.monthly_amount), 0);

  return (
    <div className="mt-6 border-t-2 border-blue-100 pt-5 dark:border-blue-900/30">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recurring Costs</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Standing monthly costs — subtracted from cash flow</p>
        </div>
        <p className="text-sm text-gray-500">Active: <span className="font-semibold tabular">{fmt$(total)}/mo</span></p>
      </div>

      <div className="space-y-2">
        {recurring.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400 dark:border-gray-700">No recurring costs yet.</div>
        ) : recurring.map(r => (
          <div key={r.id} className={`flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-800 ${r.is_active ? '' : 'opacity-50'}`}>
            <div>
              <span className="font-medium">{r.description}</span>
              {r.vendor_name && <span className="ml-2 text-xs text-gray-400">{r.vendor_name}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular font-semibold">{fmt$(r.monthly_amount)}/mo</span>
              <button onClick={() => toggle(r)} className="text-xs text-gray-500 hover:underline">{r.is_active ? 'Deactivate' : 'Activate'}</button>
              <button onClick={() => remove(r.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (e.g. Lawn Care)"
          className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <select value={vendorId} onChange={e => setVendorId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <option value="">No vendor</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="$/mo"
          className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <button onClick={add} disabled={saving || !desc.trim() || !amount} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ Add</button>
      </div>
    </div>
  );
}
