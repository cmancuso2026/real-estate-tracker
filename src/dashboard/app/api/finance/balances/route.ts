import { getBalances } from '@finance/lib/balances.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/balances — daily closing balances per account (from Bank of
// America checking uploads): { accounts: [{ account, points, latest, month_ends }] }
export async function GET() {
  return run((knex) => getBalances(knex));
}
