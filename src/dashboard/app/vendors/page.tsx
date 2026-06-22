'use client';

import { Fragment, useEffect, useState } from 'react';

interface Vendor {
  id: number; name: string; trade: string; phone: string | null; email: string | null;
  google_rating: number | null; google_review_count: number | null;
  manual_rating: number | null; manual_notes: string | null;
  total_jobs: number; completed_jobs: number; avg_internal_rating: number | null; total_spend: number | null;
  project_count: number | null;
  is_active: boolean;
}

interface VendorQuote {
  id: number; work_order_id: number; quoted_cost: number | null; final_cost: number | null;
  is_selected: boolean; notes: string | null;
  project_name: string | null; description: string | null; status: string | null;
  property_address: string | null;
}
interface WorkOrderOption { id: number; project_name: string | null; description: string | null; property_address: string | null; }

interface SpendVendor { vendor_id: number; vendor_name: string; trade: string; total_spend: number; last_90_days_spend: number; last_active_date: string | null; }
interface SpendByPropertyUnit { unit_id: number; unit_label: string; total_spend: number; }
interface SpendByProperty { property_id: number; address: string; total_spend: number; units: SpendByPropertyUnit[]; }
interface SpendResponse { vendors: SpendVendor[]; by_property: SpendByProperty[]; }

interface VendorQuoteExtracted {
  vendor_name: string | null; vendor_phone: string | null; vendor_email: string | null;
  trade: string | null; project_name: string | null; quoted_cost: number | null;
  scope_of_work: string | null; quote_date: string | null; confidence_notes: string | null;
}

const TRADES = ['plumbing','hvac','electrical','roofing','appliance','landscaping','pest_control','general','other'];

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const tradeLabel = (s: string | null | undefined) => (s ? s.split('_').map(capitalize).join(' ') : '—');
function fmt$(n: number | null) { return n == null ? '—' : '$' + Number(n).toLocaleString(); }
function Stars({ rating, max = 5 }: { rating: number | null; max?: number }) {
  if (!rating) return <span className="text-xs text-gray-400">—</span>;
  return <span className="text-amber-500 text-sm">{'★'.repeat(Math.round(rating))}{'☆'.repeat(max - Math.round(rating))}</span>;
}

