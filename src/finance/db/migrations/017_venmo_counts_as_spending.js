/**
 * Venmo counts as spending (requested by the owner): Venmo is mostly paying
 * people for things, not moving money between your own accounts. Moves the
 * Venmo category from Financials (netted out as transfers) to Other, so
 * payments count as spending and money sent back to you reduces it, like a
 * refund. Only if Venmo is still in Financials; you can move it back in
 * Admin → Categories.
 */
import { moveCategory } from '../../lib/categories.js';

// moveCategory runs its own transaction (and writes the change log).
export const config = { transaction: false };

export async function up(knex) {
  if (!(await knex.schema.hasTable('categories'))) return;
  const v = await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', 'Venmo').first('g.name as group');
  if (!v || v.group !== 'Financials') return;
  if (!(await knex('category_groups').where({ name: 'Other' }).first('id'))) return;
  await moveCategory(knex, { name: 'Venmo', group: 'Other' });
  console.log('  ✓ Venmo moved from Financials to Other: Venmo payments now count as spending');
}

export async function down() {
  // Move it back in Admin → Categories if you want it netted out again.
}
