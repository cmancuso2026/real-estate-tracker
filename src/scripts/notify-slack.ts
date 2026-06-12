import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { sendSlackAlerts } from '../notifications/slack.js';

/**
 * Post Slack alerts for every grade-A property not yet alerted. Idempotent via
 * the alerts_sent dedup table — safe to run as often as you like.
 *
 *   npm run notify:slack            # send
 *   npm run notify:slack -- --dry   # preview without sending
 */
async function main(): Promise<void> {
  await initDb();
  const dryRun = process.argv.includes('--dry');
  const s = await sendSlackAlerts({ dryRun });
  console.log(
    `${dryRun ? '[dry-run] ' : ''}✓ Slack: ${s.sent} sent, ${s.skipped} already alerted ` +
      `(${s.candidates} grade-A propert${s.candidates === 1 ? 'y' : 'ies'}).`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
