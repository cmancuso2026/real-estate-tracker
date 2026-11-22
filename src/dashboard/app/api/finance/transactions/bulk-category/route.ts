import { bulkCategory } from '@finance/services/transactions.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/bulk-category — { ids: number[], category }.
// Persists overrides so re-uploads keep them.
export async function PUT(req: Request) {
  return run(async (knex) => bulkCategory(knex, await readJson(req)));
}
