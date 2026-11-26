import { query } from './db';

/** SQL for a vendor's trades (alias `v`), in Admin → Trades order, as text[]. */
export const VENDOR_TRADES_SQL = `COALESCE((
  SELECT array_agg(vt.trade ORDER BY COALESCE(t.sort_order, 999), vt.trade)
  FROM vendor_trades vt LEFT JOIN trades t ON t.key = vt.trade
  WHERE vt.vendor_id = v.id), ARRAY[v.trade]::text[])`;

/** SQL for a project's trades (alias `wo`), in Admin → Trades order, as text[]. */
export const PROJECT_TRADES_SQL = `COALESCE((
  SELECT array_agg(pt.trade ORDER BY COALESCE(t.sort_order, 999), pt.trade)
  FROM project_trades pt LEFT JOIN trades t ON t.key = pt.trade
  WHERE pt.work_order_id = wo.id), ARRAY[]::text[])`;

/** A string, array or nothing → distinct, non-empty trade keys (order kept). */
export function normalizeTrades(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
}

/** Make sure each key is a trade (unknown ones are added at the end of the list). */
async function ensureTrades(keys: string[]) {
  for (const k of keys) {
    await query(
      `INSERT INTO trades (key, label, sort_order)
       VALUES ($1, initcap(replace($1, '_', ' ')), COALESCE((SELECT MAX(sort_order) FROM trades), 0) + 1)
       ON CONFLICT (key) DO NOTHING`,
      [k],
    );
  }
}

/** Replace a vendor's trades; vendors.trade keeps the first (older readers use it). */
export async function setVendorTrades(vendorId: number, trades: string[]) {
  await ensureTrades(trades);
  await query(`DELETE FROM vendor_trades WHERE vendor_id = $1 AND NOT (trade = ANY($2::text[]))`, [vendorId, trades]);
  for (const t of trades) await query(`INSERT INTO vendor_trades (vendor_id, trade) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [vendorId, t]);
  if (trades[0]) await query(`UPDATE vendors SET trade = $1 WHERE id = $2`, [trades[0], vendorId]);
}

/** Replace a project's trades (categories). */
export async function setProjectTrades(workOrderId: number, trades: string[]) {
  await ensureTrades(trades);
  await query(`DELETE FROM project_trades WHERE work_order_id = $1 AND NOT (trade = ANY($2::text[]))`, [workOrderId, trades]);
  for (const t of trades) await query(`INSERT INTO project_trades (work_order_id, trade) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [workOrderId, t]);
}
