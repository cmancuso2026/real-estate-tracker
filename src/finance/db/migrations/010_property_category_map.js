/**
 * property_category_map — per-property categories ("1205 Rent", "20 PITI")
 * mapped to an owned property, with the role they play in its cash flow:
 *   income  — rent (adds to the property's cash flow)
 *   piti    — mortgage / PITI payments
 *   expense — other property costs booked under a per-property category
 * property_id NULL = deliberately not mapped. confirmed = false for rows the
 * seed proposed and you haven't reviewed yet (Admin → Property mapping).
 */
import { seedPropertyCategoryMap } from '../../lib/propertyMap.js';

export async function up(knex) {
  if (!(await knex.schema.hasTable('property_category_map'))) {
    await knex.schema.createTable('property_category_map', (t) => {
      t.text('category').primary();
      t.integer('property_id').nullable().references('id').inTable('owned_properties').onDelete('CASCADE');
      t.text('role').notNullable().defaultTo('income');
      t.boolean('confirmed').notNullable().defaultTo(false);
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index('property_id', 'idx_property_category_map_property');
    });
    await knex.raw(
      "ALTER TABLE property_category_map ADD CONSTRAINT property_category_map_role_check CHECK (role IN ('income', 'piti', 'expense'))",
    );
  }
  await seedPropertyCategoryMap(knex);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('property_category_map');
}
