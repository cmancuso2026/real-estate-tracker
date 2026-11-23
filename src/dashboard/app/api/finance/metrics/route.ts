import { getMetricsDefinition } from '@finance/lib/metrics.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/metrics — the income / spending / cash flow definition
// (src/finance/lib/metrics.js): { definitions, transfer_groups, income_groups,
// income_categories }, so the browser counts exactly like the server.
export async function GET() {
  return run((knex) => getMetricsDefinition(knex));
}
