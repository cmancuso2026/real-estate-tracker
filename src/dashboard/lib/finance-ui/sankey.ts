// Money flow for the Overview's Sankey view: income sources (by category) →
// Total Income → spending groups → categories (and income categories that
// net negative, like Taxes, as "taken out of income"), plus "Saved / Cash flow" when
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
    if (r2(v) > 0) {
      const k = `in:${cat}`;
      labels[k] = cat;
      columns[k] = 0;
      flows.push({ from: k, to: TOTAL, flow: r2(v) });
    } else if (r2(v) < 0) {
      // an income category with more out than in (e.g. Taxes): taken out of income, not spending
      const k = `out:${cat}`;
      labels[k] = `${cat} (taken out of income)`;
      columns[k] = 2;
      flows.push({ from: TOTAL, to: k, flow: r2(-v) });
    }
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

/** "PUBLIX #1234 MIAMI" → "PUBLIX": a readable merchant label for the drill-down. */
export function merchantLabel(desc: string): string {
  const words = desc
    .toUpperCase()
    .replace(/[#*]\S*/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^A-Z&' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return words.length ? words.join(' ') : desc.slice(0, 24);
}

/**
 * One spending group up close: group → each of its categories (none folded)
 * → the biggest merchants in each (top 5, the rest as "Other"). Same
 * definition as the cards: refunds net out, transfers are left out.
 */
export function buildGroupSankey(rows: Txn[], tax: Taxonomy, ctx: MetricsCtx, group: string): SankeyModel | null {
  const byCat = new Map<string, Map<string, number>>();
  let spending = 0;
  for (const t of rows) {
    if (groupOf(tax, t.cat) !== group) continue;
    const c = classifyTxn(t, ctx);
    if (c.kind === 'transfer' || !c.spending) continue;
    spending += c.spending;
    const m = byCat.get(t.cat) ?? new Map<string, number>();
    const label = merchantLabel(t.desc);
    m.set(label, (m.get(label) ?? 0) + c.spending);
    byCat.set(t.cat, m);
  }
  spending = r2(spending);
  if (spending <= 0) return null;
  const gk = `grp:${group}`;
  const flows: SankeyFlow[] = [];
  const labels: Record<string, string> = { [gk]: group };
  const columns: Record<string, number> = { [gk]: 0 };
  const cats = [...byCat.entries()]
    .map(([cat, m]) => [cat, r2([...m.values()].reduce((s, v) => s + v, 0)), m] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [cat, total, m] of cats) {
    const ck = `cat:${cat}`;
    labels[ck] = cat;
    columns[ck] = 1;
    flows.push({ from: gk, to: ck, flow: total });
    const merchants = [...m.entries()].filter(([, v]) => r2(v) > 0).sort((a, b) => b[1] - a[1]);
    const top = merchants.slice(0, 5);
    const rest = r2(merchants.slice(5).reduce((s, [, v]) => s + v, 0));
    // what the merchants add up to can exceed the category net when a refund
    // came from elsewhere; scale so the flows still balance
    const sum = r2(top.reduce((s, [, v]) => s + v, 0) + rest);
    const k = sum > 0 ? total / sum : 1;
    for (const [mname, v] of top) {
      const mk = `m:${cat}:${mname}`;
      labels[mk] = mname;
      columns[mk] = 2;
      flows.push({ from: ck, to: mk, flow: r2(v * k) });
    }
    if (rest > 0) {
      const ok = `m:${cat}:__other`;
      labels[ok] = `Other ${cat} (${merchants.length - 5})`;
      columns[ok] = 2;
      flows.push({ from: ck, to: ok, flow: r2(rest * k) });
    }
  }
  return { flows, labels, columns, income: 0, spending, cashFlow: -spending };
}

/** Transfers left out of the picture, per category: how many and how much went out / came in. */
export function transfersLeftOut(rows: Txn[], ctx: MetricsCtx) {
  const by = new Map<string, { cat: string; count: number; out: number; in: number }>();
  for (const t of rows) {
    if (classifyTxn(t, ctx).kind !== 'transfer') continue;
    const e = by.get(t.cat) ?? { cat: t.cat, count: 0, out: 0, in: 0 };
    e.count += 1;
    if (t.amt < 0) e.out = r2(e.out - t.amt);
    else e.in = r2(e.in + t.amt);
    by.set(t.cat, e);
  }
  return [...by.values()].sort((a, b) => b.out + b.in - (a.out + a.in));
}
