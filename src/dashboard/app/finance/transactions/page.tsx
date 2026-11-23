'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { AttributionPicker } from '@/components/finance/AttributionPicker';
import { CategorySelect } from '@/components/finance/CategorySelect';
import { useFinance } from '@/components/finance/FinanceData';
import { TxnDetail } from '@/components/finance/TxnDetail';
import { Card, btnPrimary, btnSecondary, selectCls } from '@/components/finance/ui';
import { fmt, shortDate } from '@/lib/finance-ui/format';
import { computeDiscrepancies } from '@/lib/finance-ui/review';
import { groupOf } from '@/lib/finance-ui/taxonomy';
import {
  nextSort,
  summaryBar,
  txnComparator,
  type SortKey,
  type SortState,
} from '@/lib/finance-ui/transactions';
import type { ApiTxn, PropertyOption, Txn } from '@/lib/finance-ui/types';

const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'desc', label: 'Description' },
  { key: 'src', label: 'Source' },
  { key: 'group', label: 'Group' },
  { key: 'cat', label: 'Category' },
  { key: 'amt', label: 'Amount', right: true },
];

export default function FinanceTransactionsPage() {
  const { txns, filteredTxns, periodTxns, tax, patchTxns, requiresProperty, propertyOptions } = useFinance();
  // Inline property picker: for a category that needs a property, or to edit a row's property.
  const [picker, setPicker] = useState<{ id: number; category?: string } | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edited, setEdited] = useState<Set<number>>(new Set()); // changed this session
  const [savingId, setSavingId] = useState<number | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  const [busy, setBusy] = useState(false);

  // Flags are computed over ALL transactions (old computeDiscrepancies).
  const disc = useMemo(() => computeDiscrepancies(txns, tax), [txns, tax]);
  // The global filters (bar above) are already applied; this page adds only
  // the ⚠ Review toggle and sorting.
  const rows = useMemo(
    () => (flaggedOnly ? filteredTxns.filter((t) => disc.flags.has(t.id)) : filteredTxns.slice()).sort(txnComparator(sort, tax)),
    [filteredTxns, flaggedOnly, tax, disc, sort],
  );
  const flaggedInView = filteredTxns.filter((t) => disc.flags.has(t.id)).length;
  const sum = summaryBar(rows);

  // Like the old page, a re-filter drops the selection, so a bulk action can
  // never hit rows that are no longer on screen.
  useEffect(() => setSelected(new Set()), [filteredTxns, flaggedOnly]);
  useEffect(() => {
    if (!bulkCat && tax.allSubcats.length) setBulkCat(tax.allSubcats[0]!);
  }, [bulkCat, tax.allSubcats]);

  const selAllRef = useRef<HTMLInputElement>(null);
  const nSel = rows.filter((t) => selected.has(t.id)).length;
  useEffect(() => {
    if (selAllRef.current) selAllRef.current.indeterminate = nSel > 0 && nSel < rows.length;
  }, [nSel, rows.length]);

  async function changeCat(id: number, next: string) {
    // A category that requires a property can't be saved without one: open the
    // picker; the category is saved together with the property there.
    const t = txns.find((x) => x.id === id);
    if (t && !t.fullyAllocated && requiresProperty(next)) {
      setPicker({ id, category: next });
      return;
    }
    setSavingId(id);
    try {
      const updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${id}/category`, {
        category: next,
        category_group: tax.catToGroup[next] || 'Other',
      });
      patchTxns([id], { cat: updated.category, manual: true });
      setEdited((s) => new Set(s).add(id));
    } catch (err) {
      alert('Failed to save category: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingId(null);
    }
  }

  async function saveNote(id: number, note: string) {
    try {
      const updated = await financeApi.put<ApiTxn>(`/api/finance/transactions/${id}/note`, { note });
      patchTxns([id], { note: updated.note || '' });
    } catch (err) {
      alert('Failed to save note: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function setReview(id: number, cleared: boolean) {
    try {
      await financeApi.put(`/api/finance/transactions/${id}/review`, { cleared });
      patchTxns([id], { cleared });
    } catch (err) {
      alert('Failed to update review status: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  const selectedIds = () => rows.filter((t) => selected.has(t.id)).map((t) => t.id);

  async function applyBulk() {
    const ids = selectedIds();
    if (!ids.length) return;
    setBusy(true);
    try {
      await financeApi.put('/api/finance/transactions/bulk-category', { ids, category: bulkCat });
      patchTxns(ids, { cat: bulkCat, manual: true });
      setEdited((s) => new Set([...s, ...ids]));
      setSelected(new Set());
    } catch (err) {
      alert('Failed to update categories: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function bulkReview() {
    const ids = selectedIds();
    if (!ids.length) return;
    setBusy(true);
    try {
      await financeApi.put('/api/finance/transactions/bulk-review', { ids, cleared: true });
      patchTxns(ids, { cleared: true });
      setSelected(new Set());
    } catch (err) {
      alert('Failed to update review status: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const toggleIn = (set: Set<number>, id: number) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <button
          className={`${btnSecondary} ${flaggedOnly ? '!border-amber-400 !bg-amber-50 !text-amber-800' : ''}`}
          title="Show only possibly miscategorized transactions"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
          data-testid="review-toggle"
        >
          ⚠ Review ({flaggedInView})
        </button>
        <span className="text-xs text-gray-400" data-testid="txn-count">
          {rows.length} of {periodTxns.length}
        </span>
      </div>

      {nSel > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm">
          <span className="font-medium text-blue-800">{nSel} selected</span>
          <span className="text-xs text-gray-500">Set category to</span>
          <select aria-label="Bulk category" className={selectCls} value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
            {tax.allSubcats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className={btnPrimary} disabled={busy} onClick={() => void applyBulk()}>
            Apply to {nSel}
          </button>
          <button
            className="rounded-full border border-green-300 bg-white px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
            disabled={busy}
            title="Mark selected as fine — remove from Review"
            onClick={() => void bulkReview()}
          >
            ✓ Mark reviewed
          </button>
          <button className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="max-h-[60vh] overflow-auto">
        <table className="min-w-full text-sm" data-testid="txn-table">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="w-8 px-3 py-2">
                <input
                  ref={selAllRef}
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && nSel === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((t) => t.id)) : new Set())}
                />
              </th>
              {COLUMNS.map((c, ci) => (
                <Fragment key={c.key}>
                {ci === COLUMNS.length - 1 && <th className="px-3 py-2 text-left font-medium">Property</th>}
                <th
                  onClick={() => setSort((s) => nextSort(s, c.key))}
                  className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-gray-800 ${c.right ? 'text-right' : 'text-left'} ${
                    sort.key === c.key ? 'text-gray-900' : ''
                  }`}
                >
                  {c.label}
                  <span className="ml-1 text-[10px]">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isInc = t.amt > 0;
              const flagged = disc.flags.has(t.id);
              const open = expanded.has(t.id);
              const grp = groupOf(tax, t.cat);
              return (
                <Fragment key={t.id}>
                  <tr
                    data-testid="txn-row"
                    onClick={(e) => {
                      if ((e.target as Element).closest('input,select,button,label,a,textarea')) return;
                      setExpanded((s) => toggleIn(s, t.id));
                    }}
                    className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${isInc ? 'bg-green-50/40' : ''} ${
                      flagged ? 'border-l-2 border-l-amber-400' : ''
                    } ${open ? 'bg-blue-50/40' : ''}`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.desc}`}
                        checked={selected.has(t.id)}
                        onChange={() => setSelected((s) => toggleIn(s, t.id))}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                      <span className="mr-1 inline-block w-3 text-gray-400">{open ? '▾' : '▸'}</span>
                      {shortDate(t.date)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{t.desc}</span>
                        {t.cat === 'Uncategorized' && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">needs category</span>
                        )}
                        {flagged && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">⚠ review</span>
                        )}
                        {t.note && (
                          <span data-note={t.note} className="cursor-help rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                            📝 note
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">{t.src}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{grp}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <CategorySelect
                        value={t.cat}
                        options={tax.allSubcats}
                        edited={edited.has(t.id)}
                        disabled={savingId === t.id}
                        onChange={(next) => void changeCat(t.id, next)}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <PropertyCell
                        t={t}
                        needs={!t.fullyAllocated && requiresProperty(t.cat)}
                        options={propertyOptions}
                        onEdit={() => setPicker({ id: t.id })}
                      />
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right font-medium tabular ${isInc ? 'text-green-700' : 'text-red-600'}`}>
                      {fmt(t.amt)}
                    </td>
                  </tr>
                  {picker?.id === t.id && (
                    <tr>
                      <td />
                      <td colSpan={7} className="px-3 pb-3">
                        <AttributionPicker
                          txn={t}
                          category={picker.category}
                          onSaved={() => {
                            if (picker.category) setEdited((s) => new Set(s).add(t.id));
                            setPicker(null);
                          }}
                          onCancel={() => setPicker(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {open && (
                    <tr>
                      <td />
                      <td colSpan={7} className="px-3 pb-3">
                        <TxnDetail
                          t={t}
                          group={grp}
                          disc={disc}
                          onSaveNote={(note) => saveNote(t.id, note)}
                          onReview={(cleared) => setReview(t.id, cleared)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-gray-400">No transactions match your filters.</div>}
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-gray-100 px-4 py-3 text-sm md:grid-cols-4" data-testid="txn-summary">
        <div>
          <div className="text-xs text-gray-500">Showing</div>
          <div className="font-semibold tabular" data-testid="sum-count">{sum.count}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Expenses</div>
          <div className="font-semibold tabular text-red-600" data-testid="sum-exp">{fmt(sum.expenses)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Income</div>
          <div className="font-semibold tabular text-green-700" data-testid="sum-inc">{fmt(sum.income)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">⚠️ Uncategorized</div>
          <div className="font-semibold tabular text-orange-600" data-testid="sum-uncat">{sum.uncategorized}</div>
        </div>
      </div>
    </Card>
  );
}

/** Property column: the linked property (and project), or a prompt when one is required. */
function PropertyCell({
  t,
  needs,
  options,
  onEdit,
}: {
  t: Txn;
  needs: boolean;
  options: PropertyOption[];
  onEdit: () => void;
}) {
  const nameOf = (id: number) => options.find((p) => p.id === id)?.name ?? `Property ${id}`;
  const projectOf = (id: number | null) => (id == null ? null : options.flatMap((p) => p.projects).find((w) => w.id === id)?.name ?? null);
  const unitOf = (pid: number, id: number | null) => (id == null ? null : options.find((p) => p.id === pid)?.units.find((u) => u.id === id)?.label ?? null);
  const partial = t.allocations.length > 0 && !t.fullyAllocated;
  if (t.allocations.length > 1 || partial) {
    const lines = t.allocations.map((a) => {
      const extra = [unitOf(a.property_id, a.unit_id) && `unit ${unitOf(a.property_id, a.unit_id)}`, projectOf(a.work_order_id)].filter(Boolean).join(', ');
      return `${nameOf(a.property_id)}${extra ? ` (${extra})` : ''}: ${fmt(a.amount)}${a.percent != null ? ` · ${a.percent}%` : ''}`;
    });
    if (partial && t.unallocated != null) lines.push(`Unallocated: ${fmt(t.unallocated)}`);
    return (
      <details className="group" data-testid="split-badge">
        <summary className="cursor-pointer list-none" title={lines.join('\n')}>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${partial ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>
            Split ×{t.allocations.length}
            {partial && t.unallocated != null && ` · ${fmt(Math.abs(t.unallocated))} unallocated`}
          </span>
        </summary>
        <ul className="mt-1 space-y-0.5 text-[11px] text-gray-600">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li>
            <button onClick={onEdit} className="font-medium text-blue-600 hover:underline">
              Edit split
            </button>
          </li>
        </ul>
      </details>
    );
  }
  if (needs) {
    return (
      <button onClick={onEdit} className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700 hover:bg-orange-200">
        Needs property
      </button>
    );
  }
  if (!t.propertyId) {
    return (
      <button onClick={onEdit} className="text-gray-300 hover:text-blue-600" title="Link to a property">
        + property
      </button>
    );
  }
  const project = projectOf(t.workOrderId);
  return (
    <button onClick={onEdit} className="text-left hover:underline" title="Change property">
      <span className="text-gray-700">{nameOf(t.propertyId)}</span>
      {project && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">{project}</span>}
    </button>
  );
}
