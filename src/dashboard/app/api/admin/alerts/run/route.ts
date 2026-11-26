import { runAlerts } from '@finance/alerts/engine.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/run — check alerts now (real-time and any that are due).
export async function POST() {
  return run(async (knex) => ({ results: await runAlerts(knex) }));
}
