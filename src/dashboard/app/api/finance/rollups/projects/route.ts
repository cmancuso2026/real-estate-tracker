import { getProjectSpend } from '@finance/services/attribution.js';
import { run, queryOf } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/rollups/projects?propertyId= — actual spend per project from linked transactions.
export async function GET(req: Request) {
  return run((knex) => getProjectSpend(knex, queryOf(req)));
}
