import { applyFilters, isoDate } from './_query.js';
import { DEFINITIONS, classify, loadMetricsContext } from '../lib/metrics.js';

// GET /api/finance/summary — aggregate totals for the selected period.
// income / spending / cash_flow (and by_month) use the shared definition in
// lib/metrics.js: transfers between your accounts are left out and refunds
// reduce spending. by_group / by_category stay raw signed sums.
// Aggregation is done in JS over the filtered rows: the dataset is small
// (personal finances) and it keeps the SQL portable.
export async function getSummary(knex, query) {
  const { year, months } = query;

  const rows = await applyFilters(knex('transactions'), { year, months }).select(
    'amount',
    'category',
    'category_group',
    'source',
    'date'
  );

  const ctx = await loadMetricsContext(knex);
  let income = 0;
  let spending = 0;
  let transfers = 0;
  let counted = 0;
  const byGroup = {};
  const byCategory = {};
  const byMonth = {};
  const bySource = {};

  for (const row of rows) {
    const amt = Number(row.amount);
    const c = classify(row, ctx);
    income += c.income;
    spending += c.spending;
    if (c.kind === 'transfer') transfers += amt;
    else counted += 1;

    byGroup[row.category_group] = (byGroup[row.category_group] || 0) + amt;
    byCategory[row.category] = (byCategory[row.category] || 0) + amt;

    const ym = isoDate(row.date).slice(0, 7); // 'YYYY-MM'
    if (!byMonth[ym]) byMonth[ym] = { income: 0, spending: 0 };
    byMonth[ym].income += c.income;
    byMonth[ym].spending += c.spending;

    bySource[row.source] = (bySource[row.source] || 0) + 1;
  }

  const round = (n) => Math.round(n * 100) / 100;
  const roundMap = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
  const roundMonth = (m) =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        { income: round(v.income), spending: round(v.spending) },
      ])
    );

  return {
    income: round(income),
    spending: round(spending),
    cash_flow: round(income - spending),
    transaction_count: rows.length,
    counted_count: counted,
    transfers: round(transfers),
    definitions: DEFINITIONS,
    by_group: roundMap(byGroup),
    by_category: roundMap(byCategory),
    by_month: roundMonth(byMonth),
    by_source: bySource,
  };
}

