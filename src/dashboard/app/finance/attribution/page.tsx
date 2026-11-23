'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { AttributionPicker } from '@/components/finance/AttributionPicker';
import { RentNeedsUnit } from '@/components/finance/RentNeedsUnit';
import { QUEUE_EVENT } from '@/components/NavLinks';
import { SplitEditor, type SplitMode, type SplitRow } from '@/components/finance/SplitEditor';
import { useFinance } from '@/components/finance/FinanceData';
import { Card, btnPrimary, btnSecondary, selectCls } from '@/components/finance/ui';
import { fmt, shortDate } from '@/lib/finance-ui/format';
import { mapTxn, singleAllocation, type ApiTxn } from '@/lib/finance-ui/types';

interface Suggestion {
  property_id: number;
  unit_id: number | null;
  work_order_id: number | null;
  source: string;
  reason: string;
}
type QueueRow = ApiTxn & { suggestion: Suggestion | null };
interface Queue {
  count: number;
  by_category: { category: string; count: number }[];
  transactions: QueueRow[];
}

/** The Needs-property queue: unattributed transactions, newest first, with bulk tools. */
export default function AttributionQueuePage() {
  const { propertyOptions, patchTxns, allowProjectTag, txns, reload: reloadTxns } = useFinance();
  const [bulkSplit, setBulkSplit] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<number | null>(null);
  const [bulkProperty, setBulkProperty] = useState('');
  const [bulkProject, setBulkProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await financeApi.get<Queue>('/api/finance/attribution/queue'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (queue?.transactions ?? []).filter((t) => !category || t.category === category),
    [queue, category],
  );
  useEffect(() => setSelected(new Set()), [category]);
  const selRows = rows.filter((t) => selected.has(t.id));
  const withSuggestion = selRows.filter((t) => t.suggestion);
  const nameOf = (id: number) => propertyOptions.find((p) => p.id === id)?.name ?? `Property ${id}`;
  const projectOf = (id: number | null) => (id ? propertyOptions.flatMap((p) => p.projects).find((w) => w.id === id)?.name : null);
  const bulkProp = propertyOptions.find((p) => String(p.id) === bulkProperty);
  // $ splits need one amount for all of them; % works for any mix.
  const sameAmount = selRows.length && selRows.every((t) => Math.round(t.amount * 100) === Math.round(selRows[0]!.amount * 100)) ? selRows[0]!.amount : null;
  const emptyRow = (): SplitRow => ({ property_id: '', unit_id: '', work_order_id: '', value: '' });
  const projectAllowed = selRows.every((t) => allowProjectTag(t.category));

  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selRows.length > 0 && selRows.length < rows.length;
  }, [selRows.length, rows.length]);

  /** The same split for every selected row (PUT /api/finance/transactions/allocations). */
  async function bulkSplitSave(mode: SplitMode, rows: SplitRow[]) {
    setBusy(true);
    setNotice(null);
    try {
      const ids = selRows.map((t) => t.id);
      const r = await financeApi.put<{ updated: number }>('/api/finance/transactions/allocations', {
        ids,
        mode,
        rows: rows.map((x) => ({
          property_id: Number(x.property_id),
          unit_id: x.unit_id ? Number(x.unit_id) : null,
          work_order_id: x.work_order_id ? Number(x.work_order_id) : null,
          value: Number(x.value),
        })),
      });
      setNotice(`Split ${r.updated} transaction${r.updated === 1 ? '' : 's'}.`);
      setBulkSplit(false);
      setSelected(new Set());
      await load();
      const c = await financeApi.get<{ count: number }>('/api/finance/attribution/count').catch(() => null);
      if (c) window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: c.count }));
      await reloadTxns();
    } catch (err) {
      setNotice('Failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  /** Save attributions, then drop the rows from the queue and update the shared data. */
  async function assign(groups: { ids: number[]; property_id: number; work_order_id: number | null; unit_id: number | null }[]) {
    setBusy(true);
    setNotice(null);
    try {
      let n = 0;
      for (const g of groups) {
        const r = await financeApi.patch<{ updated: number }>('/api/finance/transactions/attribution', g);
        n += r.updated;
        for (const id of g.ids) {
          const amt = txns.find((x) => x.id === id)?.amt ?? 0;
          patchTxns([id], singleAllocation(amt, g.property_id, g.unit_id, g.work_order_id));
        }
      }
      setNotice(`Assigned ${n} transaction${n === 1 ? '' : 's'}.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      setNotice('Failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  function acceptSuggestions(list: QueueRow[]) {
    // One bulk call per distinct suggestion (property + project + unit).
    const byKey = new Map<string, { ids: number[]; property_id: number; work_order_id: number | null; unit_id: number | null }>();
    for (const t of list) {
      const s = t.suggestion!;
      const key = `${s.property_id}|${s.work_order_id ?? ''}|${s.unit_id ?? ''}`;
      if (!byKey.has(key)) byKey.set(key, { ids: [], property_id: s.property_id, work_order_id: s.work_order_id, unit_id: s.unit_id });
      byKey.get(key)!.ids.push(t.id);
    }
    return assign([...byKey.values()]);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold">Needs property</h1>
          <span className="text-sm text-gray-500" data-testid="queue-count">
            {queue ? `${queue.count} waiting` : '…'}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Transactions in categories that require a property (set per category) and don&apos;t have one yet. Suggestions are
          pre-filled from vendors, street numbers, category defaults and your past picks, and are only saved when you accept them.
        </p>
        {queue && queue.by_category.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategory('')}
              className={`rounded-full px-3 py-1 text-xs font-medium ${!category ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              All ({queue.count})
            </button>
            {queue.by_category.map((c) => (
              <button
                key={c.category}
                onClick={() => setCategory(c.category)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${category === c.category ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {c.category} ({c.count})
              </button>
            ))}
          </div>
        )}
      </Card>

      <RentNeedsUnit />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}

      {queue && queue.count === 0 ? (
        <Card className="py-10 text-center text-sm text-gray-500">Nothing waiting. Every property expense is assigned.</Card>
      ) : (
        <Card className="p-0">
          {selRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm" data-testid="queue-bulk">
              <span className="font-medium text-blue-800">{selRows.length} selected</span>
              <button
                className={btnPrimary}
                disabled={busy || withSuggestion.length === 0}
                onClick={() => void acceptSuggestions(withSuggestion)}
              >
                Accept suggestions ({withSuggestion.length})
              </button>
              <span className="mx-1 h-5 w-px bg-blue-200" />
              <select
                aria-label="Assign to property"
                className={selectCls}
                value={bulkProperty}
                onChange={(e) => {
                  setBulkProperty(e.target.value);
                  setBulkProject('');
                }}
              >
                <option value="">Assign to property…</option>
                {propertyOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {bulkProp && projectAllowed && (
                <select aria-label="Bulk project" className={selectCls} value={bulkProject} onChange={(e) => setBulkProject(e.target.value)}>
                  <option value="">No project</option>
                  {bulkProp.projects.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.status})
                    </option>
                  ))}
                </select>
              )}
              <button
                className={btnSecondary}
                disabled={busy || !bulkProperty}
                data-testid="bulk-assign"
                onClick={() =>
                  void assign([
                    {
                      ids: selRows.map((t) => t.id),
                      property_id: Number(bulkProperty),
                      work_order_id: bulkProject ? Number(bulkProject) : null,
                      unit_id: null,
                    },
                  ])
                }
              >
                Assign {selRows.length}
              </button>
              <span className="mx-1 h-5 w-px bg-blue-200" />
              <button className={btnSecondary} disabled={busy} data-testid="bulk-split-button" onClick={() => setBulkSplit((v) => !v)}>
                Split {selRows.length} across properties…
              </button>
            </div>
          )}
          {selRows.length > 0 && bulkSplit && (
            <div className="border-b border-blue-100 bg-blue-50/40 px-4 py-3" data-testid="bulk-split">
              <SplitEditor
                key={selRows.map((t) => t.id).join(',')}
                txn={mapTxn({ ...selRows[0]!, amount: sameAmount ?? selRows[0]!.amount })}
                properties={propertyOptions}
                projectsOn={projectAllowed}
                initial={{ mode: 'percent', rows: [emptyRow(), emptyRow()] }}
                busy={busy}
                title={
                  sameAmount != null
                    ? `Split each of the ${selRows.length} selected (${fmt(sameAmount)} each) across properties`
                    : `Split each of the ${selRows.length} selected across properties`
                }
                amountDisabledReason={sameAmount == null ? 'Dollar amounts need every selected transaction to have the same amount; percentages work for any mix.' : undefined}
                saveLabel={`Save split for ${selRows.length}`}
                onSave={(mode, rows) => void bulkSplitSave(mode, rows)}
                onCancel={() => setBulkSplit(false)}
              />
            </div>
          )}
          <div className="max-h-[65vh] overflow-auto">
            <table className="min-w-full text-sm" data-testid="queue-table">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="w-8 px-3 py-2">
                    <input
                      ref={allRef}
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.length > 0 && selRows.length === rows.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((t) => t.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Suggestion</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="border-t border-gray-100" data-testid="queue-row">
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.description}`}
                          checked={selected.has(t.id)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(t.id)) n.delete(t.id);
                              else n.add(t.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                        {shortDate(t.date)} <span className="text-gray-400">{t.date.slice(0, 4)}</span>
                      </td>
                      <td className="px-3 py-1.5">{t.description}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{t.category}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular ${t.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {fmt(t.amount)}
                        {t.unallocated != null && t.unallocated !== 0 && (
                          <div className="text-[11px] font-medium text-orange-600" data-testid="unallocated">
                            {fmt(Math.abs(t.unallocated))} unallocated
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {t.suggestion ? (
                          <div className="flex items-center gap-2">
                            <span title={t.suggestion.reason} className="text-gray-700">
                              {nameOf(t.suggestion.property_id)}
                              {projectOf(t.suggestion.work_order_id) && (
                                <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">
                                  {projectOf(t.suggestion.work_order_id)}
                                </span>
                              )}
                              <span className="block text-[11px] text-gray-400">{t.suggestion.reason}</span>
                            </span>
                            <button
                              className="shrink-0 rounded-full border border-green-300 bg-white px-2.5 py-0.5 font-medium text-green-700 hover:bg-green-50"
                              disabled={busy}
                              onClick={() => void acceptSuggestions([t])}
                            >
                              Use
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-300">No suggestion</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => setPicker(picker === t.id ? null : t.id)}>
                          Assign…
                        </button>
                      </td>
                    </tr>
                    {picker === t.id && (
                      <tr>
                        <td />
                        <td colSpan={6} className="px-3 pb-3">
                          <AttributionPicker
                            txn={mapTxn(t)}
                            onSaved={() => {
                              setPicker(null);
                              void load();
                            }}
                            onCancel={() => setPicker(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
