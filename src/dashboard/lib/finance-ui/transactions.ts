import type { Taxonomy } from './taxonomy';
import { groupOf } from './taxonomy';
import type { Txn } from './types';
import { DEFAULT_METRICS_CTX, totalsOf, type MetricsCtx } from './metrics';

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

/**
 * KPI cards: income, spending and cash flow from the shared definition
 * (src/finance/lib/metrics.js — transfers between your accounts left out,
 * refunds netted against spending), so they match the landing page and API.
 */
export function heroTotals(rows: Txn[], ctx: MetricsCtx = DEFAULT_METRICS_CTX) {
  const t = totalsOf(rows, ctx);
  return {
    income: t.income,
    spend: t.spending,
    flow: t.cash_flow,
    paychecks: rows.filter((r) => r.cat === 'Paycheck').length,
    expenseCount: t.expense_count,
    transfers: t.transfers,
    transferCount: t.transfer_count,
  };
}

/**
 * Summary bar under the transactions table. Expenses and income use the same
 * definition as the KPI cards (card payments / transfers netted out, refunds
 * reduce expenses), so they match the Overview for the same rows.
 */
export function summaryBar(rows: Txn[], ctx: MetricsCtx = DEFAULT_METRICS_CTX) {
  const t = totalsOf(rows, ctx);
  return {
    count: rows.length,
    expenses: -t.spending,
    income: t.income,
    uncategorized: rows.filter((r) => r.cat === 'Uncategorized').length,
    transfers: t.transfer_count,
  };
}

/** Old source filter options (fixed list on the old page). */
export const SOURCES = ['Bank of America', 'Amex Gold', 'Amex Blue', 'SoFi', 'Capital One'];
