import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { refreshInterestRate } from '../scoring/interest-rate.js';

/**
 * Fetch the latest Freddie Mac PMMS 30-yr rate, apply the investment premium,
 * and store it. The scheduler (Phase 6) runs this every Thursday.
 *
 *   npm run refresh:rate
 */
async function main(): Promise<void> {
  await initDb();
  const s = await refreshInterestRate();
  console.log(
    `✓ Rate updated — base ${s.baseRate}%` +
      (s.weekDate ? ` (week of ${s.weekDate})` : '') +
      ` + ${s.premium}% premium = ${s.effectiveRate}% effective.`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
