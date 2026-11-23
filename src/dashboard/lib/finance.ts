import { NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { createFinanceKnex } from '@finance/db/connection.js';

/**
 * Shared plumbing for the /api/finance/* route handlers.
 *
 * The finance logic lives in src/finance/services (plain functions taking a
 * Knex instance). These helpers give every handler the same DB handle, the same
 * request parsing and the same error contract the old Express app had:
 *   - an error with `.status` (e.g. 400, 404) → that status + { error: message }
 *   - anything else → 500 + { error: message } (and it's logged)
 *
 * Knex is built from the same DATABASE_URL as lib/db.ts (one database), with
 * its own small pool: Knex can't borrow connections from a `pg` Pool. It's
 * memoized on globalThis so Next's dev hot-reload doesn't open a new pool per
 * edit.
 */

const KNEX_KEY = Symbol.for('mancuso.financeKnex');
const OVERRIDE_KEY = Symbol.for('mancuso.financeKnexOverride');

type FinanceGlobals = { [KNEX_KEY]?: Knex; [OVERRIDE_KEY]?: Knex | null };
const g = globalThis as unknown as FinanceGlobals;

/** The finance Knex instance (the test override, if one is set). */
export function financeDb(): Knex {
  const override = g[OVERRIDE_KEY];
  if (override) return override;
  if (!g[KNEX_KEY]) g[KNEX_KEY] = createFinanceKnex();
  return g[KNEX_KEY]!;
}

/** Tests: route every handler to this Knex instance (e.g. pg-mem). Pass null to clear. */
export function setFinanceDb(knex: Knex | null): void {
  g[OVERRIDE_KEY] = knex;
}

/** An Error carrying an HTTP status, same convention as the services (`e.status`). */
export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * Run a service call and turn its result (or error) into a JSON response.
 * `status` is the success status (201 for creates).
 */
export async function run(
  fn: (knex: Knex) => Promise<unknown>,
  status = 200,
): Promise<NextResponse> {
  try {
    const body = await fn(financeDb());
    return NextResponse.json(body, { status });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const code = typeof e?.status === 'number' ? e.status : 500;
    if (code >= 500) console.error(err); // don't log expected 4xx validation errors
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: code });
  }
}

/**
 * The request's JSON body, parsed the way express.json() did: only for a JSON
 * content type, `{}` when there's no body, and a 400 when it isn't valid JSON.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!/\bjson\b/i.test(type)) return {};
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw httpError(400, 'Request body is not valid JSON');
  }
}

/** Query-string parameters as a plain object, like Express's req.query. */
export function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}

/** Next 15 route context for a dynamic [id] segment. */
export type IdContext = { params: Promise<{ id: string }> };
