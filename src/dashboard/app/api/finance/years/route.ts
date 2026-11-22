import { getYears } from '@finance/services/years.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/years — { years: [2026, 2025, …] } (descending).
export async function GET() {
  return run((knex) => getYears(knex));
}
