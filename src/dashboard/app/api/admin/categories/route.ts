import { categoryOp, getAdminCategories } from '@finance/services/admin.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/categories — every group and category with usage and rules.
export async function GET() {
  return run((knex) => getAdminCategories(knex));
}

// POST /api/admin/categories — { op, dry_run?, ... }: add, add_group, rename_group,
// rename, move, archive, unarchive, reorder, merge, delete. dry_run returns the
// row counts that would change; without it the change runs in one transaction.
export async function POST(req: Request) {
  return run(async (knex) => categoryOp(knex, await readJson(req)));
}
