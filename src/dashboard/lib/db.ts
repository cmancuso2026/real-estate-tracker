import pg from 'pg';

/**
 * Postgres access for the dashboard.
 *
 * The dashboard is a self-contained Next.js app, so it reads DATABASE_URL
 * straight from the environment rather than importing the tracker's
 * env-coupled config. A single pool is memoized for the life of the server
 * process. When DATABASE_URL isn't set the pool is null and queries return
 * empty results — callers treat that as "no data" (fresh deploy before
 * migrations / a DB plugin is attached).
 */

const { Pool } = pg;

/**
 * Current UTC time as a "YYYY-MM-DD HH24:MI:SS" text string — the same shape
 * the tracker stores in its TEXT timestamp columns, so dates round-trip
 * identically. Use wherever a write needs "now".
 */
export const NOW_UTC = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

let pool: pg.Pool | null = null;
let resolved = false;

function sslConfig(url: string): pg.PoolConfig['ssl'] {
  if (process.env.DATABASE_SSL === 'false') return undefined;
  if (process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** The shared pool, or null when DATABASE_URL isn't configured. */
export function getPool(): pg.Pool | null {
  if (resolved) return pool;
  resolved = true;
  const url = process.env.DATABASE_URL;
  if (!url) return (pool = null);
  pool = new Pool({
    connectionString: url,
    ssl: sslConfig(url),
    max: Number(process.env.PG_POOL_MAX ?? 5),
  });
  return pool;
}

/** Run a query and return its rows (empty array when there's no database). */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(text, params);
  return res.rows as T[];
}

/** Run a query and return the first row, or null. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Ensure the investor_profile table exists before the dashboard writes to it,
 * so saving works even against a database created before this feature (or
 * before migrations ran). Memoized so it runs at most once per process.
 */
let profileTableReady: Promise<void> | null = null;
export function ensureProfileTable(): Promise<void> {
  if (profileTableReady) return profileTableReady;
  const p = getPool();
  if (!p) return Promise.resolve();
  profileTableReady = p
    .query(
      `CREATE TABLE IF NOT EXISTS investor_profile (
         id                  INTEGER PRIMARY KEY CHECK (id = 1),
         min_purchase_price  DOUBLE PRECISION,
         max_purchase_price  DOUBLE PRECISION,
         available_cash      DOUBLE PRECISION,
         property_types      TEXT,
         min_beds            INTEGER,
         min_coc_return      DOUBLE PRECISION,
         updated_at          TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
       )`,
    )
    .then(() => undefined);
  return profileTableReady;
}
