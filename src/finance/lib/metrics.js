// Income, spending and cash flow: the one definition every page and API uses
// (the landing page, /finance cards and chart, GET /api/finance/summary).
//
//   Transfers  categories in the Financials group (Amex, Capital One, Venmo)
//              and any category named "Transfer(s)", wherever it sits: card
//              payments and moves between your own accounts. Left out of
//              everything, so the same money isn't counted as spending on one
//              account and income on the other.
//   Income     money in to an income category: the W2 Income group, any
//              category mapped to a property as rent (property_category_map
//              role 'income'), and uncategorized deposits.
//   Spending   everything else that isn't a transfer, net: a refund in a
//              spending category takes it off spending. Money out of an income
//              category (e.g. taxes owed) is spending too. Mortgage / PITI,
//              repairs and other property costs count as spending.
//   Cash flow  income − spending (= the sum of every non-transfer amount).
//
// Plain JS with no server dependencies so the browser bundle can import it.
import { CAT_TO_GROUP } from './taxonomy.js';

export const TRANSFER_GROUPS = ['Financials'];
/** Any category named like "Transfer" / "Transfers" (in any group) is a move between your own accounts. */
export const TRANSFER_CATEGORY = /\btransfers?\b/i;
export const INCOME_GROUPS = ['W2 Income'];

export const DEFINITIONS = {
  income: 'Money in to income categories (W2 Income, property rent) and uncategorized deposits. Card payments and transfers between your own accounts are netted out.',
  spending: 'What you bought, net of refunds: every purchase on your cards and accounts, including mortgage/PITI and property costs. Paying the card bill is netted out, so nothing is counted twice.',
  cash_flow: 'Income minus spending. Card payments and transfers between your own accounts are netted out.',
};

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * How a category counts: 'transfer', 'income' or 'spending'.
 * ctx: { groupOf(category) → group, incomeCategories: Set<string> }
 */
export function categoryKind(category, ctx = {}) {
  const groupOf = ctx.groupOf || ((c) => CAT_TO_GROUP[c] || 'Other');
  const group = groupOf(category);
  if (TRANSFER_GROUPS.includes(group) || TRANSFER_CATEGORY.test(String(category))) return 'transfer';
  if (INCOME_GROUPS.includes(group) || category === 'Uncategorized' || ctx.incomeCategories?.has(category)) return 'income';
  return 'spending';
}

/** Signed amount and category from a server row ({ amount, category }) or a client Txn ({ amt, cat }). */
const amountOf = (r) => Number(r.amount ?? r.amt);
const categoryOf = (r) => r.category ?? r.cat;

/**
 * Split one amount into its income and spending parts (both ≥ 0 except a
 * net refund, which makes spending negative): { kind, income, spending }.
 */
export function classify(row, ctx) {
  const kind = categoryKind(categoryOf(row), ctx);
  const a = amountOf(row);
  if (kind === 'transfer') return { kind, income: 0, spending: 0 };
  if (kind === 'income') return a > 0 ? { kind, income: a, spending: 0 } : { kind, income: 0, spending: -a };
  return { kind, income: 0, spending: -a };
}

/**
 * Totals for a set of transactions.
 * → { income, spending, cash_flow, count, transfers, transfer_count, expense_count }
 * count = transactions that count (transfers excluded); expense_count = money-out rows among them.
 */
export function financeTotals(rows, ctx) {
  let income = 0;
  let spending = 0;
  let transfers = 0;
  let transferCount = 0;
  let count = 0;
  let expenseCount = 0;
  for (const r of rows) {
    const c = classify(r, ctx);
    if (c.kind === 'transfer') {
      transfers += amountOf(r);
      transferCount += 1;
      continue;
    }
    count += 1;
    if (amountOf(r) < 0) expenseCount += 1;
    income += c.income;
    spending += c.spending;
  }
  return {
    income: r2(income),
    spending: r2(spending),
    cash_flow: r2(income - spending),
    count,
    transfers: r2(transfers),
    transfer_count: transferCount,
    expense_count: expenseCount,
  };
}

/** Totals per bucket key (e.g. 'YYYY-MM'): Map(key → totals). */
export function totalsBy(rows, keyOf, ctx) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = new Map();
  for (const [k, list] of groups) out.set(k, financeTotals(list, ctx));
  return out;
}

/** Spending per group (refunds netted), largest first: [{ group, spending }]. */
export function spendingByGroup(rows, ctx, n = Infinity) {
  const groupOf = ctx?.groupOf || ((c) => CAT_TO_GROUP[c] || 'Other');
  const by = {};
  for (const r of rows) {
    const c = classify(r, ctx);
    if (c.kind === 'transfer' || c.spending === 0) continue;
    const g = groupOf(categoryOf(r));
    by[g] = (by[g] || 0) + c.spending;
  }
  return Object.entries(by)
    .map(([group, spending]) => ({ group, spending: r2(spending) }))
    .filter((g) => g.spending > 0)
    .sort((a, b) => b.spending - a.spending)
    .slice(0, n);
}

/** Server side: the classification context from the database. */
export async function loadMetricsContext(knex) {
  const [cats, rent] = await Promise.all([
    knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').select('c.name', 'g.name as group'),
    knex('property_category_map').where({ role: 'income' }).whereNotNull('property_id').select('category'),
  ]);
  const catToGroup = Object.fromEntries(cats.map((c) => [c.name, c.group]));
  return metricsContext(catToGroup, rent.map((r) => r.category));
}

/** A context from a category → group map and the rent (income-mapped) categories. */
export function metricsContext(catToGroup, incomeCategories = []) {
  return {
    groupOf: (c) => catToGroup[c] || CAT_TO_GROUP[c] || 'Other',
    incomeCategories: new Set(incomeCategories),
  };
}

/** GET /api/finance/metrics — what the browser needs to classify the same way. */
export async function getMetricsDefinition(knex) {
  const rent = await knex('property_category_map').where({ role: 'income' }).whereNotNull('property_id').select('category');
  return {
    definitions: DEFINITIONS,
    transfer_groups: TRANSFER_GROUPS,
    transfer_category_pattern: TRANSFER_CATEGORY.source,
    income_groups: INCOME_GROUPS,
    income_categories: rent.map((r) => r.category).sort(),
  };
}
