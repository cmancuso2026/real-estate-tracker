/**
 * Admin portal (Phase 7):
 *   category_groups / categories — the taxonomy, editable in the DB. Seeded from
 *     lib/taxonomy.js (built-in) and custom_categories; lib/taxonomy.js stays
 *     only as the seed source. categories.archived hides a category from
 *     dropdowns but keeps its history.
 *   category_aliases — old name → category, written by rename and merge, so
 *     names produced by the built-in rules (lib/categorize.js, unchanged) and
 *     by history still land in the renamed/merged category.
 *   merchant_rules — your own categorization rules, run before the built-in
 *     ones on upload and recategorize; a rule with a property also attributes.
 *   admin_audit — change log of admin actions.
 */
import { syncCategories } from '../../lib/categories.js';

// Boolean defaults are SQL true/false (Knex would emit '1'/'0').
export async function up(knex) {
  if (!(await knex.schema.hasTable('category_groups'))) {
    await knex.schema.createTable('category_groups', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique();
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('categories'))) {
    await knex.schema.createTable('categories', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique();
      t.integer('group_id').notNullable().references('id').inTable('category_groups').onDelete('RESTRICT');
      t.integer('sort_order').notNullable().defaultTo(0);
      t.boolean('archived').notNullable().defaultTo(knex.raw('false'));
      t.boolean('is_builtin').notNullable().defaultTo(knex.raw('false'));
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index('group_id', 'idx_categories_group');
    });
  }
  if (!(await knex.schema.hasTable('category_aliases'))) {
    await knex.schema.createTable('category_aliases', (t) => {
      t.text('alias').primary();
      t.integer('category_id').notNullable().references('id').inTable('categories').onDelete('CASCADE');
    });
  }
  if (!(await knex.schema.hasTable('merchant_rules'))) {
    await knex.schema.createTable('merchant_rules', (t) => {
      t.increments('id').primary();
      t.text('pattern').notNullable();
      t.text('match_type').notNullable().defaultTo('contains'); // contains | regex
      t.text('category').notNullable();
      t.integer('property_id').nullable().references('id').inTable('owned_properties').onDelete('SET NULL');
      t.integer('work_order_id').nullable().references('id').inTable('work_orders').onDelete('SET NULL');
      t.integer('priority').notNullable().defaultTo(100); // lower runs first
      t.boolean('enabled').notNullable().defaultTo(knex.raw('true'));
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('admin_audit'))) {
    await knex.schema.createTable('admin_audit', (t) => {
      t.increments('id').primary();
      t.text('action').notNullable(); // e.g. category.rename
      t.text('summary'); // human-readable one-liner
      t.jsonb('before');
      t.jsonb('after');
      t.timestamp('at', { useTz: true }).defaultTo(knex.fn.now());
      t.index('at', 'idx_admin_audit_at');
    });
  }
  await syncCategories(knex);
}

export async function down(knex) {
  for (const t of ['admin_audit', 'merchant_rules', 'category_aliases', 'categories', 'category_groups']) {
    await knex.schema.dropTableIfExists(t);
  }
}
