/**
 * Map the "Figure Lending" category (the loan on 1821-1825 NW 74th St) to that
 * property as a loan / PITI payment, so it shows under 1821 on the Categories
 * page and counts in 1821's cash flow. Requested by the owner.
 *
 * Only acts when it is unambiguous: exactly one category whose name contains
 * "figure", exactly one property whose address starts with 1821, and the
 * category not already mapped to a property (a mapping you made or removed on
 * purpose is left alone). Otherwise it does nothing. Re-running is a no-op.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('property_category_map'))) return;
  const cats = await knex('categories').whereRaw('lower(name) like ?', ['%figure%']).select('name');
  const props = await knex('owned_properties').where('address', 'like', '1821%').select('id');
  if (cats.length !== 1 || props.length !== 1) return;
  const category = cats[0].name;
  const existing = await knex('property_category_map').where({ category }).first();
  if (existing && (existing.property_id != null || existing.confirmed)) return;
  const row = { category, property_id: props[0].id, role: 'piti', confirmed: true };
  if (existing) await knex('property_category_map').where({ category }).update(row);
  else await knex('property_category_map').insert(row);
  console.log(`  ✓ mapped "${category}" to property ${props[0].id} (1821) as a loan / PITI payment`);
}

export async function down() {
  // Leaves the mapping; change it in Admin → Property mapping.
}
