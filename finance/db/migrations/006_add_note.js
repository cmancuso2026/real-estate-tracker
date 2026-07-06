/**
 * note — free-text annotation the user attaches to a single transaction
 * (e.g. "taxes to Wiley"). Surfaced on hover in the overview chart and the
 * categories table. Dedup skips already-imported rows on re-upload, so the
 * note lives on the row and survives re-uploads of the same file.
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('transactions', 'note');
  if (!has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.text('note');
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('transactions', 'note');
  if (has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.dropColumn('note');
    });
  }
};
