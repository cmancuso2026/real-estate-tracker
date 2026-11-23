'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';

interface Summary {
  total: number;
  by_category: { category: string; count: number; amount: number }[];
  by_suggested_property: { property_id: number | null; address: string | null; count: number }[];
}
const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminAttributionPage() {
  const [s, setS] = useState<Summary | null>(null);
  const [rerun, setRerun] = useState<{ count: number; with_suggestion: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await financeApi.get<Summary>('/api/admin/attribution'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Attribution</h2>
          <p className="mt-1 text-sm text-gray-500">Transactions in categories that require a property and don&apos;t have one yet.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setRerun(await financeApi.post('/api/admin/attribution/rerun'));
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Re-running…' : 'Re-run suggestions'}
          </button>
          <Link href="/finance/attribution" className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Open the queue →
          </Link>
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {rerun && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          Suggestions refreshed: {rerun.with_suggestion} of {rerun.count} waiting transactions now have one. Nothing was saved.
        </div>
      )}
      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold">
              By category <span className="font-normal text-gray-400">({s.total} waiting)</span>
            </h3>
            <table className="mt-2 w-full text-sm" data-testid="attr-by-category">
              <tbody>
                {s.by_category.map((c) => (
                  <tr key={c.category} className="border-t border-gray-100">
                    <td className="py-1.5">{c.category}</td>
                    <td className="py-1.5 text-right tabular text-gray-500">{money(c.amount)}</td>
                    <td className="py-1.5 text-right font-semibold tabular">{c.count}</td>
                  </tr>
                ))}
                {s.total === 0 && (
                  <tr>
                    <td className="py-3 text-center text-gray-400">Nothing waiting.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold">By suggested property</h3>
            <table className="mt-2 w-full text-sm" data-testid="attr-by-property">
              <tbody>
                {s.by_suggested_property.map((p) => (
                  <tr key={String(p.property_id)} className="border-t border-gray-100">
                    <td className="py-1.5">{p.address ?? <span className="text-gray-400">No suggestion yet</span>}</td>
                    <td className="py-1.5 text-right font-semibold tabular">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
