import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

// PATCH /api/v2/trades/[key] — { label?, archived?, direction?: 'up' | 'down' }.
// Renaming changes only the label (vendors and projects keep the key).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { key } = await params;
  const body = (await req.json()) as { label?: string; archived?: boolean; direction?: 'up' | 'down' };
  const [t] = await query<{ key: string; sort_order: number }>(`SELECT key, sort_order FROM trades WHERE key = $1`, [key]);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.direction === 'up' || body.direction === 'down') {
    // Renumber the whole list in its current order, then swap with the neighbour.
    const list = await query<{ key: string }>(`SELECT key FROM trades ORDER BY sort_order, label`);
    const i = list.findIndex((r) => r.key === key);
    const j = body.direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j]!, list[i]!];
    for (let n = 0; n < list.length; n += 1) await query(`UPDATE trades SET sort_order = $1 WHERE key = $2`, [n + 1, list[n]!.key]);
  }
  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label) return NextResponse.json({ error: 'A trade name is required' }, { status: 400 });
    const clash = await query(`SELECT 1 FROM trades WHERE LOWER(label) = LOWER($1) AND key <> $2`, [label, key]);
    if (clash.length) return NextResponse.json({ error: `“${label}” already exists` }, { status: 400 });
    await query(`UPDATE trades SET label = $1 WHERE key = $2`, [label, key]);
  }
  if (body.archived !== undefined) await query(`UPDATE trades SET archived = $1 WHERE key = $2`, [!!body.archived, key]);
  const rows = await query(`SELECT * FROM trades WHERE key = $1`, [key]);
  return NextResponse.json(rows[0]);
}

// DELETE /api/v2/trades/[key] — only when no vendor or project uses it
// (archive it otherwise: it then disappears from pickers but history keeps it).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { key } = await params;
  const [use] = await query<{ n: number }>(
    `SELECT ((SELECT COUNT(*) FROM vendor_trades WHERE trade = $1) + (SELECT COUNT(*) FROM project_trades WHERE trade = $1))::int AS n`,
    [key],
  );
  if (use && use.n > 0) return NextResponse.json({ error: `In use by ${use.n} vendor(s)/project(s) — archive it instead` }, { status: 400 });
  await query(`DELETE FROM trades WHERE key = $1`, [key]);
  return NextResponse.json({ ok: true });
}
