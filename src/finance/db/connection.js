// Single place that builds the finance Knex instance and runs the finance
// migrations. Everything finance-side (db:migrate, the legacy Express server,
// one-off scripts, and the Next.js route handlers in Phase 3) goes through here
// so there is exactly one DATABASE_URL, one SSL rule, and one DATE parser.
import path from 'path';
import { fileURLToPath } from 'url';
import knexFactory from 'knex';
import pg from 'pg';
import { seedPropertyCategoryMap } from '../lib/propertyMap.js';

// node-postgres parses DATE (OID 1082) into a JS Date at local midnight, which
// shifts the day in non-UTC zones. Keep DATE as the raw 'YYYY-MM-DD' string.
// (This is the `pg` module Knex's pg client loads, so it applies to Knex too.)
pg.types.setTypeParser(1082, (v) => v);

const here = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = path.join(here, 'migrations');
// Shared with the tracker database; the name matches the old finance DB so its
// knex_migrations rows (001–008) line up with these files one-for-one.
export const MIGRATIONS_TABLE = 'knex_migrations';

export const MIGRATION_CONFIG = {
  directory: MIGRATIONS_DIR,
  tableName: MIGRATIONS_TABLE,
  loadExtensions: ['.js'],
};

// Same rule as the tracker's pools (src/db/index.ts, src/dashboard/lib/db.ts),
// since both now talk to the same database.
export function sslConfig(url) {
  if (process.env.DATABASE_SSL === 'false') return undefined;
  if (process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Knex config for a connection string (defaults to $DATABASE_URL). */
export function financeKnexConfig(url = process.env.DATABASE_URL, { poolMax } = {}) {
  if (!url || !url.trim()) {
    throw new Error('DATABASE_URL is not set; the finance database has no fallback.');
  }
  return {
    client: 'pg',
    connection: { connectionString: url, ssl: sslConfig(url) },
    pool: { min: 0, max: Number(poolMax ?? process.env.FINANCE_POOL_MAX ?? 3) },
    migrations: MIGRATION_CONFIG,
  };
}

/** A new Knex instance for a connection string (defaults to $DATABASE_URL). */
export function createFinanceKnex(url, opts) {
  return knexFactory(financeKnexConfig(url, opts));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Apply pending finance migrations. The web and worker services both run
 * db:migrate on boot, so if the other one holds Knex's migration lock we wait
 * for it instead of failing the deploy.
 *
 * @returns {Promise<string[]>} names of the migrations applied in this run
 */
export async function migrateFinance(knex, { lockWaitMs = 60_000, log = () => {} } = {}) {
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      const [, applied] = await knex.migrate.latest(MIGRATION_CONFIG);
      // Propose property mappings for categories that appeared since the last
      // deploy (e.g. after the finance data copy). Only adds missing rows.
      const seeded = await seedPropertyCategoryMap(knex);
      if (seeded.length) log(`Proposed ${seeded.length} property mapping(s): ${seeded.map((r) => r.category).join(', ')}`);
      return applied;
    } catch (err) {
      const locked = /already locked/i.test(String(err && err.message));
      if (!locked || Date.now() > deadline) throw err;
      log('Finance migrations are locked by another process; waiting…');
      await sleep(2_000);
    }
  }
}
