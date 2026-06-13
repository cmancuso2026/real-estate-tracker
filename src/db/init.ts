import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closeDb } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Fail fast with a clear, actionable message when DATABASE_URL is missing.
 *
 * Without this guard the `pg` pool silently falls back to its libpq defaults
 * (localhost:5432) whenever the connection string is empty — so a worker or
 * web service deployed without the variable appears to "connect" and then
 * errors (or hangs) obscurely against a database that isn't there. We read
 * straight from process.env and refuse to fall back to localhost. On Railway,
 * DATABASE_URL is injected via a service reference; if this throws, the
 * variable simply isn't wired into this service.
 */
export function assertDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. A Postgres connection string is required in ' +
        'the DATABASE_URL environment variable — the database will NOT fall ' +
        'back to localhost:5432. On Railway, reference the Postgres service ' +
        'from this service\'s variables, e.g. ' +
        'DATABASE_URL=${{Postgres.DATABASE_URL}}.',
    );
  }
  return url;
}

/** Applies schema.sql to the database. Idempotent (every statement is IF NOT EXISTS). */
export async function initDb(): Promise<void> {
  assertDatabaseUrl();
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  await getPool().query(schema);
}

// Allow running directly:  npm run db:init
if (import.meta.url === `file://${process.argv[1]}`) {
  initDb()
    .then(() => console.log('✓ Database schema initialized.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
