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

const TRADES = ['plumbing','hvac','electrical','roofing','appliance','landscaping','pest_control','general','other'];

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tradeLabel = (s: string | null | undefined) => (s ? s.split('_').map(capitalize).join(' ') : '—');
function fmt$(n: number | null) { return n == null ? '—' : '$' + Number(n).toLocaleString(); }
function Stars({ rating, max = 5 }: { rating: number | null; max?: number }) {
  if (!rating) return <span className="text-xs text-gray-400">—</span>;
  return <span className="text-amber-500 text-sm">{'★'.repeat(Math.round(rating))}{'☆'.repeat(max - Math.round(rating))}</span>;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [spend, setSpend] = useState<SpendResponse | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trade: 'general', phone: '', email: '', website: '' });
  const [saving, setSaving] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    const [vRes, sRes] = await Promise.all([
      fetch(`/api/v2/vendors${q ? `?search=${encodeURIComponent(q)}` : ''}`),
      fetch('/api/v2/vendors/spend'),
    ]);
    setVendors(await vRes.json());
    if (sRes.ok) setSpend(await sRes.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.trade) return;
    setSaving(true);
    await fetch('/api/v2/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setSaving(false);
    setShowForm(false);
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
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
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

      {/* Search */}
      <div className="mb-4">
        <input
          type="text" placeholder="Search by name or trade…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(search)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {/* Add vendor form */}
      {showForm && (
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
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

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
