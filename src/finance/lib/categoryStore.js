// Bridges the static taxonomy (lib/taxonomy.js) with user-defined categories
// stored in the `custom_categories` table. Everything that needs the *full*
// set of categories (the categories API, transaction category validation) goes
// through here so custom categories are honored everywhere.
const { GROUPS, groupFor } = require('./taxonomy');

const BASE_GROUP_NAMES = Object.keys(GROUPS);
const BASE_CATS = new Set(Object.values(GROUPS).flat());

// Return { groups, cat_to_group } = built-in taxonomy with custom categories
// merged into their groups.
async function mergedTaxonomy(knex) {
  const groups = {};
  for (const [g, cats] of Object.entries(GROUPS)) groups[g] = [...cats];

  const customs = await knex('custom_categories').select('name', 'category_group').orderBy('name');
  for (const c of customs) {
    if (!groups[c.category_group]) groups[c.category_group] = [];
    if (!groups[c.category_group].includes(c.name)) groups[c.category_group].push(c.name);
  }

  const cat_to_group = {};
  for (const [g, cats] of Object.entries(groups)) for (const c of cats) cat_to_group[c] = g;
  return { groups, cat_to_group };
}

// Resolve a category name to its group, checking built-in then custom.
// Returns null if the category is unknown (i.e. invalid).
async function resolveGroup(knex, category) {
  if (BASE_CATS.has(category)) return groupFor(category);
  const c = await knex('custom_categories').where({ name: category }).first();
  return c ? c.category_group : null;
}

module.exports = { mergedTaxonomy, resolveGroup, BASE_GROUP_NAMES, BASE_CATS };
