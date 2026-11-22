import { getSuggestions } from '@finance/services/attribution.js';
import { run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/transactions/:id/suggestions — property suggestions, best first (never saved).
export async function GET(_req: Request, { params }: IdContext) {
  return run(async (knex) => getSuggestions(knex, await params));
}
