import { getAttributionSummary } from '@finance/services/admin.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/attribution — unattributed counts per category and suggested property.
export async function GET() {
  return run((knex) => getAttributionSummary(knex));
}
