'use client';

import { useEffect, useState } from 'react';

interface Vendor {
  id: number; name: string; trade: string; phone: string | null; email: string | null;
  google_rating: number | null; google_review_count: number | null;
  manual_rating: number | null; manual_notes: string | null;
  total_jobs: number; completed_jobs: number; avg_internal_rating: number | null; total_spend: number | null;
  project_count: number | null;
  is_active: boolean;
}

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

  // Manual add form
  const [form, setForm] = useState({ name: '', trade: 'general', phone: '', email: '', website: '' });
  const [saving, setSaving] = useState(false);

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
    await fetch('/api/v2/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    setAddMode(null);
    setForm({ name: '', trade: 'general', phone: '', email: '', website: '' });
    load();
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
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <td className="px-5 py-3 font-medium">{v.name}</td>
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

function ImpField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800" />
    </div>
  );
}
