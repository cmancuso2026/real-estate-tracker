/**
 * confidence_score — how confident the auto-categorizer was (0..1) when it
 * assigned this row's category from historical matches. NULL means the category
 * came from the hardcoded rule fallback (no history), from a manual override,
 * or predates this feature. Surfaced in the UI so the user can see which
 * auto-assignments are shaky.
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('transactions', 'confidence_score');
  if (!has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.decimal('confidence_score', 5, 4); // 0.0000 – 1.0000, nullable
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('transactions', 'confidence_score');
  if (has) {
    await knex.schema.alterTable('transactions', (t) => {
      t.dropColumn('confidence_score');
    });
  }
};
