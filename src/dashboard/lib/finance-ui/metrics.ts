// The browser side of the shared income / spending / cash flow definition.
// The math lives in src/finance/lib/metrics.js, which the server uses too, so
// the /finance cards and chart always match the landing page and the API.
import {
  DEFINITIONS,
  classify,
  financeTotals,
  metricsContext,
  spendingByGroup,
} from '@finance/lib/metrics.js';
import type { Txn } from './types';

export type MetricsCtx = ReturnType<typeof metricsContext>;
export type Kind = 'transfer' | 'income' | 'spending';
export { DEFINITIONS, metricsContext };

/** Built-in groups only (no rent mappings) — used until /api/finance/metrics loads. */
export const DEFAULT_METRICS_CTX: MetricsCtx = metricsContext({}, []);

export function totalsOf(rows: Txn[], ctx: MetricsCtx = DEFAULT_METRICS_CTX) {
  return financeTotals(rows, ctx) as {
    income: number;
    spending: number;
    cash_flow: number;
    count: number;
    transfers: number;
    transfer_count: number;
    expense_count: number;
  };
}

export function classifyTxn(t: Txn, ctx: MetricsCtx = DEFAULT_METRICS_CTX) {
  return classify(t, ctx) as { kind: Kind; income: number; spending: number };
}

export function groupSpending(rows: Txn[], ctx: MetricsCtx = DEFAULT_METRICS_CTX) {
  return spendingByGroup(rows, ctx) as { group: string; spending: number }[];
}
