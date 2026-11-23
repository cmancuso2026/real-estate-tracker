import { recategorize } from '@finance/services/admin.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/recategorize — { dry_run } — re-run categorization over
// uncategorized, non-manual rows. dry_run lists what would change.
export async function POST(req: Request) {
  return run(async (knex) => recategorize(knex, await readJson(req)));
}
