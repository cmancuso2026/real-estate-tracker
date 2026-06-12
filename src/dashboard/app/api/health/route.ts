import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Never cache — Railway polls this to gauge liveness on every check.
export const dynamic = 'force-dynamic';

/**
 * Health check for Railway. Returns 200 with {status:"ok"} when the process is
 * up and (if a database is configured) reachable; 503 when the database is
 * configured but a `SELECT 1` fails. With no DATABASE_URL the process is still
 * considered healthy ("ok", database "unconfigured") so a service can boot
 * before its Postgres plugin is attached.
 */
export async function GET() {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ status: 'ok', database: 'unconfigured' });
  }

  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', database: 'unreachable', message: (err as Error).message },
      { status: 503 },
    );
  }
}
