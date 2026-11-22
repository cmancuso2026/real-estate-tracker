import { setTransactionAttribution } from '@finance/services/attribution.js';
import { run, readJson, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PATCH /api/finance/transactions/:id/attribution — { property_id, unit_id?, work_order_id? }.
// Unit and project must belong to the property; property_id null clears it.
export async function PATCH(req: Request, { params }: IdContext) {
  return run(async (knex) => setTransactionAttribution(knex, await params, await readJson(req)));
}
