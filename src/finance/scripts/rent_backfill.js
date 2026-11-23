// Backfill rent_collections from rent payments already in transactions.
//
//   npm run rent:backfill            # dry run: prints what would happen, writes nothing
//   npm run rent:backfill -- --apply # writes it
//
// Uses the same matching as uploads (lib/rentSync.js). Idempotent: running it
// again creates nothing new. Rows entered by hand or by the old CSV import are
// never changed; payments they already cover are counted as "already recorded".
// Needs DATABASE_URL and the 012 migration (npm run db:migrate).
import { createFinanceKnex } from '../db/connection.js';
import { syncRent } from '../lib/rentSync.js';

const APPLY = process.argv.includes('--apply');
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const knex = createFinanceKnex();
  try {
    if (!(await knex.schema.hasColumn('rent_collections', 'transaction_id'))) {
      console.error('rent_collections.transaction_id is missing — run `npm run db:migrate` first.');
      process.exitCode = 1;
      return;
    }
    const r = await syncRent(knex, null, { dryRun: !APPLY });
    const verb = (done, todo) => (APPLY ? done : todo).padEnd(22);
    console.log(APPLY ? 'Rent backfill — APPLIED' : 'Rent backfill — DRY RUN (nothing written; add --apply to write)');
    console.log(`  ${'rent payments scanned'.padEnd(22)} ${r.scanned}`);
    console.log(`  ${verb('created', 'would create')} ${r.created}`);
    console.log(`  ${verb('updated', 'would update')} ${r.updated}`);
    console.log(`  ${verb('relinked', 'would relink')} ${r.relinked}`);
    console.log(`  ${verb('removed', 'would remove')} ${r.removed}`);
    console.log(`  ${'already recorded'.padEnd(22)} ${r.already_recorded}  (entered by hand or by the old CSV import; left as they are)`);
    console.log(`  ${'need a unit'.padEnd(22)} ${r.unmatched.length}  (pick them on Needs Property → Rent needs a unit)`);
    const created = r.changes.filter((c) => c.action === 'create');
    if (created.length) {
      console.log('\nMatched:');
      for (const c of created) {
        console.log(`  ${c.date}  ${money(c.amount).padStart(11)}  ${c.property} · unit ${c.unit} · rent for ${c.due_date.slice(0, 7)} (by ${c.method})  ${c.description}`);
      }
    }
    const other = r.changes.filter((c) => c.action !== 'create');
    if (other.length) {
      console.log('\nOther changes:');
      for (const c of other) console.log(`  ${c.action}: ${c.date}  ${money(c.amount)}  ${c.description}`);
    }
    if (r.unmatched.length) {
      console.log('\nNeed a unit:');
      for (const u of r.unmatched) console.log(`  ${u.date}  ${money(u.amount).padStart(11)}  ${u.property}  ${u.description}  — ${u.reason}`);
    }
  } finally {
    await knex.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
