import { getPropertySpend } from '@finance/services/attribution.js';
import { run, queryOf, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/rollups/property/:id?year= — linked transactions + month / YTD totals by category.
export async function GET(req: Request, { params }: IdContext) {
  return run(async (knex) => getPropertySpend(knex, await params, queryOf(req)));
}
