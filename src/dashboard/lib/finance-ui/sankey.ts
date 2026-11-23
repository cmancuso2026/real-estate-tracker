// Money flow for the Overview's Sankey view: income sources (by category) →
// Total Income → spending groups → categories, plus "Saved / Cash flow" when
// income is larger, or a "Shortfall" feeding Total Income when spending is.
// Built from the same rows and the same definition (metrics.ts) as the KPI
// cards, so Total Income = the Income card and the spending flows add up to
// the Spending card.
import { classifyTxn, type MetricsCtx } from './metrics';
import { groupOf, type Taxonomy } from './taxonomy';
import type { Txn } from './types';

export interface SankeyFlow {
  from: string;
  to: string;
  flow: number;
}
export interface SankeyModel {
  flows: SankeyFlow[];
  /** node key → label (keys are prefixed so a group and a category can share a name) */
  labels: Record<string, string>;
  /** node key → column (0 sources, 1 total, 2 groups, 3 categories) */
  columns: Record<string, number>;
  income: number;
  spending: number;
  cashFlow: number;
}

export const TOTAL = 'total';
export const SAVED = 'saved';
export const SHORTFALL = 'shortfall';
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildSankey(rows: Txn[], tax: Taxonomy, ctx: MetricsCtx): SankeyModel | null {
  const incomeBy: Record<string, number> = {};
  const spendByCat: Record<string, number> = {};
  let income = 0;
  let spending = 0;
  for (const t of rows) {
    const c = classifyTxn(t, ctx);
    if (c.kind === 'transfer') continue;
    income += c.income;
    spending += c.spending;
    if (c.income) incomeBy[t.cat] = (incomeBy[t.cat] || 0) + c.income;
    if (c.spending) spendByCat[t.cat] = (spendByCat[t.cat] || 0) + c.spending;
  }
  income = r2(income);
  spending = r2(spending);
  if (income <= 0 && spending <= 0) return null;

  const flows: SankeyFlow[] = [];
  const labels: Record<string, string> = { [TOTAL]: 'Total Income' };
  const columns: Record<string, number> = { [TOTAL]: 1 };

  for (const [cat, v] of Object.entries(incomeBy).sort((a, b) => b[1] - a[1])) {
    if (r2(v) <= 0) continue;
    const k = `in:${cat}`;
    labels[k] = cat;
    columns[k] = 0;
    flows.push({ from: k, to: TOTAL, flow: r2(v) });
  }

  // Spending per group → per category. A category whose refunds outweigh its
  // spending (net negative) can't be drawn as a flow; it's left out of the
  // picture, and the group's flow is the sum of the drawn categories.
  const byGroup: Record<string, [string, number][]> = {};
  for (const [cat, v] of Object.entries(spendByCat)) {
    if (r2(v) <= 0) continue;
    (byGroup[groupOf(tax, cat)] ||= []).push([cat, r2(v)]);
  }
  const groupTotals = Object.entries(byGroup)
    .map(([g, cats]) => [g, r2(cats.reduce((s, [, v]) => s + v, 0)), cats] as const)
    .sort((a, b) => b[1] - a[1]);
  // Categories under 3% of spending are folded into "More in <group>" so the
  // right-hand labels stay readable (the group total is unchanged).
  const small = spending * 0.03;
  for (const [g, total, cats] of groupTotals) {
    const gk = `grp:${g}`;
    labels[gk] = g;
    columns[gk] = 2;
    flows.push({ from: TOTAL, to: gk, flow: total });
    const sorted = cats.sort((a, b) => b[1] - a[1]);
    const big = sorted.filter(([, v], i) => i === 0 || v >= small);
    const rest = sorted.filter((c) => !big.includes(c));
    for (const [cat, v] of big) {
      const ck = `cat:${cat}`;
      labels[ck] = cat;
      columns[ck] = 3;
      flows.push({ from: gk, to: ck, flow: v });
    }
    if (rest.length === 1) {
      const [cat, v] = rest[0]!;
      labels[`cat:${cat}`] = cat;
      columns[`cat:${cat}`] = 3;
      flows.push({ from: gk, to: `cat:${cat}`, flow: v });
    } else if (rest.length > 1) {
      const mk = `more:${g}`;
      labels[mk] = `More in ${g} (${rest.length})`;
      columns[mk] = 3;
      flows.push({ from: gk, to: mk, flow: r2(rest.reduce((s, [, v]) => s + v, 0)) });
    }
  }

  const drawnSpending = r2(groupTotals.reduce((s, [, v]) => s + v, 0));
  const diff = r2(income - drawnSpending);
  if (diff > 0) {
    labels[SAVED] = 'Saved / Cash flow';
    columns[SAVED] = 2;
    flows.push({ from: TOTAL, to: SAVED, flow: diff });
  } else if (diff < 0) {
    labels[SHORTFALL] = 'Shortfall';
    columns[SHORTFALL] = 0;
    flows.push({ from: SHORTFALL, to: TOTAL, flow: -diff });
  }
  return { flows, labels, columns, income, spending, cashFlow: r2(income - spending) };
}
