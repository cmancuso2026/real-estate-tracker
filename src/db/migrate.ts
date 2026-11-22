import { assertDatabaseUrl, initDb } from './init.js';
import { closeDb, getPool, query } from './index.js';
import { createFinanceKnex, migrateFinance } from '../finance/db/connection.js';

/**
 * Postgres migration / setup script, in two steps against the one DATABASE_URL:
 *
 *   1. src/db/schema.sql — every tracker table (listings, rentals, grades,
 *      owned_properties, units, work_orders, …). Idempotent: every statement is
 *      IF NOT EXISTS, so existing tables are left intact.
 *   2. The finance Knex migrations in src/finance/db/migrations (transactions,
 *      category_overrides, upload_log, custom_categories, …), tracked in the
 *      knex_migrations table. Runs second because later finance migrations
 *      reference tracker tables (owned_properties, work_orders, units).
 *
 * Safe to run on every deploy.
 *
 *   npm run db:migrate          # against $DATABASE_URL
 *
 * Railway: this runs automatically on web boot (see the `start` script) so a
 * fresh Postgres plugin is provisioned without any manual step.
 */
/**
 * Arbitrary constant key for a Postgres advisory lock. The web and worker
 * services both run db:migrate on boot; on a brand-new database two concurrent
 * `CREATE TABLE IF NOT EXISTS` runs can collide in the system catalog
 * (pg_type_typname_nsp_index), and Knex's own migration lock only covers its
 * migrations, not creating knex_migrations itself. Holding one session-level
 * lock for the whole run makes the second process wait for the first.
 */
const MIGRATE_LOCK_KEY = 727_115_001;

async function main(): Promise<void> {
  assertDatabaseUrl();
  const lockClient = await getPool().connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    await migrateAll();
  } finally {
    await lockClient
      .query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY])
      .catch(() => {});
    lockClient.release();
  }
}

async function migrateAll(): Promise<void> {
  console.log('Applying schema to Postgres ($DATABASE_URL)…');
  await initDb();

  console.log('Applying finance migrations (knex_migrations)…');
  const knex = createFinanceKnex(assertDatabaseUrl(), { poolMax: 1 });
  try {
    const applied = await migrateFinance(knex, { log: (m) => console.log(m) });
    console.log(
      applied.length
        ? `✓ Applied ${applied.length} finance migration(s): ${applied.join(', ')}.`
        : '✓ Finance migrations already up to date.',
    );
  } finally {
    await knex.destroy();
  }

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
