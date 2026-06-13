import pg from 'pg';
import { config } from '../config.js';

/**
 * Postgres connection pool for the tracker. A single pool is memoized for the
 * life of the process (CLI scripts and the long-running scheduler). Queries go
 * through the `query` / `execute` / `withTransaction` helpers below so callers
 * never touch the pool directly.
 */

const { Pool } = pg;

/**
 * SQL expression producing the current UTC time as a "YYYY-MM-DD HH24:MI:SS"
 * text string — identical to the format SQLite's `datetime('now')` produced.
 * Timestamp columns stay TEXT, so every existing date parser, formatter, and
 * lexicographic comparison in the app keeps working unchanged after the move
 * off SQLite. Use this wherever the old code wrote `datetime('now')`.
 */
export const NOW_UTC = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

/**
 * A UTC-text expression offset from now by a parameterized interval — the
 * Postgres equivalent of SQLite's `datetime('now', '-N hours')`. Returns a
 * "YYYY-MM-DD HH24:MI:SS" string so it compares correctly against TEXT
 * timestamp columns. `$n` should bind to a numeric amount.
 */
export function nowOffsetText(
  unit: 'hours' | 'days',
  placeholder: string,
): string {
  return `to_char(now() AT TIME ZONE 'UTC' - make_interval(${unit} => ${placeholder}), 'YYYY-MM-DD HH24:MI:SS')`;
}

let pool: pg.Pool | null = null;

/** Opens (and memoizes) the connection pool. */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = config.databaseUrl;
  pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Fail fast on an unreachable/misconfigured host instead of hanging the
    // boot-time migration until the OS-level TCP timeout — a silent hang here
    // is what gets the web service SIGTERM-killed by Railway's healthcheck.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
  });
  return pool;
}

/**
 * Whether to enable TLS for the connection. Railway's *internal* database URL
 * (…railway.internal) needs no SSL; a public/external URL does. We enable SSL
 * when the URL asks for it (`sslmode=require`) or when DATABASE_SSL=true, and
 * disable it for internal/localhost connections. `rejectUnauthorized: false`
 * accepts Railway's managed certificate.
 */
function sslConfig(url: string): pg.PoolConfig['ssl'] {
  if (process.env.DATABASE_SSL === 'false') return undefined;
  if (process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Run a parameterized query and return the rows. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

/** Run a query and return the first row, or null when there are none. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a statement and return the full result (for rowCount, etc.). */
export async function execute(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  return getPool().query(text, params);
}

/** Run `fn` inside a transaction on a dedicated client, committing on success. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool (let a CLI process exit cleanly). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
