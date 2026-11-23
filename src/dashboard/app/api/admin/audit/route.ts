import { getAudit } from '@finance/services/admin.js';
import { queryOf, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/audit?limit= — the change log, newest first.
export async function GET(req: Request) {
  return run((knex) => getAudit(knex, queryOf(req)));
}
