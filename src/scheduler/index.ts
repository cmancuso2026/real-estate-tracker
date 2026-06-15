import cron from 'node-cron';
import { spawn } from 'node:child_process';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';

/**
 * Long-running cron scheduler for the tracker's recurring jobs. Start it with
 * `npm run scheduler` and keep the process alive (e.g. under pm2, systemd, or a
 * container) — node-cron fires each job on its schedule in-process.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠️  TEMPORARY TEST SCHEDULE — NOT PRODUCTION  ⚠️
 *
 * Everything below is wired to fire ONCE at 23:45 UTC (7:45 PM EDT, Miami) for
 * an end-to-end test on Railway. To make "45 23 * * *" mean 23:45 *UTC*, the
 * timezone is set to UTC
 * (production uses America/New_York). The full pipeline runs in sequence so
 * grading sees freshly-fetched listings and notifications see fresh grades.
 *
 * RESTORE AFTER TESTING: revert to the single weekly-a-grade-digest job
 * ("0 8 * * 5", America/New_York) that was the only production job before this.
 * ───────────────────────────────────────────────────────────────────────────
 */

// TEMPORARY: test schedule is expressed in UTC (prod is 'America/New_York').
const TIMEZONE = 'UTC';

// TEMPORARY: fire once at 23:45 UTC (7:45 PM EDT, Miami). 45 23 * * * in UTC.
const TEST_SCHEDULE = '45 23 * * *';

/** One step of the test pipeline, reusing the exact production npm scripts. */
interface Step {
  name: string;
  npmScript: string;
}

// Ordered: fetch → grade → notify. Each reuses the same script used in prod.
const STEPS: Step[] = [
  { name: 'fetch', npmScript: 'fetch:all' },
  { name: 'grade', npmScript: 'grade' },
  { name: 'notify-slack', npmScript: 'notify:slack' },
  { name: 'email-digest', npmScript: 'notify:email' },
  { name: 'weekly-digest', npmScript: 'notify:email:weekly' },
];

/** Run an npm script as a child process; resolve with its exit code. */
function runScript(npmScript: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', npmScript], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', (err) => {
      console.error(`  spawn failed for "${npmScript}":`, err);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Run the whole pipeline in order, continuing past failures so we learn which steps work. */
async function runPipeline(): Promise<void> {
  const at = new Date().toISOString();
  console.log(`\n[${at}] === TEST PIPELINE START (${TEST_SCHEDULE} ${TIMEZONE}) ===`);
  for (const step of STEPS) {
    console.log(`\n--- ${step.name} (npm run ${step.npmScript}) ---`);
    const code = await runScript(step.npmScript);
    if (code === 0) {
      console.log(`✓ ${step.name} succeeded`);
    } else {
      console.error(`✗ ${step.name} exited ${code} — continuing to next step`);
    }
  }
  console.log(`\n=== TEST PIPELINE DONE ===`);
}

async function start(): Promise<void> {
  await initDb();

  if (!cron.validate(TEST_SCHEDULE)) {
    throw new Error(`Invalid cron expression: ${TEST_SCHEDULE}`);
  }
  cron.schedule(TEST_SCHEDULE, () => void runPipeline(), { timezone: TIMEZONE });
  console.log(
    `⚠️  TEMPORARY TEST SCHEDULE active: full pipeline at "${TEST_SCHEDULE}" (${TIMEZONE}).`,
  );
  console.log(`Steps: ${STEPS.map((s) => s.name).join(' → ')}`);
  console.log('Scheduler running. Press Ctrl-C to stop.');
}

async function shutdown(): Promise<void> {
  console.log('\nScheduler shutting down…');
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

start().catch((err) => {
  console.error('Scheduler failed to start:', err);
  process.exit(1);
});
