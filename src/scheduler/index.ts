import cron from 'node-cron';
import { spawn } from 'node:child_process';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';

/**
 * Long-running cron scheduler for the tracker's recurring jobs. Start it with
 * `npm run scheduler` and keep the process alive (e.g. under pm2, systemd, or a
 * container) — node-cron fires each job on its schedule in-process.
 *
 * Schedules are expressed in UTC (TIMEZONE below). The daily times target
 * Miami (Eastern). NOTE: because these are fixed UTC times, the Miami-local
 * time drifts by one hour across DST — the comments reflect EDT (summer,
 * UTC-4); during EST (winter, UTC-5) each job runs one hour earlier locally.
 *
 * Jobs are time-separated so each sees the prior step's output: fetch (10:00)
 * completes before grading (10:30), which completes before notifications
 * (11:00). Each job runs its steps in sequence via the same npm scripts used
 * for manual/CLI runs.
 */

// Schedules below are interpreted in UTC.
const TIMEZONE = 'UTC';

interface Job {
  name: string;
  /** Standard 5-field cron expression (min hour dom mon dow), in UTC. */
  schedule: string;
  /** npm scripts to run, in order. */
  steps: string[];
}

const JOBS: Job[] = [
  {
    name: 'fetch-listings',
    // 10:00 UTC daily — 6:00 AM Miami (EDT).
    schedule: '0 10 * * *',
    steps: ['fetch:all'],
  },
  {
    name: 'grade-properties',
    // 10:30 UTC daily — 6:30 AM Miami (EDT).
    schedule: '30 10 * * *',
    steps: ['grade'],
  },
  {
    name: 'daily-notifications',
    // 11:00 UTC daily — 7:00 AM Miami (EDT). Slack alerts, then email digest.
    schedule: '0 11 * * *',
    steps: ['notify:slack', 'notify:email'],
  },
  {
    name: 'weekly-a-grade-digest',
    // 11:00 UTC every Friday — 7:00 AM Miami (EDT) Fridays.
    schedule: '0 11 * * 5',
    steps: ['notify:email:weekly'],
  },
  {
    name: 'v2-daily-alerts',
    // 12:00 UTC daily — 8:00 AM Miami (EDT). Lease expiry, unrated WOs, insurance.
    schedule: '0 12 * * *',
    steps: ['v2:alerts'],
  },
  {
    name: 'v2-monthly-recap',
    // 13:00 UTC on the 1st of each month — 9:00 AM Miami (EDT).
    schedule: '0 13 1 * *',
    steps: ['v2:recap'],
  },
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

/** Run a job's steps in order, continuing past failures so one bad step doesn't block the rest. */
async function runJob(job: Job): Promise<void> {
  const at = new Date().toISOString();
  console.log(`\n[${at}] running ${job.name} (${job.schedule} ${TIMEZONE})`);
  for (const step of job.steps) {
    console.log(`  --- ${step} ---`);
    const code = await runScript(step);
    if (code === 0) {
      console.log(`  ✓ ${step} succeeded`);
    } else {
      console.error(`  ✗ ${step} exited ${code} — continuing`);
    }
  }
  console.log(`[${job.name}] done`);
}

async function start(): Promise<void> {
  await initDb();

  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression for ${job.name}: ${job.schedule}`);
    }
    cron.schedule(job.schedule, () => void runJob(job), { timezone: TIMEZONE });
    console.log(
      `Scheduled ${job.name}: "${job.schedule}" (${TIMEZONE}) — steps: ${job.steps.join(' → ')}`,
    );
  }

  console.log(`Scheduler running — ${JOBS.length} job(s). Press Ctrl-C to stop.`);
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
