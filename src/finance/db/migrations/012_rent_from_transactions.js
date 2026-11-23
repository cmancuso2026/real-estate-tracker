/**
 * Rent payments recorded from finance transactions (lib/rentSync.js).
 *   rent_collections.transaction_id     the transaction the payment came from;
 *                                       one row per transaction; cleared if the
 *                                       transaction is deleted
 *   rent_collections.unit_set_manually  you picked the unit ("Rent needs a unit"),
 *                                       so later syncs keep it
 * Rows written this way have source = 'finance_upload'. Adds columns only;
 * existing 'manual' / 'csv_import' rows are untouched. Creating the rows for
 * past transactions is a separate, previewed step (npm run rent:backfill).
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('rent_collections'))) return;
  if (!(await knex.schema.hasColumn('rent_collections', 'transaction_id'))) {
    await knex.schema.alterTable('rent_collections', (t) => {
      t.integer('transaction_id').nullable().references('id').inTable('transactions').onDelete('SET NULL');
    });
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_collections_transaction ON rent_collections (transaction_id)');
  }
  if (!(await knex.schema.hasColumn('rent_collections', 'unit_set_manually'))) {
    await knex.schema.alterTable('rent_collections', (t) => {
      t.boolean('unit_set_manually').notNullable().defaultTo(knex.raw('false'));
    });
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('rent_collections'))) return;
  await knex.raw('DROP INDEX IF EXISTS idx_rent_collections_transaction');
  for (const c of ['unit_set_manually', 'transaction_id']) {
    if (await knex.schema.hasColumn('rent_collections', c)) {
      await knex.schema.alterTable('rent_collections', (t) => t.dropColumn(c));
    }
  }
}
