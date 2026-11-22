import type { Taxonomy } from './taxonomy';
import { groupOf } from './taxonomy';
import type { Txn } from './types';

export type SortKey = 'date' | 'desc' | 'src' | 'group' | 'cat' | 'amt';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export function txnComparator(sort: SortState, tax: Taxonomy) {
  return (a: Txn, b: Txn): number => {
    const mul = sort.dir === 'asc' ? 1 : -1;
    let av: string | number;
    let bv: string | number;
    switch (sort.key) {
      case 'desc': av = a.desc.toLowerCase(); bv = b.desc.toLowerCase(); break;
      case 'src': av = a.src.toLowerCase(); bv = b.src.toLowerCase(); break;
      case 'group': av = groupOf(tax, a.cat); bv = groupOf(tax, b.cat); break;
      case 'cat': av = a.cat.toLowerCase(); bv = b.cat.toLowerCase(); break;
      case 'amt': av = a.amt; bv = b.amt; break;
      default: av = a.date; bv = b.date;
    }
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return b.date.localeCompare(a.date); // tie-break: newest first
  };
}

/** Next sort state when a header is clicked (dates/amounts start high→low, text A→Z). */
export function nextSort(cur: SortState, key: SortKey): SortState {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'date' || key === 'amt' ? 'desc' : 'asc' };
}

/** KPI cards (old updateHeroCards). */
export function heroTotals(rows: Txn[]) {
  const income = rows.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0);
  const spend = rows.filter((t) => t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
  return {
    income,
    spend,
    flow: income - spend,
    paychecks: rows.filter((t) => t.cat === 'Paycheck').length,
    expenseCount: rows.filter((t) => t.amt < 0).length,
  };
}

/** Summary bar under the transactions table (old renderSummaryBar). */
export function summaryBar(rows: Txn[]) {
  return {
    count: rows.length,
    expenses: rows.filter((t) => t.amt < 0).reduce((s, t) => s + t.amt, 0),
    income: rows.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0),
    uncategorized: rows.filter((t) => t.cat === 'Uncategorized').length,
  };
}

/** Old source filter options (fixed list on the old page). */
export const SOURCES = ['Bank of America', 'Amex Gold', 'Amex Blue', 'SoFi', 'Capital One'];
