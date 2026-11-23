import { getPropertyMap, updatePropertyMap } from '@finance/services/admin.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/property-map — mappings + unmapped per-property categories.
export async function GET() {
  return run((knex) => getPropertyMap(knex));
}

// PUT /api/admin/property-map — { category, property_id|null, role, confirmed } or { confirm_all: true }.
export async function PUT(req: Request) {
  return run(async (knex) => updatePropertyMap(knex, await readJson(req)));
}
