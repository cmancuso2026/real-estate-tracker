import { getMonths } from '@finance/services/months.js';
import { queryOf, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/months?year=2026 — { months: [1, 4, …] } with data that year.
export async function GET(req: Request) {
  return run((knex) => getMonths(knex, queryOf(req)));
}
