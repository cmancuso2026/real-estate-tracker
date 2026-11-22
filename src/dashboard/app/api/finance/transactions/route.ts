import { listTransactions } from '@finance/services/transactions.js';
import { queryOf, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/transactions — filtered + paginated list.
// Query: year, months (comma list), group, category, source, search, limit, offset.
// → { transactions: [...], total }
export async function GET(req: Request) {
  return run((knex) => listTransactions(knex, queryOf(req)));
}
