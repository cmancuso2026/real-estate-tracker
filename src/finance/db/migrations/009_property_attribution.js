/**
 * Property / project attribution for finance transactions.
 *
 * - transactions.property_id / work_order_id / unit_id: which owned property
 *   (and optionally which project and unit) a transaction belongs to. All
 *   nullable — uploads never fail for lack of attribution; a row in a category
 *   that requires a property but has none is simply "unattributed" (the queue).
 * - attribution_overrides: attribution keyed by dedup_hash, the same pattern as
 *   category_overrides, so it is re-applied if the row is ever re-imported.
 * - category_settings: per-category rules, editable in the DB (never hardcoded),
 *   keyed by category name so it covers built-in and custom categories.
 *
 * References tracker tables (owned_properties, work_orders, units) created by
 * src/db/schema.sql, which db:migrate applies before these migrations.
 */
const SEED_REQUIRES_PROPERTY = ['Repairs', 'Lawn Care', 'Home Depot'];

export async function up(knex) {
  const cols = [
    ['property_id', 'owned_properties'],
    ['work_order_id', 'work_orders'],
    ['unit_id', 'units'],
  ];
  for (const [col, table] of cols) {
    if (!(await knex.schema.hasColumn('transactions', col))) {
      await knex.schema.alterTable('transactions', (t) => {
        t.integer(col).nullable().references('id').inTable(table).onDelete('SET NULL');
        t.index(col, `idx_transactions_${col}`);
      });
    }
  }

  if (!(await knex.schema.hasTable('attribution_overrides'))) {
    await knex.schema.createTable('attribution_overrides', (t) => {
      t.increments('id').primary();
      t.text('dedup_hash').notNullable().unique(); // matches transactions.dedup_hash
      t.text('description'); // for human readability (and merchant history)
      t.integer('property_id').nullable().references('id').inTable('owned_properties').onDelete('SET NULL');
      t.integer('work_order_id').nullable().references('id').inTable('work_orders').onDelete('SET NULL');
      t.integer('unit_id').nullable().references('id').inTable('units').onDelete('SET NULL');
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('category_settings'))) {
    await knex.schema.createTable('category_settings', (t) => {
      t.text('category').primary();
      t.boolean('requires_property').notNullable().defaultTo(false);
      t.boolean('allow_project_tag').notNullable().defaultTo(true);
      t.integer('default_property_id').nullable().references('id').inTable('owned_properties').onDelete('SET NULL');
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
  for (const category of SEED_REQUIRES_PROPERTY) {
    const exists = await knex('category_settings').where({ category }).first();
    if (!exists) await knex('category_settings').insert({ category, requires_property: true });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('category_settings');
  await knex.schema.dropTableIfExists('attribution_overrides');
  for (const col of ['unit_id', 'work_order_id', 'property_id']) {
    if (await knex.schema.hasColumn('transactions', col)) {
      await knex.schema.alterTable('transactions', (t) => t.dropColumn(col));
    }
  }
}
