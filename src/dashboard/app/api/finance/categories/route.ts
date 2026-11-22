import { addCategory, getCategories } from '@finance/services/categories.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/categories — the full taxonomy: { groups, cat_to_group }.
export async function GET() {
  return run((knex) => getCategories(knex));
}

// POST /api/finance/categories — { name, group } adds a custom category.
// → 201 + the updated taxonomy. (Moves to the Admin portal in Phase 7.)
export async function POST(req: Request) {
  return run(async (knex) => addCategory(knex, await readJson(req)), 201);
}
