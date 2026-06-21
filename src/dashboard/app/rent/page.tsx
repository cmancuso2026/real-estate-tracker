'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PreviewRow {
  raw_date: string;
  description: string;
  amount: number;
  matched_tenant_id: number | null;
  matched_tenant_name: string | null;
  matched_unit_id: number | null;
  matched_unit_label: string | null;
  matched_property_address: string | null;
  assigned_month: string;
  due_date: string;
  is_early: boolean;
  is_late: boolean;
  late_fee_applicable: boolean;
  late_fee_amount: number | null;
  confidence: 'high' | 'low' | 'none';
  note: string;
}

function fmt$(n: number) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function ConfidenceBadge({ c }: { c: string }) {
  if (c === 'high') return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Matched</span>;
  if (c === 'low')  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Low confidence</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">No match</span>;
}

export default function RentImportPage() {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function handleFile(file: File) {
    setUploading(true); setError(''); setPreview(null); setSaved(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v2/rent/import', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setError(data.error ?? 'Upload failed'); return; }
    setPreview(data.preview);
    setRows(data.preview);
  }

  function updateRow(i: number, patch: Partial<PreviewRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  async function confirm() {
    setSaving(true);
    const approved = rows.filter(r => r.matched_unit_id);
    const res = await fetch('/api/v2/rent/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: approved }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Save failed'); return; }
    setSaved(data.saved);
    setPreview(null);
  }

  const matchedCount = rows.filter(r => r.matched_unit_id).length;
  const unmatchedCount = rows.filter(r => !r.matched_unit_id).length;
  const earlyCount = rows.filter(r => r.is_early).length;
  const lateFeeCount = rows.filter(r => r.late_fee_applicable).length;

  return (
    <>
      <div className="mb-6">
        <Link href="/properties" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← My Properties</Link>
        <h1 className="mt-1 text-2xl font-bold">Import Rent Payments</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Upload a Bank of America CSV export — transactions are matched to tenants across all properties</p>
      </div>

      {saved !== null ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950/20">
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">✓ {saved} payment{saved !== 1 ? 's' : ''} recorded</p>
          <div className="mt-4 flex justify-center gap-3">
            <button onClick={() => { setSaved(null); setRows([]); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Import Another</button>
            <Link href="/properties" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Back to Properties</Link>
          </div>
        </div>
      ) : !preview ? (
        <div className="max-w-lg">
          <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-colors dark:border-gray-700 dark:bg-gray-900 ${uploading ? 'opacity-50' : ''}`}>
            <span className="text-4xl mb-3">📄</span>
            <p className="font-medium text-gray-700 dark:text-gray-300">{uploading ? 'Parsing CSV…' : 'Click to upload BofA CSV'}</p>
            <p className="mt-1 text-xs text-gray-400">Download from BofA → Account → Download → CSV format</p>
            <input type="file" accept=".csv" className="hidden" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Transactions', value: rows.length, color: '' },
              { label: 'Matched', value: matchedCount, color: 'text-green-600' },
              { label: 'Unmatched', value: unmatchedCount, color: unmatchedCount > 0 ? 'text-red-500' : '' },
              { label: 'Early Payments', value: earlyCount, color: 'text-blue-600' },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {lateFeeCount > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
              ⚠ {lateFeeCount} payment{lateFeeCount > 1 ? 's' : ''} may have late fees applicable — review below
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

          {/* Preview table */}
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['Date', 'Description', 'Amount', 'Matched Tenant', 'Property / Unit', 'Assigned Month', 'Flags'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((row, i) => (
                  <tr key={i} className={row.matched_unit_id ? '' : 'bg-red-50/30 dark:bg-red-950/10'}>
                    <td className="px-4 py-3 tabular text-xs text-gray-500">{row.raw_date}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-48 truncate">{row.description}</td>
                    <td className="px-4 py-3 tabular font-medium">{fmt$(row.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <ConfidenceBadge c={row.confidence} />
                        {row.matched_tenant_name && (
                          <p className="text-xs font-medium">{row.matched_tenant_name}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.matched_property_address
                        ? <div><p className="font-medium">{row.matched_property_address}</p><p className="text-gray-400">Unit {row.matched_unit_label}</p></div>
                        : <span className="italic text-gray-400">Unmatched</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.assigned_month}
                        onChange={e => {
                          const m = e.target.value;
                          updateRow(i, { assigned_month: m, due_date: `${m}-01` });
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
                      >
                        {/* Show 6 months around the assigned month */}
                        {Array.from({ length: 6 }, (_, j) => {
                          const d = new Date(row.assigned_month + '-01');
                          d.setMonth(d.getMonth() - 2 + j);
                          const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                          return <option key={m} value={m}>{m}</option>;
                        })}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {row.is_early && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Early</span>}
                        {row.is_late && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Late</span>}
                        {row.late_fee_applicable && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">Fee not charged{row.late_fee_amount ? ` ($${row.late_fee_amount})` : ''}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={confirm}
              disabled={saving || matchedCount === 0}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save ${matchedCount} Matched Payment${matchedCount !== 1 ? 's' : ''}`}
            </button>
            <button onClick={() => { setPreview(null); setRows([]); }}
              className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              Start Over
            </button>
          </div>
          <p className="text-xs text-gray-400">{unmatchedCount > 0 ? `${unmatchedCount} unmatched transaction${unmatchedCount > 1 ? 's' : ''} will be skipped. You can record them manually from the Rent tab.` : 'All transactions matched.'}</p>
        </div>
      )}
    </>
  );
}
