'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';

interface ParsedRow {
  raw_date: string; description: string; amount: number;
  matched_tenant_id: number | null; matched_tenant_name: string | null;
  matched_unit_id: number | null; matched_unit_label: string | null;
  matched_property_address: string | null; matched_lease_id: number | null;
  assigned_month: string; due_date: string;
  is_early: boolean; is_late: boolean;
  late_fee_applicable: boolean; late_fee_included: boolean; late_fee_amount: number | null;
  confidence: 'high' | 'low' | 'none'; category: 'rent' | 'non_rent'; note: string;
}
interface TenantOption { id: number; name: string; unit_label: string; }

function fmt$(n: number) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function ConfidenceBadge({ c }: { c: string }) {
  if (c === 'high') return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">High</span>;
  if (c === 'low')  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Low</span>;
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">No match</span>;
}

// Multi-select dropdown slicer
function MultiSlicer({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(value: string) {
    const next = new Set(selected);
    if (value === 'all') { onChange(new Set(['all'])); return; }
    next.delete('all');
    if (next.has(value)) next.delete(value); else next.add(value);
    if (next.size === 0) next.add('all');
    onChange(next);
  }

  const isAll = selected.has('all') || selected.size === 0;
  const displayLabel = isAll
    ? `All ${label}`
    : selected.size === 1
      ? options.find(o => selected.has(o.value))?.label ?? `${selected.size} selected`
      : `${selected.size} selected`;

  return (
    <div className="relative" ref={ref}>
      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <span>{displayLabel}</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 min-w-48 rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {options.map(o => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
              <input
                type="checkbox"
                checked={o.value === 'all' ? isAll : selected.has(o.value)}
                onChange={() => toggle(o.value)}
                className="rounded"
              />
              <span className="text-sm">{o.label}</span>
              {o.count !== undefined && <span className="ml-auto text-xs text-gray-400">{o.count}</span>}
            </label>
          ))}
        </div>
      )}
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

  const [confidenceFilter, setConfidenceFilter] = useState(new Set(['all']));
  const [categoryFilter, setCategoryFilter] = useState(new Set(['all']));
  const [tenantFilter, setTenantFilter] = useState(new Set(['all']));

  async function handleFile(file: File) {
    setUploading(true); setError(''); setSaved(null);
    const form = new FormData(); form.append('file', file);
    const res = await fetch('/api/v2/rent/import', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setError(data.error ?? 'Upload failed'); return; }
    setRows(data.preview);
    setTenantOptions(data.tenants ?? []);
    setConfidenceFilter(new Set(['all']));
    setCategoryFilter(new Set(['all']));
    setTenantFilter(new Set(['all']));
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
      matched_tenant_id: t.id, matched_tenant_name: t.name,
      matched_unit_label: t.unit_label, confidence: 'high', category: 'rent',
    });
  }

  // Only show tenants that appear in the data
  const activeTenantOptions = useMemo(() => {
    const seen = new Set(rows.filter(r => r.matched_tenant_id).map(r => r.matched_tenant_id!));
    return tenantOptions.filter(t => seen.has(t.id));
  }, [rows, tenantOptions]);

  const filtered = useMemo(() => {
    const confAll = confidenceFilter.has('all');
    const catAll = categoryFilter.has('all');
    const tenAll = tenantFilter.has('all');

    return rows.filter(r => {
      if (!confAll && !confidenceFilter.has(r.confidence)) return false;
      if (!catAll && !categoryFilter.has(r.category)) return false;
      if (!tenAll) {
        const tid = r.matched_tenant_id ? String(r.matched_tenant_id) : 'non_rent';
        if (!tenantFilter.has(tid)) return false;
      }
      return true;
    });
  }, [rows, confidenceFilter, categoryFilter, tenantFilter]);

  const counts = useMemo(() => ({
    high: rows.filter(r => r.confidence === 'high').length,
    low: rows.filter(r => r.confidence === 'low').length,
    none: rows.filter(r => r.confidence === 'none').length,
    rent: rows.filter(r => r.category === 'rent').length,
    non_rent: rows.filter(r => r.category === 'non_rent').length,
    early: rows.filter(r => r.is_early).length,
    late_fee_not_charged: rows.filter(r => r.late_fee_applicable && !r.late_fee_included).length,
    late_fee_included: rows.filter(r => r.late_fee_included).length,
  }), [rows]);

  const rentRows = rows.filter(r => r.category === 'rent');
  const totalRent = rentRows.reduce((s, r) => s + r.amount, 0);

  async function confirm() {
    setSaving(true);
    const toSave = rows.filter(r => r.category === 'rent' && r.matched_unit_id);
    const res = await fetch('/api/v2/rent/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toSave }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Save failed'); return; }
    setSaved(data.saved);
    setRows([]);
  }

  if (saved !== null) return (
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

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700">← My Properties</Link>
          <h1 className="mt-1 text-2xl font-bold">Import Rent Payments</h1>
          <p className="text-sm text-gray-500">Upload a Bank of America CSV — Zelle payments matched to tenants across all properties</p>
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
          {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'Total Transactions', value: rows.length, sub: '' },
              { label: 'Rent Payments', value: counts.rent, sub: fmt$(totalRent), color: 'text-green-600' },
              { label: 'Non-Rent', value: counts.non_rent, sub: 'skipped', color: 'text-gray-400' },
              { label: 'Early Payments', value: counts.early, sub: 'next month', color: 'text-blue-600' },
              { label: 'Late Fee Not Charged', value: counts.late_fee_not_charged, sub: counts.late_fee_included > 0 ? `${counts.late_fee_included} fee included in payment` : '', color: 'text-amber-600' },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`mt-1 text-2xl font-bold ${c.color ?? ''}`}>{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </div>
            ))}
          </div>

          {/* Multi-select slicers */}
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <MultiSlicer
              label="Confidence"
              selected={confidenceFilter}
              onChange={setConfidenceFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'high', label: 'High confidence', count: counts.high },
                { value: 'low', label: 'Low confidence', count: counts.low },
                { value: 'none', label: 'No match', count: counts.none },
              ]}
            />
            <MultiSlicer
              label="Category"
              selected={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'rent', label: 'Rent', count: counts.rent },
                { value: 'non_rent', label: 'Non-Rent', count: counts.non_rent },
              ]}
            />
            <MultiSlicer
              label="Tenant"
              selected={tenantFilter}
              onChange={setTenantFilter}
              options={[
                { value: 'all', label: 'All' },
                ...activeTenantOptions.map(t => ({
                  value: String(t.id),
                  label: `${t.name} (${t.unit_label})`,
                  count: rows.filter(r => r.matched_tenant_id === t.id).length,
                })),
                { value: 'non_rent', label: 'Non-Rent / Unmatched', count: counts.non_rent },
              ]}
            />
            <p className="text-xs text-gray-400 ml-auto">Showing {filtered.length} of {rows.length}</p>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['Date','Description','Amount','Match','Tenant','Month','Flags'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No transactions match current filters</td></tr>
                ) : filtered.map((row, i) => {
                  const actualIdx = rows.indexOf(row);
                  return (
                    <tr key={i} className={row.category === 'non_rent' ? 'bg-gray-50/50 dark:bg-gray-900/20' : ''}>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{row.raw_date}</td>
                      <td className="px-4 py-3 max-w-52">
                        <p className="truncate text-xs text-gray-600 dark:text-gray-400">{row.description}</p>
                        {row.note && <p className="text-xs text-gray-400 mt-0.5">{row.note}</p>}
                      </td>
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">{fmt$(row.amount)}</td>
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
                          <p className="mt-0.5 text-xs text-gray-400">{row.matched_property_address}</p>
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
                          {row.is_early && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Early</span>}
                          {row.is_late && !row.late_fee_included && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Late</span>}
                          {row.late_fee_included && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Late + fee included{row.late_fee_amount ? ` ($${row.late_fee_amount})` : ''}</span>}
                          {row.late_fee_applicable && !row.late_fee_included && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Fee not charged{row.late_fee_amount ? ` ($${row.late_fee_amount})` : ''}</span>}
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
            <button onClick={confirm} disabled={saving || rentRows.filter(r => r.matched_unit_id).length === 0}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : `Save ${rentRows.filter(r => r.matched_unit_id).length} Rent Payments`}
            </button>
            <button onClick={() => { setRows([]); setError(''); }}
              className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700">
              Start Over
            </button>
            <p className="text-xs text-gray-400">{counts.non_rent} non-rent rows will be skipped</p>
          </div>
        </div>
      )}
    </>
  );
}
