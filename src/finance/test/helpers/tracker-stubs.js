// Minimal stand-ins for the tracker tables finance code reads (owned_properties,
// units, vendors, work_orders, project_quotes, tenants, leases, rent_collections,
// insurance_policies). Real
// Postgres gets the full versions from src/db/schema.sql, which db:migrate
// runs first; pg-mem can't run that file (DO $$ blocks), so tests create these
// columns — the ones finance code reads — before running the finance migrations.
// Boolean defaults use knex.raw('true'/'false'): Knex otherwise emits '1'/'0',
// which real Postgres casts to booleans but pg-mem stores as numbers.
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
    t.boolean('is_owner_unit').notNullable().defaultTo(knex.raw('false'));
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
    t.boolean('is_selected').notNullable().defaultTo(knex.raw('false'));
  });
  await knex.schema.createTable('tenants', (t) => {
    t.increments('id').primary();
    t.integer('unit_id').notNullable();
    t.text('first_name').notNullable();
    t.text('last_name').notNullable();
    t.boolean('is_active').notNullable().defaultTo(knex.raw('true'));
  });
  await knex.schema.createTable('leases', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable();
    t.integer('unit_id').notNullable();
    t.text('start_date').notNullable();
    t.text('end_date').notNullable();
    t.integer('rent_amount').notNullable();
  });
  await knex.schema.createTable('rent_collections', (t) => {
    t.increments('id').primary();
    t.integer('unit_id').notNullable();
    t.text('due_date').notNullable();
    t.integer('amount_due').notNullable();
    t.text('paid_date');
    t.integer('amount_paid');
  });
  await knex.schema.createTable('insurance_policies', (t) => {
    t.increments('id').primary();
    t.integer('property_id').notNullable();
    t.text('carrier').notNullable();
    t.text('policy_type');
    t.text('effective_date').notNullable();
    t.text('expiration_date').notNullable();
  });
}
