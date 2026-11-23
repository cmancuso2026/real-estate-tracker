import { getPropertyOptions } from '@finance/services/attribution.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/property-options — properties with their units and projects, for pickers.
export async function GET() {
  return run((knex) => getPropertyOptions(knex));
}
