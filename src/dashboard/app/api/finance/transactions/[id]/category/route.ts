import { setCategory } from '@finance/services/transactions.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/:id/category — override the category and persist it for re-uploads. Body: { category }.
// → the updated transaction
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => setCategory(knex, await params, await readJson(req)));
}
