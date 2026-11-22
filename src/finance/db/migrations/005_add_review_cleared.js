/**
 * review_cleared — lets the user dismiss a transaction from the "Review" list
 * ("this categorization is fine"). Dedup skips already-imported rows on
 * re-upload, so the flag survives re-uploads of the same file.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('transactions', 'review_cleared');
  if (!has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.boolean('review_cleared').notNullable().defaultTo(false);
    });
  }
};

export async function down(knex) {
  const has = await knex.schema.hasColumn('transactions', 'review_cleared');
  if (has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.dropColumn('review_cleared');
    });
  }
};
