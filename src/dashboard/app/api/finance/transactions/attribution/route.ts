import { bulkAttribution } from '@finance/services/attribution.js';
import { run, readJson } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PATCH /api/finance/transactions/attribution — { ids, property_id, work_order_id?, unit_id? }.
export async function PATCH(req: Request) {
  return run(async (knex) => bulkAttribution(knex, await readJson(req)));
}
