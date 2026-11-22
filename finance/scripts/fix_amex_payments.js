// One-off backfill: categorize historical bank-side Amex bill payments.
//
// Before the categorize() "AMERICAN EXPRESS / AMEX -> Amex" rule existed, these
// SoFi / Bank of America outflows landed in whatever the fallback produced
// (typically Uncategorized). Categorization only happens at upload time and
// re-uploads dedup+skip existing rows, so already-imported rows need a manual
// backfill.
//
// Scope (mirrors the new categorize rule exactly):
//   * source is a bank account (SoFi | Bank of America) — NOT the Amex card,
//     whose rows are real charges, not payments.
//   * description contains 'AMERICAN EXPRESS' or 'AMEX' (case-insensitive).
//   * not already 'Amex', and not user-overridden (is_manual = false).
//
// Usage:
//   node scripts/fix_amex_payments.js          # dry run — prints what would change
//   node scripts/fix_amex_payments.js --apply  # performs the update
const knex = require('knex')(require('../knexfile').development);

const APPLY = process.argv.includes('--apply');
const TARGET = { category: 'Amex', category_group: 'Financials' };

async function main() {
  const candidates = await knex('transactions')
    .whereIn('source', ['SoFi', 'Bank of America'])
    .where((b) =>
      b.whereRaw('UPPER(description) LIKE ?', ['%AMERICAN EXPRESS%'])
        .orWhereRaw('UPPER(description) LIKE ?', ['%AMEX%']),
    )
    .andWhere('is_manual', false)
    .andWhereNot('category', TARGET.category)
    .select('id', 'date', 'source', 'description', 'amount', 'category', 'category_group');

  if (candidates.length === 0) {
    console.log('No historical bank-side Amex payments need fixing. ✅');
    return;
  }

  console.log(`Found ${candidates.length} row(s) to recategorize as ${TARGET.category}/${TARGET.category_group}:\n`);
  for (const r of candidates) {
    console.log(
      `  #${r.id}  ${r.date}  ${r.source.padEnd(16)}  ${String(r.amount).padStart(10)}  ` +
        `[${r.category}/${r.category_group}] → [${TARGET.category}/${TARGET.category_group}]  ${r.description}`,
    );
  }

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to update these ${candidates.length} row(s).`);
    return;
  }

  const ids = candidates.map((r) => r.id);
  const updated = await knex('transactions').whereIn('id', ids).update(TARGET);
  console.log(`\n✅ Updated ${updated} row(s).`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
