import { getBalances, renameAccount } from '@finance/lib/balances.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/balances — daily closing balances per account (Bank of America
// checking / savings uploads) and total cash: { accounts: [...], total }
export async function GET() {
  return run((knex) => getBalances(knex));
}

// PATCH /api/finance/balances — { from, to } renames an account (to an existing
// name merges the two, unless a shared day disagrees).
export async function PATCH(req: Request) {
  return run(async (knex) => renameAccount(knex, await readJson(req)));
}
