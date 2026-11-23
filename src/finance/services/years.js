import { isoDate } from './_query.js';

// GET /api/finance/years — distinct years that have transactions, descending.
export async function getYears(knex) {
  const rows = await knex('transactions').distinct('date').select('date');
  const years = [...new Set(rows.map((r) => Number(isoDate(r.date).slice(0, 4))))];
  years.sort((a, b) => b - a);
  return { years };
}

