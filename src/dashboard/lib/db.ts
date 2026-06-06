import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Read-only SQLite access for the dashboard.
 *
 * The dashboard is a self-contained Next.js app living at src/dashboard, but the
 * tracker database lives at the project root (data/tracker.db). Rather than
 * hard-code "../../", we walk up from the current working directory looking for
 * a `data/tracker.db`, and allow an explicit override via TRACKER_DB_PATH. The
 * connection is opened read-only — the dashboard never mutates the tracker.
 */

let db: Database.Database | null = null;
let resolved = false;
let writable: Database.Database | null = null;

function locateDb(): string | null {
  const override = process.env.TRACKER_DB_PATH;
  if (override) return existsSync(override) ? override : null;

  let dir = process.cwd();
  // Walk up to the filesystem root looking for data/tracker.db.
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'data', 'tracker.db');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The shared read-only connection, or null when the database file doesn't exist
 * yet (fresh checkout before `npm run db:init`). Callers treat null as "no data".
 */
export function getDb(): Database.Database | null {
  if (resolved) return db;
  resolved = true;

  const path = locateDb();
  if (!path) return (db = null);

  db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * A read-write connection, used only for the investor-profile settings the
 * dashboard owns. The dashboard is otherwise read-only; this is a separate
 * connection so the rest of the app can't accidentally mutate the tracker.
 *
 * Ensures the investor_profile table exists so the dashboard works even on a
 * database created before this feature (without re-running `npm run db:init`).
 * Returns null when the database file doesn't exist yet.
 */
export function getWritableDb(): Database.Database | null {
  if (writable) return writable;

  const path = locateDb();
  if (!path) return null;

  writable = new Database(path); // read-write
  writable.pragma('journal_mode = WAL');
  writable.exec(`
    CREATE TABLE IF NOT EXISTS investor_profile (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      max_purchase_price  REAL,
      available_cash      REAL,
      property_types      TEXT,
      min_beds            INTEGER,
      min_coc_return      REAL,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return writable;
}
