import { createProjectFromTransaction } from '@finance/services/attribution.js';
import { run, readJson, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/finance/transactions/:id/project — { property_id, unit_id?, project_name? }.
// Creates an open project named after the transaction (amount = starting cost) and links it.
export async function POST(req: Request, { params }: IdContext) {
  return run(async (knex) => createProjectFromTransaction(knex, await params, await readJson(req)), 201);
}
