import { rerunSuggestions } from '@finance/services/attribution.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/attribution/rerun — re-score suggestions for the queue (saves nothing).
export async function POST() {
  return run((knex) => rerunSuggestions(knex));
}
