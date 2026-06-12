import cron from 'node-cron';
import { initDb } from '../db/init.js';
import { closeDb } from '../db/index.js';
import { sendWeeklyDigest } from '../notifications/weekly-digest.js';

/**
 * Long-running cron scheduler for the tracker's recurring jobs. Start it with
 * `npm run scheduler` and keep the process alive (e.g. under pm2, systemd, or a
 * container) — node-cron fires each job on its schedule in-process.
 *
 * Times are interpreted in America/New_York (the tracker targets Miami-Dade),
 * so "8 AM" means 8 AM Eastern regardless of the host's timezone.
 */

const TIMEZONE = 'America/New_York';

interface Job {
  name: string;
  /** Standard 5-field cron expression (min hour dom mon dow). */
  schedule: string;
  run: () => Promise<void>;
}

const JOBS: Job[] = [
  {
    name: 'weekly-a-grade-digest',
    // Every Friday at 8:00 AM Eastern.
    schedule: '0 8 * * 5',
    run: async () => {
      const s = await sendWeeklyDigest();
      console.log(
        `✓ Weekly digest sent: "${s.subject}" (${s.aCount} grade A).`,
      );
    },
  },
];

async function start(): Promise<void> {
  await initDb();

  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression for ${job.name}: ${job.schedule}`);
    }
    cron.schedule(
      job.schedule,
      () => {
        const at = new Date().toISOString();
        console.log(`[${at}] running ${job.name} (${job.schedule})`);
        job.run().catch((err) => {
          console.error(`[${job.name}] failed:`, err);
        });
      },
      { timezone: TIMEZONE },
    );
    console.log(`Scheduled ${job.name}: "${job.schedule}" (${TIMEZONE})`);
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
