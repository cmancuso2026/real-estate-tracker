import { mergedTaxonomy } from '../lib/categoryStore.js';
import { addCategory as addCategoryOp } from '../lib/categories.js';

// GET /api/finance/categories — the full taxonomy (built-in + custom), so the frontend
// stays in sync.
export async function getCategories(knex) {
  return await mergedTaxonomy(knex);
}

// POST /api/finance/categories — add a category to an existing group.
// Body: { name, group }. Returns the updated taxonomy. (The Admin portal's
// Categories page uses the same operation, so it lands in the change log.)
export async function addCategory(knex, body) {
  await addCategoryOp(knex, { name: body && body.name, group: body && body.group });
  return mergedTaxonomy(knex);
}
