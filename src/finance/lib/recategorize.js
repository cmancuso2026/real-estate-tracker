// Shared confidence-based re-categorization sweep.
//
// Re-runs categorization over currently-Uncategorized, non-manual rows,
// learning from the rest of the (already-categorized) history. Only rows that
// gain a category are updated; user overrides (is_manual) are never touched.
// The bank's raw category/Type column isn't stored per-row, so the built-in
// rule fallback runs description-only here.
//
// Order (same as upload): your merchant rules → history vote → built-in rules.
// Names renamed or merged in Admin map to today's category. With no merchant
// rules and no renames this is exactly the original sweep.
//
// Used by POST /api/finance/transactions/recategorize, automatically after each
// upload, and by Admin → Data (with dryRun for the preview).
import { buildHistoryIndex, categorizeWithHistory } from './categorize.js';
import { loadRules, matchRule } from './merchantRules.js';
import { canonicalName, loadTaxonomy } from './categories.js';

/**
 * @param {import('knex').Knex} knex
 * @param {{ dryRun?: boolean }} [opts]  dryRun: report what would change, write nothing
 * @returns {Promise<{scanned: number, updated: number, changes?: object[]}>}
 */
async function recategorizeUncategorized(knex, { dryRun = false, changedIds = null } = {}) {
  const historyRows = await knex('transactions')
    .whereNot('category', 'Uncategorized')
    .select('description', 'category', 'category_group', 'is_manual');
  const index = buildHistoryIndex(historyRows);
  const [rules, tax] = await Promise.all([loadRules(knex), loadTaxonomy(knex)]);

  const targets = await knex('transactions')
    .where('category', 'Uncategorized')
    .andWhere('is_manual', false)
    .select('id', 'date', 'description', 'source', 'property_id');

  const results = targets.map((t) => {
    let { category, group, confidence } = categorizeWithHistory(
      t.description,
      '', // bank raw category not persisted per-row
      t.source,
      index,
    );
    const rule = matchRule(rules, t.description);
    if (rule) {
      category = rule.category;
      confidence = null;
    }
    category = canonicalName(tax, category);
    group = tax.byName.get(category)?.group ?? group;
    return { t, category, group, confidence, rule };
  });
  const updates = results.filter((r) => r.category !== 'Uncategorized');

  if (dryRun) {
    return {
      scanned: targets.length,
      updated: updates.length,
      changes: updates.map((r) => ({
        id: r.t.id,
        date: r.t.date,
        description: r.t.description,
        to: r.category,
        by: r.rule ? `your rule “${r.rule.pattern}”` : r.confidence != null ? 'history vote' : 'built-in rule',
        confidence: r.confidence,
      })),
    };
  }

  await knex.transaction(async (trx) => {
    for (const r of results) {
      if (r.category !== 'Uncategorized') {
        if (changedIds) changedIds.push(r.t.id);
        await trx('transactions').where({ id: r.t.id }).update({
          category: r.category,
          category_group: r.group,
          is_manual: false,
          confidence_score: r.confidence,
          ...(r.rule && r.rule.property_id && r.t.property_id == null
            ? { property_id: r.rule.property_id, work_order_id: r.rule.work_order_id }
            : {}),
        });
      } else if (r.confidence != null) {
        // Still uncategorized, but record how close the vote was.
        await trx('transactions').where({ id: r.t.id }).update({ confidence_score: r.confidence });
      }
    }
  });

  return { scanned: targets.length, updated: updates.length };
}

export { recategorizeUncategorized };
