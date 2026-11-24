/**
 * source_accounts: which card an account number belongs to, learned when you
 * pick the card on Upload (e.g. Amex "Account Ending 1-21004" → Amex Blue), so
 * later uploads of that card are labeled right on "Detect from the file".
 * Amex Gold and Blue exports are otherwise identical.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('source_accounts')) return;
  await knex.schema.createTable('source_accounts', (t) => {
    t.text('account_key').primary(); // e.g. 'amex:1-21004'
    t.text('source_key').notNullable(); // a parsers SOURCES key, e.g. 'amex_blue'
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('source_accounts');
}
