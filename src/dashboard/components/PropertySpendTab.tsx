'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface SpendTxn {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
  source: string;
  project_name: string | null;
  unit_label: string | null;
  work_order_id: number | null;
}
interface Rollup {
  year: number;
  ytd: Record<string, number>;
  ytd_total: number;
  months: Record<string, Record<string, number>>;
  transactions: SpendTxn[];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function money(n: number) {
  const s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? '-' + s : s;
}
const tone = (n: number) => (Math.abs(n) < 0.005 ? 'text-gray-300' : n < 0 ? 'text-red-600' : 'text-green-700');

/**
 * "Repairs & spend" on a property: finance transactions linked to this property
 * (transactions.property_id), with totals by category per month and year-to-date.
 */
export function PropertySpendTab({ id }: { id: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Rollup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/finance/rollups/property/${id}?year=${year}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
        if (alive) setData(d);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id, year]);

  const years = useMemo(() => {
    const ys = new Set((data?.transactions ?? []).map((t) => Number(t.date.slice(0, 4))));
    ys.add(new Date().getFullYear());
    ys.add(year);
    return [...ys].sort((a, b) => b - a);
  }, [data, year]);
  const cats = useMemo(() => Object.keys(data?.ytd ?? {}).sort((a, b) => (data!.ytd[a]! - data!.ytd[b]!)), [data]);
  const monthKeys = MON.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const yearTxns = (data?.transactions ?? []).filter((t) => t.date.startsWith(String(year)));

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-12 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4" data-testid="property-spend">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-700">Repairs and spend</h2>
        <div className="flex items-center gap-3 text-sm">
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1"
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <Link href={`/finance/transactions?property=${id}`} className="font-medium text-blue-600 hover:underline">
            Open in Transactions →
          </Link>
        </div>
      </div>

      {yearTxns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
          No finance transactions linked to this property in {year}. Assign them from{' '}
          <Link href="/finance/attribution" className="text-blue-600 hover:underline">
            Needs property
          </Link>
          .
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-500">{year} YTD net</p>
              <p className={`mt-1 text-2xl font-bold tabular ${tone(data.ytd_total)}`} data-testid="spend-ytd">
                {money(data.ytd_total)}
              </p>
            </div>
            {cats.slice(0, 3).map((c) => (
              <div key={c} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-medium text-gray-500">{c} YTD</p>
                <p className={`mt-1 text-xl font-semibold tabular ${tone(data.ytd[c]!)}`}>{money(data.ytd[c]!)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm" data-testid="spend-by-month">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  {MON.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="bg-gray-50 px-3 py-2 text-right font-semibold">YTD</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-3 py-1.5">{c}</td>
                    {monthKeys.map((k) => {
                      const v = data.months[k]?.[c] ?? 0;
                      return (
                        <td key={k} className={`whitespace-nowrap px-2 py-1.5 text-right tabular ${tone(v)}`}>
                          {Math.abs(v) < 0.005 ? '—' : money(v)}
                        </td>
                      );
                    })}
                    <td className={`whitespace-nowrap bg-gray-50 px-3 py-1.5 text-right font-semibold tabular ${tone(data.ytd[c]!)}`}>
                      {money(data.ytd[c]!)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">Project / unit</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {yearTxns.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{t.date}</td>
                    <td className="px-3 py-1.5">{t.description}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{t.category}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">
                      {t.project_name && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">{t.project_name}</span>}
                      {t.unit_label && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5">Unit {t.unit_label}</span>}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular ${tone(t.amount)}`}>{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
