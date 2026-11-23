import { assignRentUnit, rentUnitOptions } from '@finance/lib/rentSync.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/transactions/:id/rent — the units (with tenant and lease in
// force on the payment date) this rent payment can be recorded on.
export async function GET(_req: Request, { params }: IdContext) {
  return run(async (knex) => ({ units: await rentUnitOptions(knex, (await params).id) }));
}

// PUT /api/finance/transactions/:id/rent — { unit_id, lease_id? } records the
// payment in rent_collections on that unit (lease defaults to the one in force).
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => assignRentUnit(knex, (await params).id, await readJson(req)));
}
