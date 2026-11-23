import { bulkReview } from '@finance/services/transactions.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/bulk-review — { ids: number[], cleared: boolean }.
export async function PUT(req: Request) {
  return run(async (knex) => bulkReview(knex, await readJson(req)));
}
