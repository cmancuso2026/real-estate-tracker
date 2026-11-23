import { setReview } from '@finance/services/transactions.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/:id/review — dismiss from (or restore to) the review list. Body: { cleared: boolean }.
// → the updated transaction
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => setReview(knex, await params, await readJson(req)));
}
