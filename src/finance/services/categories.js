import { mergedTaxonomy, resolveGroup, BASE_GROUP_NAMES, BASE_CATS } from '../lib/categoryStore.js';

// GET /api/finance/categories — the full taxonomy (built-in + custom), so the frontend
// stays in sync.
export async function getCategories(knex) {
  return await mergedTaxonomy(knex);
}

// POST /api/finance/categories — add a user-defined category to an existing group.
// Body: { name, group }. Returns the updated taxonomy.
export async function addCategory(knex, body) {
  const name = String((body && body.name) || '').trim();
  const group = String((body && body.group) || '').trim();

  if (!name) {
    const e = new Error('Category name is required');
    e.status = 400;
    throw e;
  }
  if (!BASE_GROUP_NAMES.includes(group)) {
    const e = new Error(`Invalid group '${group}'. Expected one of: ${BASE_GROUP_NAMES.join(', ')}`);
    e.status = 400;
    throw e;
  }
  // Reject duplicates (built-in or already-added custom).
  if (BASE_CATS.has(name) || (await resolveGroup(knex, name))) {
    const e = new Error(`Category '${name}' already exists`);
    e.status = 400;
    throw e;
  }

  await knex('custom_categories').insert({ name, category_group: group });
  return await mergedTaxonomy(knex);
}