type AddMode = null | 'choice' | 'manual' | 'import';

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [spend, setSpend] = useState<SpendResponse | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Manual add form
  const [form, setForm] = useState({ name: '', trade: 'general', phone: '', email: '', website: '' });
  const [saving, setSaving] = useState(false);

  // Post-save "assign to project?" prompt
  const [justCreated, setJustCreated] = useState<{ id: number; name: string } | null>(null);
  const [promptCreateProject, setPromptCreateProject] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    try {
      const [vRes, sRes] = await Promise.all([
        fetch(`/api/v2/vendors${q ? `?search=${encodeURIComponent(q)}` : ''}`),
        fetch('/api/v2/vendors/spend'),
      ]);
      const vData = vRes.ok ? await vRes.json() : [];
      setVendors(Array.isArray(vData) ? vData : []);
      if (sRes.ok) setSpend(await sRes.json());
    } catch (e) {
      console.error('Failed to load vendors:', e);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.trade) return;
    setSaving(true);
    const res = await fetch('/api/v2/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    setAddMode(null);
    setForm({ name: '', trade: 'general', phone: '', email: '', website: '' });
    load();
    if (res.ok) {
      try {
        const v = await res.json();
        if (v?.id) { setJustCreated({ id: v.id, name: v.name }); setPromptCreateProject(false); }
      } catch { /* ignore — vendor still created */ }
    }
  };

  const spend90 = spend ? spend.vendors.reduce((s, v) => s + Number(v.last_90_days_spend || 0), 0) : 0;
  const spendAll = spend ? spend.by_property.reduce((s, p) => s + Number(p.total_spend || 0), 0) : 0;

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendors</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Contractors and service providers</p>
        </div>
        <button onClick={() => setAddMode('choice')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + Add Vendor
        </button>
      </div>

      {/* Spend summary */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Last 90 Days Spend</p>
          <p className="mt-1 text-2xl font-bold tabular text-blue-600 dark:text-blue-400">{fmt$(spend90)}</p>
          <p className="text-xs text-gray-400">across all properties</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">All-Time Spend</p>
          <p className="mt-1 text-2xl font-bold tabular">{fmt$(spendAll)}</p>
          <p className="text-xs text-gray-400">across all properties</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Spend by Property</p>
          {spend && spend.by_property.length > 0 ? (
            <div className="mt-1 space-y-1">
              {spend.by_property.map(p => (
                <div key={p.property_id}>
                  <p className="text-sm font-semibold tabular">{p.address}: {fmt$(p.total_spend)}</p>
                  {p.units.length > 0 && (
                    <p className="text-xs text-gray-400">{p.units.map(u => `Unit ${u.unit_label}: ${fmt$(u.total_spend)}`).join('   ')}</p>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="mt-1 text-sm text-gray-400">No spend recorded</p>}
        </div>
      </div>

      {/* Add-vendor choice */}
      {addMode === 'choice' && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Add a Vendor</h3>
            <button onClick={() => setAddMode(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setAddMode('import')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Import from PDF or Email</button>
            <button onClick={() => setAddMode('manual')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Enter Manually</button>
          </div>
        </div>
      )}

      {/* Import flow */}
      {addMode === 'import' && (
        <VendorImportPanel onCancel={() => setAddMode(null)} onDone={() => { setAddMode(null); load(); }} />
      )}

      {/* Manual add vendor form */}
      {addMode === 'manual' && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-4 font-semibold">New Vendor</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Name *', key: 'name', type: 'text' },
              { label: 'Phone', key: 'phone', type: 'tel' },
              { label: 'Email', key: 'email', type: 'email' },
              { label: 'Website', key: 'website', type: 'url' },
            ].map(f => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-gray-500">{f.label}</label>
                <input type={f.type} value={(form as Record<string, string>)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs text-gray-500">Trade *</label>
              <select value={form.trade} onChange={e => setForm(prev => ({ ...prev, trade: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                {TRADES.map(t => <option key={t} value={t}>{tradeLabel(t)}</option>)}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">Google rating will be looked up automatically if available.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Vendor'}
            </button>
            <button onClick={() => setAddMode(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Post-save: assign to project prompt */}
      {justCreated && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950/20">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-green-800 dark:text-green-300">Vendor “{justCreated.name}” saved</h3>
            <button onClick={() => { setJustCreated(null); setPromptCreateProject(false); }} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          {!promptCreateProject ? (
            <>
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">Would you like to assign this vendor to a project?</p>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setPromptCreateProject(true)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">Create New Project</button>
                <button onClick={() => { setJustCreated(null); setPromptCreateProject(false); }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Skip for now</button>
              </div>
            </>
          ) : (
            <div className="max-w-md">
              <CreateProjectInline
                vendorId={justCreated.id}
                onCreated={() => { setJustCreated(null); setPromptCreateProject(false); load(search); }}
                onCancel={() => { setJustCreated(null); setPromptCreateProject(false); }}
              />
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text" placeholder="Search by name or trade…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(search)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading…</div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400 dark:border-gray-700">
          <p className="text-lg font-medium">No vendors yet</p>
          <p className="mt-1 text-sm">Add your contractors to start tracking projects and ratings.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['Vendor', 'Trade', 'Google Rating', 'My Rating', 'Projects', 'Jobs', 'Total Spend', 'Contact'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {vendors.map(v => (
                <Fragment key={v.id}>
                  <tr
                    onClick={() => setExpandedId(id => (id === v.id ? null : v.id))}
                    className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50 ${expandedId === v.id ? 'bg-gray-50 dark:bg-gray-900/50' : ''}`}
                  >
                    <td className="px-5 py-3 font-medium">
                      <span className="mr-2 inline-block text-gray-400">{expandedId === v.id ? '▾' : '▸'}</span>
                      {v.name}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{tradeLabel(v.trade)}</td>
                    <td className="px-5 py-3">
                      {v.google_rating
                        ? <span><Stars rating={v.google_rating} /> <span className="text-xs text-gray-400">({v.google_review_count})</span></span>
                        : <span className="text-xs text-gray-400">Not found</span>
                      }
                    </td>
                    <td className="px-5 py-3"><Stars rating={v.manual_rating} /></td>
                    <td className="px-5 py-3 tabular">{v.project_count ?? 0}</td>
                    <td className="px-5 py-3 tabular">{v.completed_jobs}/{v.total_jobs}</td>
                    <td className="px-5 py-3 tabular">{fmt$(v.total_spend)}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {v.phone && <p>{v.phone}</p>}
                      {v.email && <p>{v.email}</p>}
                    </td>
                  </tr>
                  {expandedId === v.id && (
                    <tr className="bg-gray-50 dark:bg-gray-900/30">
                      <td colSpan={8} className="px-5 py-4">
                        <VendorDetail
                          vendor={v}
                          onSaved={() => load(search)}
                          onDeleted={() => { setExpandedId(null); load(search); }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Vendor import: PDF/email → AI extract → side-by-side confirm ──────────────────
function VendorImportPanel({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [data, setData] = useState<VendorQuoteExtracted | null>(null);
  const [createVendor, setCreateVendor] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function send(form: FormData) {
    setParsing(true); setError('');
    try {
      const res = await fetch('/api/v2/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Parse failed'); return; }
      setData(json.extracted as VendorQuoteExtracted);
    } catch { setError('Upload error'); }
    finally { setParsing(false); }
  }
  function handleFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file.type === 'application/pdf' ? URL.createObjectURL(file) : null);
    const form = new FormData(); form.append('file', file); form.append('type', 'vendor_quote');
    send(form);
  }
  function parseText() {
    if (!pastedText.trim()) return;
    setPreviewUrl(null);
    const form = new FormData(); form.append('text', pastedText); form.append('type', 'vendor_quote');
    send(form);
  }
  function patch(p: Partial<VendorQuoteExtracted>) { setData(prev => (prev ? { ...prev, ...p } : prev)); }

  async function confirm() {
    if (!data || saving) return;
    setSaving(true);
    try {
      if (createVendor && data.vendor_name) {
        await fetch('/api/v2/vendors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.vendor_name, phone: data.vendor_phone ?? null, email: data.vendor_email ?? null, trade: data.trade ?? 'general' }),
        });
      }
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <div className="mb-6 rounded-xl border-2 border-blue-300 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/20">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300">Import Vendor from PDF or Email</h3>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      {!data ? (
        <div className="space-y-3">
          <label className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-blue-300 px-4 py-8 text-sm text-blue-600 hover:bg-blue-100/50 dark:border-blue-700 dark:hover:bg-blue-900/20 ${parsing ? 'opacity-50' : ''}`}>
            {parsing ? 'Parsing…' : 'Drop a quote, invoice, or email (PDF / .eml / .txt)'}
            <input type="file" accept=".pdf,.eml,.txt,image/*" className="hidden" disabled={parsing}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Or paste email/quote text here</label>
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          </div>
          <button onClick={parseText} disabled={parsing || !pastedText.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {parsing ? 'Parsing…' : 'Parse'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* LEFT: source */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            {previewUrl
              ? <iframe src={previewUrl} className="h-[500px] w-full" title="Source preview" />
              : <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-600 dark:text-gray-400">{pastedText || 'No preview available'}</pre>}
          </div>
          {/* RIGHT: editable form */}
          <div className="space-y-3">
            {data.confidence_notes && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">⚠ {data.confidence_notes}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <ImpField label="Vendor Name" value={data.vendor_name ?? ''} onChange={v => patch({ vendor_name: v })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Trade</label>
                <select value={data.trade ?? 'general'} onChange={e => patch({ trade: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                  {TRADES.map(t => <option key={t} value={t}>{tradeLabel(t)}</option>)}
                </select>
              </div>
              <ImpField label="Phone" value={data.vendor_phone ?? ''} onChange={v => patch({ vendor_phone: v })} />
              <ImpField label="Email" value={data.vendor_email ?? ''} onChange={v => patch({ vendor_email: v })} />
              <ImpField label="Project Name" value={data.project_name ?? ''} onChange={v => patch({ project_name: v })} />
              <ImpField label="Quoted Cost ($)" type="number" value={data.quoted_cost?.toString() ?? ''} onChange={v => patch({ quoted_cost: v ? parseFloat(v) : null })} />
              <ImpField label="Quote Date" type="date" value={data.quote_date ?? ''} onChange={v => patch({ quote_date: v })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Scope of Work</label>
              <textarea value={data.scope_of_work ?? ''} onChange={e => patch({ scope_of_work: e.target.value })} rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createVendor} onChange={e => setCreateVendor(e.target.checked)} />
              Create new vendor record
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setData(null); setError(''); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Re-upload</button>
              <button onClick={confirm} disabled={saving || (createVendor && !data.vendor_name)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expandable vendor detail: edit fields, manage projects, delete ────────────────
function VendorDetail({ vendor, onSaved, onDeleted }: { vendor: Vendor; onSaved: () => void; onDeleted: () => void }) {
  const [form, setForm] = useState({
    name: vendor.name ?? '', trade: vendor.trade ?? 'general',
    phone: vendor.phone ?? '', email: vendor.email ?? '',
    manual_notes: vendor.manual_notes ?? '', manual_rating: vendor.manual_rating ?? 0,
  });
  const [quotes, setQuotes] = useState<VendorQuote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Which project row is expanded to show all competing quotes (by work_order_id)
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);

  // Assign-to-project UI
  const [assigning, setAssigning] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [assignWoId, setAssignWoId] = useState('');
  const [assignCost, setAssignCost] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

  const loadDetail = async () => {
    setLoadingQuotes(true);
    try {
      const res = await fetch(`/api/v2/vendors/${vendor.id}`);
      if (res.ok) {
        const data = await res.json();
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
      }
    } catch (e) {
      console.error('Failed to load vendor detail:', e);
    } finally {
      setLoadingQuotes(false);
    }
  };
  useEffect(() => { loadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vendor.id]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/v2/vendors/${vendor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, manual_rating: form.manual_rating || null }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete vendor "${vendor.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/v2/vendors/${vendor.id}`, { method: 'DELETE' });
      onDeleted();
    } finally { setDeleting(false); }
  };

  const openAssign = async () => {
    setAssigning(true);
    setCreatingProject(false);
    try {
      const res = await fetch('/api/v2/work-orders');
      if (res.ok) {
        const data = await res.json();
        setWorkOrders(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error('Failed to load projects:', e); }
  };

  const closeAssign = () => { setAssigning(false); setCreatingProject(false); setAssignWoId(''); setAssignCost(''); };

  const submitAssign = async () => {
    if (!assignWoId) return;
    setAssignSaving(true);
    try {
      await fetch('/api/v2/project-quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: Number(assignWoId), vendor_id: vendor.id,
          quoted_cost: assignCost ? parseFloat(assignCost) : null,
        }),
      });
      setAssigning(false); setAssignWoId(''); setAssignCost('');
      loadDetail();
      onSaved();
    } finally { setAssignSaving(false); }
  };

  const woLabel = (w: WorkOrderOption) =>
    `${w.project_name || w.description || `Project #${w.id}`}${w.property_address ? ` — ${w.property_address}` : ''}`;
  const quoteLabel = (q: VendorQuote) => q.project_name || q.description || `Project #${q.work_order_id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* LEFT: editable fields */}
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Vendor Details</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Name</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Trade</label>
            <select value={form.trade} onChange={e => setForm(p => ({ ...p, trade: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              {TRADES.map(t => <option key={t} value={t}>{tradeLabel(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Phone</label>
            <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Email</label>
            <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">My Rating</label>
            <select value={form.manual_rating} onChange={e => setForm(p => ({ ...p, manual_rating: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
              <option value={0}>—</option>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-gray-500">Notes</label>
          <textarea value={form.manual_notes} onChange={e => setForm(p => ({ ...p, manual_notes: e.target.value }))} rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={remove} disabled={deleting}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/30">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* RIGHT: projects */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Projects</h4>
          {!assigning && (
            <button onClick={openAssign} className="text-xs font-medium text-blue-600 hover:text-blue-700">+ Assign to Project</button>
          )}
        </div>

        {assigning && (
          creatingProject ? (
            <div className="mb-3">
              <CreateProjectInline
                vendorId={vendor.id}
                onCreated={() => { closeAssign(); loadDetail(); onSaved(); }}
                onCancel={() => setCreatingProject(false)}
              />
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
              <label className="mb-1 block text-xs text-gray-500">Project</label>
              <select value={assignWoId} onChange={e => setAssignWoId(e.target.value)}
                className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                <option value="">Select a project…</option>
                {workOrders.map(w => <option key={w.id} value={w.id}>{woLabel(w)}</option>)}
              </select>
              <button onClick={() => setCreatingProject(true)}
                className="mb-2 text-xs font-medium text-green-700 hover:text-green-800 dark:text-green-400">+ Create New Project</button>
              <label className="mb-1 block text-xs text-gray-500">Quoted Cost ($)</label>
              <input type="number" value={assignCost} onChange={e => setAssignCost(e.target.value)}
                className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
              <div className="flex gap-2">
                <button onClick={submitAssign} disabled={assignSaving || !assignWoId}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {assignSaving ? 'Saving…' : 'Assign'}
                </button>
                <button onClick={closeAssign}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
              </div>
            </div>
          )
        )}

        {loadingQuotes ? (
          <p className="text-sm text-gray-400">Loading projects…</p>
        ) : quotes.length === 0 ? (
          <p className="text-sm text-gray-400">No projects assigned yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  {['Project', 'Quoted', 'Final', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {quotes.map(q => (
                  <Fragment key={q.id}>
                    <tr
                      onClick={() => setExpandedProjectId(id => (id === q.work_order_id ? null : q.work_order_id))}
                      className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 ${expandedProjectId === q.work_order_id ? 'bg-gray-100 dark:bg-gray-800/50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <span className="mr-1 inline-block text-gray-400">{expandedProjectId === q.work_order_id ? '▾' : '▸'}</span>
                        {quoteLabel(q)}
                        {q.is_selected && <span className="ml-1 text-green-600">✓</span>}
                        {q.property_address && <span className="ml-4 block text-gray-400">{q.property_address}</span>}
                      </td>
                      <td className="px-3 py-2 tabular">{fmt$(q.quoted_cost)}</td>
                      <td className="px-3 py-2 tabular">{fmt$(q.final_cost)}</td>
                      <td className="px-3 py-2 text-gray-500">{q.status ? tradeLabel(q.status) : '—'}</td>
                    </tr>
                    {expandedProjectId === q.work_order_id && (
                      <tr className="bg-gray-50 dark:bg-gray-900/40">
                        <td colSpan={4} className="px-3 py-3">
                          <ProjectQuotes
                            workOrderId={q.work_order_id}
                            projectLabel={quoteLabel(q)}
                            onChanged={() => { loadDetail(); onSaved(); }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline "create new project + assign this vendor" form (shared) ────────────────
interface PropertyOption { id: number; address: string }
const PROJECT_STATUSES = [
  { value: 'received', label: 'Received' },
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
];

function CreateProjectInline({ vendorId, onCreated, onCancel }: { vendorId: number; onCreated: () => void; onCancel: () => void }) {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [projectName, setProjectName] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [status, setStatus] = useState('received');
  const [quotedCost, setQuotedCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v2/properties');
        if (res.ok) {
          const data = await res.json();
          const list: PropertyOption[] = Array.isArray(data) ? data : [];
          setProperties(list);
          if (list.length === 1) setPropertyId(String(list[0].id));
        }
      } catch (e) { console.error('Failed to load properties:', e); }
    })();
  }, []);

  const create = async () => {
    if (!projectName.trim() || !propertyId) { setError('Project name and property are required.'); return; }
    setSaving(true); setError('');
    try {
      const woRes = await fetch('/api/v2/work-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: Number(propertyId), project_name: projectName.trim(), status }),
      });
      if (!woRes.ok) { setError('Failed to create project.'); return; }
      const wo = await woRes.json();
      await fetch('/api/v2/project-quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: wo.id, vendor_id: vendorId, quoted_cost: quotedCost ? parseFloat(quotedCost) : null }),
      });
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
      <p className="mb-2 text-xs font-semibold text-green-800 dark:text-green-300">Create New Project</p>
      <label className="mb-1 block text-xs text-gray-500">Project Name</label>
      <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Roof replacement"
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
      <label className="mb-1 block text-xs text-gray-500">Property</label>
      <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
        <option value="">Select a property…</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
      </select>
      <label className="mb-1 block text-xs text-gray-500">Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800">
        {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <label className="mb-1 block text-xs text-gray-500">Quoted Cost ($)</label>
      <input type="number" value={quotedCost} onChange={e => setQuotedCost(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={create} disabled={saving || !projectName.trim() || !propertyId}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create & Assign'}
        </button>
        <button onClick={onCancel}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
      </div>
    </div>
  );
}

// ── All competing quotes on a single project, with inline per-quote status ────────
interface ProjectQuoteRow {
  id: number; vendor_id: number; vendor_name: string; vendor_trade: string | null;
  quoted_cost: number | null; final_cost: number | null;
  is_selected: boolean; status: string | null;
}

function ProjectQuotes({ workOrderId, projectLabel, onChanged }: { workOrderId: number; projectLabel: string; onChanged: () => void }) {
  const [rows, setRows] = useState<ProjectQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v2/work-orders/${workOrderId}`);
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data.quotes) ? data.quotes : []);
      }
    } catch (e) {
      console.error('Failed to load project quotes:', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workOrderId]);

  const updateStatus = async (quoteId: number, status: string) => {
    setRows(prev => prev.map(r => (r.id === quoteId ? { ...r, status } : r))); // optimistic
    setSavingId(quoteId);
    try {
      await fetch(`/api/v2/project-quotes/${quoteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      onChanged();
    } finally { setSavingId(null); }
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        All Quotes — {projectLabel}
      </p>
      {loading ? (
        <p className="text-xs text-gray-400">Loading quotes…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">No quotes on this project yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                {['Vendor', 'Quoted', 'Final', 'Status', 'Selected'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    {r.vendor_name}
                    {r.vendor_trade && <span className="block text-gray-400">{tradeLabel(r.vendor_trade)}</span>}
                  </td>
                  <td className="px-3 py-2 tabular">{fmt$(r.quoted_cost)}</td>
                  <td className="px-3 py-2 tabular">{fmt$(r.final_cost)}</td>
                  <td className="px-3 py-2">
                    <select
                      value={r.status ?? 'received'}
                      disabled={savingId === r.id}
                      onChange={e => updateStatus(r.id, e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800"
                    >
                      {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {r.is_selected
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/40 dark:text-green-400">✓ Selected</span>
                      : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImpField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
    </div>
  );
}
