import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb, closeDb } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Applies schema.sql to the database. Idempotent. */
export function initDb(): void {
  const db = getDb();
  migrateLegacyGrades(db);
  migrateLegacyCrimeCache(db);
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/**
 * Phase 1 shipped a `grades` table with a different (Claude-stub) shape.
 * `CREATE TABLE IF NOT EXISTS` won't alter it, so drop the legacy table when
 * it predates the Phase 2 columns. Grades are derived data, so this is safe.
 */
function migrateLegacyGrades(db: ReturnType<typeof getDb>): void {
  const cols = db
    .prepare(`PRAGMA table_info(grades)`)
    .all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === 'overall_grade')) {
    db.exec('DROP TABLE grades;');
  }
}

/**
 * The crime cache was originally keyed per zip (state-vs-national rates); it's
 * now keyed per city (FBI agency rate vs the Miami-Dade median). The columns
 * differ, so drop the legacy table when it still has the old `zip_code` key.
 * It's a pure cache, so dropping just forces a refetch.
 */
function migrateLegacyCrimeCache(db: ReturnType<typeof getDb>): void {
  const cols = db
    .prepare(`PRAGMA table_info(crime_cache)`)
    .all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === 'city')) {
    db.exec('DROP TABLE crime_cache;');
  }
}

// Allow running directly:  npm run db:init
if (import.meta.url === `file://${process.argv[1]}`) {
  initDb();
  console.log('✓ Database schema initialized.');
  closeDb();
}
