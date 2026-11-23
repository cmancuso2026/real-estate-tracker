'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';

interface Change {
  action: 'create' | 'update' | 'relink' | 'remove';
  id: number;
  date: string;
  description: string;
  amount: number;
  property: string | null;
  unit?: string | null;
  due_date?: string;
  method?: string;
  reason: string | null;
}
interface Result {
  dry_run: boolean;
  scanned: number;
  created: number;
  updated: number;
  relinked: number;
  removed: number;
  already_recorded: number;
  unmatched: { id: number; date: string; description: string; amount: number; property: string | null; reason: string }[];
  changes: Change[];
}

const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHOD: Record<string, string> = { single_unit: 'only unit', name: 'tenant name', category: 'category', amount: 'rent amount' };

function Stat({ n, label, testId }: { n: number; label: string; testId: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2" data-testid={testId}>
      <div className="text-2xl font-bold tabular">{n.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

/**
 * Admin → Rent from uploads: record rent_collections rows for rent payments
 * that were uploaded before rent was matched automatically. Preview first;
 * Apply writes, and is safe to repeat.
 */
export default function AdminRentBackfillPage() {
  const [preview, setPreview] = useState<Result | null>(null);
  const [applied, setApplied] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPreview(await financeApi.get<Result>('/api/admin/rent-backfill'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      setApplied(await financeApi.post<Result>('/api/admin/rent-backfill', {}));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const p = preview;
  const toWrite = p ? p.created + p.updated + p.relinked + p.removed : 0;
  const created = p ? p.changes.filter((c) => c.action === 'create') : [];
  const other = p ? p.changes.filter((c) => c.action !== 'create') : [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Rent from uploads</h2>
        <p className="mt-1 text-sm text-gray-500">
          New uploads record rent on the right unit automatically. This catches up the rent payments that were uploaded
          before that, using the same matching. Rent you entered by hand or with the old CSV import is never changed, and
          payments it already covers are skipped. Nothing is saved until you press Apply; running it again changes nothing.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {applied && (
        <div role="status" data-testid="rent-backfill-applied" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Done: {applied.created} rent payment{applied.created === 1 ? '' : 's'} recorded
          {applied.updated + applied.relinked + applied.removed > 0 && `, ${applied.updated + applied.relinked + applied.removed} updated`}.
          {applied.unmatched.length > 0 && (
            <>
              {' '}
              {applied.unmatched.length} still need a unit —{' '}
              <Link href="/finance/attribution#rent" className="font-medium underline">
                pick them on Needs Property
              </Link>
              .
            </>
          )}
        </div>
      )}

      {!p ? (
        <div className="text-sm text-gray-400">Checking rent payments…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat n={p.created} label="will be recorded" testId="rb-created" />
            <Stat n={p.updated + p.relinked + p.removed} label="will be updated" testId="rb-updated" />
            <Stat n={p.already_recorded} label="already recorded by hand" testId="rb-already" />
            <Stat n={p.unmatched.length} label="need a unit (you pick)" testId="rb-unmatched" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={busy || toWrite === 0}
              onClick={() => void apply()}
              data-testid="rb-apply"
            >
              {busy ? 'Applying…' : toWrite === 0 ? 'Nothing to apply' : `Apply: record ${toWrite} rent payment${toWrite === 1 ? '' : 's'}`}
            </button>
            {p.unmatched.length > 0 && (
              <Link href="/finance/attribution#rent" className="text-sm font-medium text-blue-600 hover:underline">
                Pick units for the {p.unmatched.length} unmatched →
              </Link>
            )}
          </div>

          {created.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white">
              <h3 className="border-b border-gray-100 px-4 py-2 text-sm font-semibold">Will be recorded ({created.length})</h3>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-4 py-1.5">Paid</th>
                      <th className="px-4 py-1.5">Description</th>
                      <th className="px-4 py-1.5">Property · unit</th>
                      <th className="px-4 py-1.5">Rent for</th>
                      <th className="px-4 py-1.5">Matched by</th>
                      <th className="px-4 py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {created.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="whitespace-nowrap px-4 py-1.5 text-gray-600">{c.date}</td>
                        <td className="px-4 py-1.5">{c.description}</td>
                        <td className="px-4 py-1.5 text-gray-600">
                          {c.property} · unit {c.unit}
                        </td>
                        <td className="whitespace-nowrap px-4 py-1.5 text-gray-600">{c.due_date?.slice(0, 7)}</td>
                        <td className="px-4 py-1.5 text-gray-500">{METHOD[c.method ?? ''] ?? c.method}</td>
                        <td className="px-4 py-1.5 text-right tabular text-green-700">{money(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {other.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm">
              <h3 className="font-semibold">Will be updated ({other.length})</h3>
              <ul className="mt-1 space-y-0.5 text-gray-600">
                {other.map((c) => (
                  <li key={`${c.action}-${c.id}`}>
                    {c.action}: {c.date} {c.description} {money(c.amount)}
                    {c.reason ? ` — ${c.reason}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.unmatched.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white">
              <h3 className="border-b border-gray-100 px-4 py-2 text-sm font-semibold">Need a unit ({p.unmatched.length})</h3>
              <table className="w-full text-sm">
                <tbody>
                  {p.unmatched.map((u) => (
                    <tr key={u.id} className="border-t border-gray-100 first:border-t-0">
                      <td className="whitespace-nowrap px-4 py-1.5 text-gray-600">{u.date}</td>
                      <td className="px-4 py-1.5">
                        {u.description}
                        <div className="text-xs text-gray-400">{u.reason}</div>
                      </td>
                      <td className="px-4 py-1.5 text-gray-600">{u.property}</td>
                      <td className="px-4 py-1.5 text-right tabular text-green-700">{money(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
