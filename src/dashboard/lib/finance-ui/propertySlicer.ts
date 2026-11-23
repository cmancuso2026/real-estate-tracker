// Transactions page slicers for property assignment, and the starting point
// for a bulk split ("adjust the split these rows already share").
import type { SplitMode, SplitRow } from '@/components/finance/SplitEditor';
import type { Txn } from './types';

/** '' all · 'none' not assigned · '<propertyId>' touching that property */
export type PropertySlice = string;
/** '' any · 'single' 100% to one property · 'split' across several · 'partial' not fully allocated */
export type AssignSlice = '' | 'single' | 'split' | 'partial';

export function assignmentOf(t: Txn): 'none' | 'single' | 'split' | 'partial' {
  if (!t.allocations.length) return 'none';
  if (!t.fullyAllocated) return 'partial';
  return t.allocations.length === 1 ? 'single' : 'split';
}

export function sliceRows(rows: Txn[], prop: PropertySlice, assign: AssignSlice): Txn[] {
  return rows.filter((t) => {
    if (prop === 'none' && t.allocations.length) return false;
    if (prop && prop !== 'none' && !t.allocations.some((a) => String(a.property_id) === prop)) return false;
    if (assign && assignmentOf(t) !== assign) return false;
    return true;
  });
}

/** Counts for the slicer chips: not assigned, and per property (a split counts for each of its properties). */
export function sliceCounts(rows: Txn[]) {
  const byProperty = new Map<number, number>();
  let none = 0;
  for (const t of rows) {
    if (!t.allocations.length) none += 1;
    for (const id of new Set(t.allocations.map((a) => a.property_id))) byProperty.set(id, (byProperty.get(id) ?? 0) + 1);
  }
  return { none, byProperty };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const emptyRow = (): SplitRow => ({ property_id: '', unit_id: '', work_order_id: '', value: '' });

/**
 * Where a bulk split starts: if every selected row has the same split
 * (same properties / units / projects and percentages), that split — so you
 * only adjust it; otherwise the sliced property at 100% plus an empty row.
 */
export function bulkSplitStart(selected: Txn[], prop: PropertySlice): { mode: SplitMode; rows: SplitRow[] } {
  const sig = (t: Txn) =>
    t.allocations
      .map((a) => `${a.property_id}|${a.unit_id ?? ''}|${a.work_order_id ?? ''}|${r3(a.percent ?? (a.amount / t.amt) * 100)}`)
      .join(';');
  const first = selected[0];
  if (first && first.allocations.length && first.fullyAllocated && selected.every((t) => t.fullyAllocated && sig(t) === sig(first))) {
    return {
      mode: 'percent',
      rows: first.allocations.map((a) => ({
        property_id: String(a.property_id),
        unit_id: a.unit_id ? String(a.unit_id) : '',
        work_order_id: a.work_order_id ? String(a.work_order_id) : '',
        value: String(r3(a.percent ?? (a.amount / first.amt) * 100)),
      })),
    };
  }
  const start = prop && prop !== 'none' ? { ...emptyRow(), property_id: prop, value: '100' } : emptyRow();
  return { mode: 'percent', rows: [start, emptyRow()] };
}
