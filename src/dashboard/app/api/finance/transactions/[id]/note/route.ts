import { setNote } from '@finance/services/transactions.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/:id/note — attach/update/clear a note. Body: { note: string } (empty clears it).
// → the updated transaction
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => setNote(knex, await params, await readJson(req)));
}
