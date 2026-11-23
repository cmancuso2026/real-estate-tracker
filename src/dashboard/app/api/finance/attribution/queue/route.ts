import { getQueue } from '@finance/services/attribution.js';
import { run, queryOf } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/attribution/queue?category= — the Needs-property queue, newest first.
export async function GET(req: Request) {
  return run((knex) => getQueue(knex, queryOf(req)));
}
