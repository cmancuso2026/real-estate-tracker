import { setAllocations } from '@finance/services/attribution.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/:id/allocations — split across properties.
// Body: { mode: 'percent' | 'amount', rows: [{ property_id, unit_id?, work_order_id?, value }] }
// Replaces every allocation at once; 400 unless percentages total 100 or
// amounts total the transaction. rows: [] clears. → the updated transaction
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => setAllocations(knex, await params, await readJson(req)));
}
