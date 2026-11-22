/**
 * custom_categories — user-defined categories added at runtime from the UI.
 * The built-in taxonomy lives in lib/taxonomy.js; these are merged on top of it
 * by GET /api/categories so new categories show up in every dropdown.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('custom_categories', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable().unique(); // the category label
    t.text('category_group').notNullable(); // must be one of the base group names
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('custom_categories');
};
