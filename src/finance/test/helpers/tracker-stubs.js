// Minimal stand-ins for the tracker tables the finance migrations reference
// (owned_properties, units, vendors, work_orders, project_quotes). Real
// Postgres gets the full versions from src/db/schema.sql, which db:migrate
// runs first; pg-mem can't run that file (DO $$ blocks), so tests create these
// columns — the ones finance code reads — before running the finance migrations.
export async function createTrackerStubs(knex) {
  await knex.schema.createTable('owned_properties', (t) => {
    t.increments('id').primary();
    t.text('address').notNullable();
    t.text('city').notNullable().defaultTo('Miami');
    t.text('state').notNullable().defaultTo('FL');
  });
  await knex.schema.createTable('units', (t) => {
    t.increments('id').primary();
    t.integer('property_id').notNullable().references('id').inTable('owned_properties').onDelete('CASCADE');
    t.text('unit_label').notNullable();
  });
  await knex.schema.createTable('vendors', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('trade');
  });
  await knex.schema.createTable('work_orders', (t) => {
    t.increments('id').primary();
    t.integer('property_id').notNullable().references('id').inTable('owned_properties').onDelete('CASCADE');
    t.integer('unit_id');
    t.integer('vendor_id');
    t.text('project_name');
    t.text('description');
    t.text('status').notNullable().defaultTo('received');
    t.text('date_received');
    t.integer('quoted_cost');
    t.text('source').defaultTo('manual');
    t.text('created_at');
    t.text('updated_at');
  });
  await knex.schema.createTable('project_quotes', (t) => {
    t.increments('id').primary();
    t.integer('work_order_id').notNullable();
    t.integer('vendor_id').notNullable();
    t.decimal('quoted_cost', 12, 2);
    t.decimal('final_cost', 12, 2);
    t.boolean('is_selected').notNullable().defaultTo(false);
  });
}
