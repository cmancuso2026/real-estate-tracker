/**
 * category_overrides — persists user category changes keyed by dedup_hash so
 * they survive re-uploads of the same CSV.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('category_overrides', (t) => {
    t.increments('id').primary();
    t.text('dedup_hash').notNullable().unique(); // matches transactions.dedup_hash
    t.text('description'); // for human readability
    t.text('category').notNullable();
    t.text('category_group').notNullable();
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('category_overrides');
};
