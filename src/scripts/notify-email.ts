import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { sendEmailDigest } from '../notifications/email.js';

/**
 * Send the daily email digest of properties graded in the last 24 hours.
 * Intended to run once a day (e.g. an 8 AM cron) — it always sends, regardless
 * of how many new properties there are.
 *
 *   npm run notify:email
 */
async function main(): Promise<void> {
  await initDb();
  const dryRun = process.argv.includes('--dry');
  const s = await sendEmailDigest({ dryRun });
  console.log(
    `${dryRun ? '[dry-run] ' : ''}✓ Email digest: "${s.subject}" ` +
      `(${s.total} propert${s.total === 1 ? 'y' : 'ies'}, ${s.aCount} grade A).`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
