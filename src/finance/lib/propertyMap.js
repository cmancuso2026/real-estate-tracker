// property_category_map: which per-property categories ("1205 Rent",
// "20 PITI") belong to which owned property, and what role they play in that
// property's cash flow. Read by the Overview (cash flow per property) and the
// finance UI's property roll-ups; managed in the Admin portal.
//
// seedPropertyCategoryMap() proposes the obvious matches: a category whose
// leading number is a street number or unit label of exactly one property. It
// only inserts categories that have no row yet, and seeded rows start
// unconfirmed (confirmed = false) so you can review them. A row with
// property_id NULL means "not mapped on purpose", so re-seeding never brings
// back a mapping you removed.
import { GROUPS } from './taxonomy.js';
import { addressKeys } from './suggest.js';

export const ROLES = ['income', 'piti', 'expense'];

/** Role from a category name: Rent → income, PITI/mortgage → piti, else expense. */
export function roleFor(category) {
  if (/\b(piti|mortgage|mtg)\b/i.test(category)) return 'piti';
  if (/\brent\b/i.test(category)) return 'income';
  return 'expense';
}

/** All category names that exist anywhere: built-in, custom, and in transactions. */
async function knownCategories(knex) {
  const names = new Set(Object.values(GROUPS).flat());
  for (const r of await knex('custom_categories').select('name')) names.add(r.name);
  for (const r of await knex('transactions').distinct('category')) names.add(r.category);
  return [...names];
}

/** The property a category's leading number points to (only when exactly one matches). */
export function matchProperty(category, properties) {
  const m = String(category).match(/^(\d+)\b/);
  if (!m) return null;
  const hits = properties.filter((p) => p.nums.includes(m[1]));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Insert proposed mappings for categories that have no row yet. Idempotent;
 * safe to run on every deploy. Returns the rows it inserted.
 */
export async function seedPropertyCategoryMap(knex) {
  const [props, units, existing] = await Promise.all([
    knex('owned_properties').select('id', 'address'),
    knex('units').select('property_id', 'unit_label'),
    knex('property_category_map').select('category'),
  ]);
  if (!props.length) return [];
  const have = new Set(existing.map((r) => r.category));
  const properties = props.map((p) => ({
    id: p.id,
    nums: addressKeys(p.address, units.filter((u) => u.property_id === p.id).map((u) => u.unit_label)).nums,
  }));
  const rows = [];
  for (const category of await knownCategories(knex)) {
    if (have.has(category)) continue;
    const property_id = matchProperty(category, properties);
    if (property_id) rows.push({ category, property_id, role: roleFor(category), confirmed: false });
  }
  if (rows.length) await knex('property_category_map').insert(rows);
  return rows;
}

/** Every mapping, with the property address. */
export async function listPropertyCategoryMap(knex) {
  return knex('property_category_map as m')
    .leftJoin('owned_properties as p', 'p.id', 'm.property_id')
    .select('m.category', 'm.property_id', 'm.role', 'm.confirmed', 'p.address')
    .orderBy('m.category');
}
