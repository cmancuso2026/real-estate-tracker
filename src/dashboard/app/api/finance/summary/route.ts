import { getSummary } from '@finance/services/summary.js';
import { queryOf, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/summary?year=&months= — totals + by_group / by_category /
// by_month / by_source for the selected period.
export async function GET(req: Request) {
  return run((knex) => getSummary(knex, queryOf(req)));
}
