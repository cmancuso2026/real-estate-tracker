/**
 * Clear the daily balances saved before accounts were told apart: checking
 * and savings statements had been saved under one account, so days covered by
 * both held whichever was uploaded last and can't be separated. Only this
 * derived table is cleared (transactions are untouched); re-uploading the
 * checking and savings CSVs rebuilds it, one series per account.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('account_balances')) await knex('account_balances').del();
}

export async function down() {}
