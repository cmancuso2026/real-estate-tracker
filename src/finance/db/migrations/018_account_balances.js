/**
 * account_balances: an account's closing balance per day, read from bank
 * exports that carry one (Bank of America checking's "Running Bal."), for
 * the cash position chart. One row per account and day; a later upload of the
 * same day replaces it.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('account_balances')) return;
  await knex.schema.createTable('account_balances', (t) => {
    t.increments('id').primary();
    t.text('account').notNullable();
    t.date('date').notNullable();
    t.decimal('balance', 12, 2).notNullable();
    t.integer('upload_id').nullable().references('id').inTable('upload_log').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.unique(['account', 'date'], { indexName: 'idx_account_balances_account_date' });
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('account_balances');
}
