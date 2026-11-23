import { rentNeedingUnit } from '@finance/lib/rentSync.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/rent/needs-unit — rent payments that couldn't be matched to a
// unit: { items: [{ id, date, description, amount, category, property_id, property, reason }] }
export async function GET() {
  return run(async (knex) => ({ items: await rentNeedingUnit(knex) }));
}
