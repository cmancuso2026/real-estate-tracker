import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { tradeKey } from '@/lib/trades';

export const dynamic = 'force-dynamic';

// GET /api/v2/trades?all=1 — the trade list (vendor trades and project
// categories), in Admin order. Archived trades only with ?all=1. Each row
// carries how many vendors and projects use it.
export async function GET(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all') === '1';
  const rows = await query(
    `SELECT t.key, t.label, t.sort_order, t.archived,
            (SELECT COUNT(*) FROM vendor_trades vt WHERE vt.trade = t.key)::int  AS vendor_count,
            (SELECT COUNT(*) FROM project_trades pt WHERE pt.trade = t.key)::int AS project_count
     FROM trades t
     ${all ? '' : 'WHERE t.archived = FALSE'}
     ORDER BY t.sort_order, t.label`,
  );
  return NextResponse.json(rows);
}

// POST /api/v2/trades — { label } adds a trade at the end of the list.
export async function POST(req: NextRequest) {
  const { label } = (await req.json()) as { label?: string };
  const name = String(label ?? '').trim();
  const key = tradeKey(name);
  if (!name || !key) return NextResponse.json({ error: 'A trade name is required' }, { status: 400 });
  const clash = await query<{ key: string; label: string }>(`SELECT key, label FROM trades WHERE key = $1 OR LOWER(label) = LOWER($2)`, [key, name]);
  if (clash.length) return NextResponse.json({ error: `“${clash[0]!.label}” already exists` }, { status: 400 });
  const rows = await query(
    `INSERT INTO trades (key, label, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) FROM trades), 0) + 1)
     RETURNING *`,
    [key, name],
  );
  return NextResponse.json(rows[0], { status: 201 });
}
