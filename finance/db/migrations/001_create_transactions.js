/**
 * transactions — one row per imported bank transaction.
 * Expenses are stored negative, income positive (enforced by the parsers).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('transactions', (t) => {
    t.increments('id').primary();
    t.date('date').notNullable();
    t.text('description').notNullable();
    t.decimal('amount', 10, 2).notNullable(); // negative = expense, positive = income
    t.text('source').notNullable(); // 'Bank of America', 'Amex Gold', 'Amex Blue', 'SoFi'
    t.text('category').notNullable(); // auto-assigned, can be overridden
    t.text('category_group').notNullable(); // 'W2 Income', 'Investments', 'Travel', etc.
    t.boolean('is_manual').defaultTo(false); // true if user changed the category
    t.text('raw_description'); // original unmodified merchant string
    t.integer('upload_id'); // FK to upload_log
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.text('dedup_hash').unique(); // SHA of date+description+amount+source

    t.index('date', 'idx_transactions_date');
    t.index('category', 'idx_transactions_category');
    t.index('source', 'idx_transactions_source');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('transactions');
};
