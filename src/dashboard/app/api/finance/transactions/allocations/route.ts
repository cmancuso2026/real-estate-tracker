import { bulkAllocations } from '@finance/services/attribution.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/finance/transactions/allocations — the same split for many
// transactions: { ids, mode: 'percent' | 'amount', rows: [{ property_id,
// unit_id?, work_order_id?, value }] }. All or nothing. → { success, updated }
export async function PUT(req: Request) {
  return run(async (knex) => bulkAllocations(knex, await readJson(req)));
}
