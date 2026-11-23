/**
 * Figure Lending under 1821 (requested by the owner).
 *
 * The bank shows the loan payments as "FIGURE LENDING …" and the built-in SoFi
 * rules leave them Uncategorized, so 015 (which looked for a category) found
 * nothing. This:
 *   1. adds a "Figure Lending" category to the Investments group (if missing);
 *   2. maps it to the 1821 property as a loan / PITI payment, so it sits under
 *      1821 on the Categories page and counts in 1821's cash flow;
 *   3. adds a merchant rule  FIGURE LENDING → Figure Lending (1821)  so future
 *      uploads land there;
 *   4. applies the rule to existing rows (not ones you categorized by hand).
 * Does nothing without exactly one property whose address starts with 1821,
 * or when no Figure Lending payments (or category) exist.
 * Each step is skipped when already done, so re-running is a no-op.
 */
import { addCategory } from '../../lib/categories.js';
import { applyRuleToExisting, createRule } from '../../lib/merchantRules.js';

const NAME = 'Figure Lending';

// The steps use the Admin helpers, which open their own transactions (each step
// is atomic and re-running skips what's done), so this migration doesn't wrap
// them in another one.
export const config = { transaction: false };

export async function up(knex) {
  if (!(await knex.schema.hasTable('merchant_rules')) || !(await knex.schema.hasTable('property_category_map'))) return;
  const props = await knex('owned_properties').where('address', 'like', '1821%').select('id');
  if (props.length !== 1) return;
  const pid = props[0].id;

  const existing = await knex('categories').whereRaw('lower(name) = ?', [NAME.toLowerCase()]).first('name');
  // Only where Figure Lending actually appears (the payments or the category).
  const payments = await knex('transactions').whereRaw('upper(description) like ?', ['%FIGURE LENDING%']).first('id');
  if (!payments && !existing) return;
  const category = existing ? existing.name : NAME;
  if (!existing) {
    const group = (await knex('category_groups').where({ name: 'Investments' }).first('name')) ? 'Investments' : (await knex('category_groups').orderBy('sort_order').first('name')).name;
    await addCategory(knex, { name: NAME, group });
  }

  const map = await knex('property_category_map').where({ category }).first();
  if (!map || map.property_id == null) {
    const row = { category, property_id: pid, role: 'piti', confirmed: true };
    if (map) await knex('property_category_map').where({ category }).update(row);
    else await knex('property_category_map').insert(row);
  }

  let rule = await knex('merchant_rules').whereRaw('upper(pattern) = ?', ['FIGURE LENDING']).first();
  if (!rule) rule = await createRule(knex, { pattern: 'FIGURE LENDING', category, property_id: pid, priority: 50 });
  const r = await applyRuleToExisting(knex, rule.id);
  console.log(`  ✓ Figure Lending → 1821: ${r.changes?.recategorized ?? 0} transaction(s) moved to “${category}”`);
}

export async function down() {
  // Leaves the category, mapping and rule; change them in Admin.
}
