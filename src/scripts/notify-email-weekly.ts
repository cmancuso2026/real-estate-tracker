import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { sendWeeklyDigest } from '../notifications/weekly-digest.js';

/**
 * Send the weekly A-grade email digest of properties graded in the last 7 days.
 * The scheduler runs this every Friday at 8 AM (see src/scheduler/index.ts);
 * this script lets you trigger it manually. It always sends — a quiet week gets
 * a short "market was quiet" note.
 *
 *   npm run notify:email:weekly          # normal 7-day window
 *   npm run notify:email:weekly -- --dry # build but don't send
 */
async function main(): Promise<void> {
  await initDb();
  const dryRun = process.argv.includes('--dry');
  const s = await sendWeeklyDigest({ dryRun });
  console.log(
    `${dryRun ? '[dry-run] ' : ''}✓ Weekly digest: "${s.subject}" ` +
      `(${s.aCount} grade A).`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
