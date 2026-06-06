import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { sendEmailDigest } from '../notifications/email.js';

/**
 * Send a test email digest via SendGrid. Uses a wide time window so it includes
 * any graded properties already in the database (a normal daily run uses 24h).
 *
 *   npm run test:email
 */
async function main(): Promise<void> {
  initDb();
  // ~10 years so existing graded data is pulled into the test digest.
  const summary = await sendEmailDigest({ sinceHours: 24 * 3650 });
  console.log(`✓ Test digest sent — "${summary.subject}"`);
  console.log(`  ${summary.total} propert(y/ies), ${summary.aCount} grade A.`);
  if (summary.total === 0) {
    console.log(
      '  (No graded properties found — sent an empty digest. Run `npm run grade` first for a fuller test.)',
    );
  }
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
