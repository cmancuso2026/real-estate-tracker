'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface ParsedRow {
  raw_date: string;
  description: string;
  amount: number;
  matched_tenant_id: number | null;
  matched_tenant_name: string | null;
  matched_unit_id: number | null;
  matched_unit_label: string | null;
  matched_property_address: string | null;
  matched_lease_id: number | null;
  assigned_month: string;
  due_date: string;
  is_early: boolean;
  is_late: boolean;
  late_fee_applicable: boolean;
  late_fee_amount: number | null;
  confidence: 'high' | 'low' | 'none';
  category: 'rent' | 'non_rent';
  note: string;
}

interface TenantOption { id: number; name: string; unit_label: string; }

type ConfidenceFilter = 'all' | 'high' | 'low' | 'none';
type CategoryFilter = 'all' | 'rent' | 'non_rent';

function fmt$(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ConfidenceBadge({ c }: { c: string }) {
  if (c === 'high') return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">High</span>;
  if (c === 'low')  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Low</span>;
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800">No match</span>;
}

function Slicer({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              value === o.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            {o.label}{o.count !== undefined ? ` (${o.count})` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RentImportPage() {
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Slicers
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [tenantFilter, setTenantFilter] = useState<string>('all');

  async function handleFile(file: File) {
    setUploading(true); setError(''); setSaved(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v2/rent/import', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setError(data.error ?? 'Upload failed'); return; }
    setRows(data.preview);
    setTenantOptions(data.tenants ?? []);
  }

  function updateRow(i: number, patch: Partial<ParsedRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function reassignTenant(rowIdx: number, tenantId: string) {
    if (!tenantId) {
      updateRow(rowIdx, {
        matched_tenant_id: null, matched_tenant_name: null,
        matched_unit_id: null, matched_unit_label: null,
        matched_property_address: null, matched_lease_id: null,
        confidence: 'none', category: 'non_rent',
      });
      return;
    }
    const t = tenantOptions.find(t => String(t.id) === tenantId);
    if (!t) return;
    updateRow(rowIdx, {
      matched_tenant_id: t.id,
      matched_tenant_name: t.name,
      matched_unit_label: t.unit_label,
      confidence: 'high',
      category: 'rent',
    });
  }

  // Filtered rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (confidenceFilter !== 'all' && r.confidence !== confidenceFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (tenantFilter !== 'all') {
        if (tenantFilter === 'non_rent' && r.category !== 'non_rent') return false;
        if (tenantFilter !== 'non_rent' && String(r.matched_tenant_id) !== tenantFilter) return false;
      }
      return true;
    });
  }, [rows, confidenceFilter, categoryFilter, tenantFilter]);

  // Counts for slicers
  const counts = useMemo(() => ({
    high: rows.filter(r => r.confidence === 'high').length,
    low:  rows.filter(r => r.confidence === 'low').length,
    none: rows.filter(r => r.confidence === 'none').length,
    rent: rows.filter(r => r.category === 'rent').length,
    non_rent: rows.filter(r => r.category === 'non_rent').length,
    early: rows.filter(r => r.is_early).length,
    late_fee: rows.filter(r => r.late_fee_applicable).length,
  }), [rows]);

  const rentRows = rows.filter(r => r.category === 'rent');
  const totalRent = rentRows.reduce((s, r) => s + r.amount, 0);

  async function confirm() {
    setSaving(true);
    const res = await fetch('/api/v2/rent/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows.filter(r => r.category === 'rent' && r.matched_unit_id) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Save failed'); return; }
    setSaved(data.saved);
    setRows([]);
  }

  if (saved !== null) {
    return (
      <>
        <div className="mb-6">
          <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700">← My Properties</Link>
          <h1 className="mt-1 text-2xl font-bold">Import Rent Payments</h1>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-800 dark:bg-green-950/20">
          <p className="text-3xl font-bold text-green-700 dark:text-green-400">✓ {saved} payment{saved !== 1 ? 's' : ''} recorded</p>
          <div className="mt-4 flex justify-center gap-3">
            <button onClick={() => { setSaved(null); setRows([]); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Import Another</button>
            <Link href="/properties" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Back to Properties</Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700">← My Properties</Link>
          <h1 className="mt-1 text-2xl font-bold">Import Rent Payments</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Upload a Bank of America CSV — Zelle payments are matched to tenants across all properties</p>
        </div>
        {rows.length > 0 && (
          <label className={`cursor-pointer rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 ${uploading ? 'opacity-50' : ''}`}>
            {uploading ? 'Parsing…' : 'Upload New CSV'}
            <input type="file" accept=".csv" className="hidden" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="max-w-lg">
          <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-colors dark:border-gray-700 dark:bg-gray-900 ${uploading ? 'opacity-50' : ''}`}>
            <span className="text-5xl mb-3">📄</span>
            <p className="font-semibold text-gray-700 dark:text-gray-200">{uploading ? 'Parsing CSV…' : 'Click to upload BofA CSV'}</p>
            <p className="mt-1 text-xs text-gray-400">BofA → Account → Download → Microsoft Excel format (CSV)</p>
            <input type="file" accept=".csv" className="hidden" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'Total Transactions', value: rows.length, sub: '' },
              { label: 'Rent Payments', value: counts.rent, sub: fmt$(totalRent), color: 'text-green-600' },
              { label: 'Non-Rent', value: counts.non_rent, sub: 'skipped', color: 'text-gray-400' },
              { label: 'Early Payments', value: counts.early, sub: 'assigned next month', color: 'text-blue-600' },
              { label: 'Late Fee Alerts', value: counts.late_fee, sub: 'fee not charged', color: 'text-amber-600' },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`mt-1 text-2xl font-bold ${c.color ?? ''}`}>{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </div>
            ))}
          </div>

          {/* Slicers */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-800 dark:bg-gray-900">
            <Slicer
              label="Confidence"
              value={confidenceFilter}
              onChange={v => setConfidenceFilter(v as ConfidenceFilter)}
              options={[
                { value: 'all', label: 'All', count: rows.length },
                { value: 'high', label: 'High', count: counts.high },
                { value: 'low', label: 'Low', count: counts.low },
                { value: 'none', label: 'No Match', count: counts.none },
              ]}
            />
            <Slicer
              label="Category"
              value={categoryFilter}
              onChange={v => setCategoryFilter(v as CategoryFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'rent', label: 'Rent', count: counts.rent },
                { value: 'non_rent', label: 'Non-Rent', count: counts.non_rent },
              ]}
            />
            <Slicer
              label="Tenant"
              value={tenantFilter}
              onChange={setTenantFilter}
              options={[
                { value: 'all', label: 'All' },
                ...tenantOptions.map(t => ({
                  value: String(t.id),
                  label: `${t.name} (${t.unit_label})`,
                  count: rows.filter(r => r.matched_tenant_id === t.id).length,
                })),
                { value: 'non_rent', label: 'Non-Rent / Unmatched', count: counts.non_rent },
              ]}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>}

          {/* Transaction table */}
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['Date','Description','Amount','Confidence','Matched Tenant','Month','Flags'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No transactions match the current filters</td></tr>
                ) : filtered.map((row, i) => {
                  // Find actual index in full rows array
                  const actualIdx = rows.indexOf(row);
                  return (
                    <tr key={i} className={`${row.category === 'non_rent' ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}`}>
                      <td className="px-4 py-3 tabular text-xs text-gray-500 whitespace-nowrap">{row.raw_date}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-56">
                        <p className="truncate">{row.description}</p>
                        {row.note && <p className="text-gray-400 mt-0.5">{row.note}</p>}
                      </td>
                      <td className="px-4 py-3 tabular font-semibold whitespace-nowrap">{fmt$(row.amount)}</td>
                      <td className="px-4 py-3"><ConfidenceBadge c={row.confidence} /></td>
                      <td className="px-4 py-3 min-w-48">
                        <select
                          value={row.matched_tenant_id ? String(row.matched_tenant_id) : ''}
                          onChange={e => reassignTenant(actualIdx, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                        >
                          <option value="">— Non-Rent —</option>
                          {tenantOptions.map(t => (
                            <option key={t.id} value={t.id}>{t.name} (Unit {t.unit_label})</option>
                          ))}
                        </select>
                        {row.matched_property_address && (
                          <p className="mt-1 text-xs text-gray-400">{row.matched_property_address}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={row.assigned_month}
                          onChange={e => updateRow(actualIdx, { assigned_month: e.target.value, due_date: `${e.target.value}-01` })}
                          className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                        >
                          {Array.from({ length: 8 }, (_, j) => {
                            const d = new Date((row.assigned_month || new Date().toISOString().slice(0,7)) + '-01');
                            d.setMonth(d.getMonth() - 3 + j);
                            const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                            return <option key={m} value={m}>{m}</option>;
                          })}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {row.is_early && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Early</span>}
                          {row.is_late && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Late</span>}
                          {row.late_fee_applicable && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Fee not charged{row.late_fee_amount ? ` ($${row.late_fee_amount})` : ''}</span>}
                          {row.category === 'non_rent' && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">Non-Rent</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={confirm}
              disabled={saving || counts.rent === 0}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save ${rows.filter(r => r.category === 'rent' && r.matched_unit_id).length} Rent Payment${counts.rent !== 1 ? 's' : ''}`}
            </button>
            <button onClick={() => { setRows([]); setError(''); }}
              className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              Start Over
            </button>
            <p className="text-xs text-gray-400">{counts.non_rent} non-rent transaction{counts.non_rent !== 1 ? 's' : ''} will be skipped</p>
          </div>
        </div>
      )}
    </>
  );
}
