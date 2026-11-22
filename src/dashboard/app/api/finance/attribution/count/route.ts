import { getQueueCount } from '@finance/services/attribution.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/attribution/count — { count } of transactions waiting for a property.
export async function GET() {
  return run((knex) => getQueueCount(knex));
}
