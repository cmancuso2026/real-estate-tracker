// The full taxonomy for the API and validation, read from the categories /
// category_groups tables (Phase 7; lib/taxonomy.js is now only their seed).
// mergedTaxonomy keeps its original response shape — { groups, cat_to_group } —
// so nothing downstream changes:
//   groups        group → active categories, in their admin order (archived
//                 ones are hidden from dropdowns)
//   cat_to_group  every category, archived included, so history still shows
//                 the right group
import { GROUPS } from './taxonomy.js';
import { loadTaxonomy } from './categories.js';

// Kept for compatibility (the built-in seed set).
const BASE_GROUP_NAMES = Object.keys(GROUPS);
const BASE_CATS = new Set(Object.values(GROUPS).flat());

async function mergedTaxonomy(knex) {
  const tax = await loadTaxonomy(knex);
  const groups = {};
  const cat_to_group = {};
  for (const g of tax.groups) {
    groups[g.name] = g.categories.filter((c) => !c.archived).map((c) => c.name);
    for (const c of g.categories) cat_to_group[c.name] = g.name;
  }
  return { groups, cat_to_group };
}

// Resolve a category name to its group. Returns null if the category is
// unknown or archived (i.e. it can't be assigned).
async function resolveGroup(knex, category) {
  const c = await knex('categories as c')
    .join('category_groups as g', 'g.id', 'c.group_id')
    .where('c.name', category)
    .where('c.archived', false)
    .first('g.name as group');
  return c ? c.group : null;
}

export { mergedTaxonomy, resolveGroup, BASE_GROUP_NAMES, BASE_CATS };
