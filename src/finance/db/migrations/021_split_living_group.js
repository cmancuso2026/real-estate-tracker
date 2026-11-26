/**
 * Split the old "Living" group (requested by the owner): it mixed fixed bills,
 * discretionary shopping and personal spending, so its total said little.
 * Also moves Bar and Entertainment out of Other, leaving Other for what isn't
 * sorted yet.
 *
 *   Living → renamed to Bills & Utilities (Electric, Water, Wifi, Phone, Home Security)
 *   Shopping          ← Amazon, Shopping, Family Dollar
 *   Health & Personal ← Healthcare, Gym, Career, Roman
 *   Fun               ← Bar, Entertainment, Gun
 *
 * Transactions and overrides follow their category (moveCategory/renameGroup).
 * Only runs while a "Living" group still exists; anything else left in Living
 * (e.g. a category added in Admin) ends up in Bills & Utilities, where you can
 * move it in Admin → Categories.
 */
import { addGroup, moveCategory, renameGroup } from '../../lib/categories.js';

// The admin helpers run their own transactions (and write the change log).
export const config = { transaction: false };

const MOVES = {
  'Bills & Utilities': ['Electric', 'Water', 'Wifi', 'Phone', 'Home Security'],
  Shopping: ['Amazon', 'Shopping', 'Family Dollar'],
  'Health & Personal': ['Healthcare', 'Gym', 'Career', 'Roman'],
  Fun: ['Bar', 'Entertainment', 'Gun'],
};

export async function up(knex) {
  if (!(await knex.schema.hasTable('category_groups'))) return;
  if (!(await knex('category_groups').where({ name: 'Living' }).first('id'))) return;
  if (!(await knex('category_groups').where({ name: 'Bills & Utilities' }).first('id'))) {
    await renameGroup(knex, { name: 'Living', new_name: 'Bills & Utilities' });
  }
  for (const [group, cats] of Object.entries(MOVES)) {
    if (!(await knex('category_groups').where({ name: group }).first('id'))) await addGroup(knex, { name: group });
    for (const name of cats) {
      const c = await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', name).first('g.name as group');
      if (c && c.group !== group) await moveCategory(knex, { name, group });
    }
  }
  console.log('  ✓ Living split into Bills & Utilities, Shopping, Health & Personal; Bar/Entertainment/Gun moved to Fun');
}

export async function down() {
  // Rearrange in Admin → Categories if you want the old grouping back.
}
