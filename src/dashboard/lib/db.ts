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
