import { isoDate } from './_query.js';

// GET /api/finance/months?year=2026 — month numbers (1-12) with data in that year.
export async function getMonths(knex, query) {
  const { year } = query;
  const q = knex('transactions').distinct('date').select('date');
  if (year) q.whereBetween('date', [`${year}-01-01`, `${year}-12-31`]);

  const rows = await q;
  const months = [...new Set(rows.map((r) => Number(isoDate(r.date).slice(5, 7))))];
  months.sort((a, b) => a - b);
  return { months };
}

