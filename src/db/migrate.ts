import { initDb } from './init.js';
import { closeDb, query } from './index.js';

/**
 * Postgres migration / setup script. Creates every table the tracker uses
 * (listings, rentals, interest_rates, grades, crime_cache, crime_zip_cache,
 * census_cache, alerts_sent, investor_profile) by applying src/db/schema.sql.
 * Idempotent — safe to run on every deploy; existing tables are left intact.
 *
 *   npm run db:migrate          # against $DATABASE_URL
 *
 * Railway: this runs automatically on web boot (see the `start` script) so a
 * fresh Postgres plugin is provisioned without any manual step.
 */
async function main(): Promise<void> {
  console.log('Applying schema to Postgres ($DATABASE_URL)…');
  await initDb();

  const tables = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(
    `✓ Migration complete. Tables: ${tables.map((t) => t.table_name).join(', ')}.`,
  );
}

/**
 * On the web service this runs first in the `start` script
 * (`db:migrate && dashboard start`). If it fails or hangs, the dashboard never
 * boots, Railway's healthcheck never goes green, and the platform SIGTERM-kills
 * the container in a restart loop. So we make failure LOUD and explicit: log
 * the full error and exit with a non-zero code so the `&&` chain stops here and
 * the cause is visible in the deploy logs (rather than a silent restart loop).
 */
main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(
      '✗ Migration failed — aborting before the dashboard starts:',
    );
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
