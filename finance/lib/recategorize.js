// Shared confidence-based re-categorization sweep.
//
// Re-runs history-based categorization over currently-Uncategorized, non-manual
// rows, learning from the rest of the (already-categorized) history. Only rows
// that gain a confident category are updated; user overrides (is_manual) are
// never touched. The bank's raw category/Type column isn't stored per-row, so
// the rule fallback runs description-only here.
//
// Used by POST /api/transactions/recategorize AND automatically after each
// upload, so newly-added history retroactively rescues older uncategorized rows.
const { buildHistoryIndex, categorizeWithHistory } = require('./categorize');

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<{scanned: number, updated: number}>}
 */
async function recategorizeUncategorized(knex) {
  const historyRows = await knex('transactions')
    .whereNot('category', 'Uncategorized')
    .select('description', 'category', 'category_group', 'is_manual');
  const index = buildHistoryIndex(historyRows);

  const targets = await knex('transactions')
    .where('category', 'Uncategorized')
    .andWhere('is_manual', false)
    .select('id', 'description', 'source');

  let updated = 0;
  await knex.transaction(async (trx) => {
    for (const t of targets) {
      const { category, group, confidence } = categorizeWithHistory(
        t.description,
        '', // bank raw category not persisted per-row
        t.source,
        index,
      );
      if (category !== 'Uncategorized') {
        await trx('transactions').where({ id: t.id }).update({
          category,
          category_group: group,
          is_manual: false,
          confidence_score: confidence,
        });
        updated += 1;
      } else if (confidence != null) {
        // Still uncategorized, but record how close the vote was.
        await trx('transactions').where({ id: t.id }).update({ confidence_score: confidence });
      }
    }
  });

  return { scanned: targets.length, updated };
}

module.exports = { recategorizeUncategorized };
