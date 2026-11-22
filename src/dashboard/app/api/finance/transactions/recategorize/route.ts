import { recategorizeTransactions } from '@finance/services/transactions.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/finance/transactions/recategorize — re-run history-based
// categorization over Uncategorized, non-manual rows. → { success, scanned, updated }
export async function POST() {
  return run((knex) => recategorizeTransactions(knex));
}
