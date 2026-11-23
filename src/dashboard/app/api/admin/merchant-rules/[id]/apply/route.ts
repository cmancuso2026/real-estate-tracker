import { applyRuleToExisting } from '@finance/lib/merchantRules.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/merchant-rules/:id/apply — { dry_run } — apply a rule to
// existing non-manual transactions.
export async function POST(req: Request, { params }: IdContext) {
  return run(async (knex) => {
    const body = await readJson(req);
    return applyRuleToExisting(knex, (await params).id, { dryRun: body.dry_run === true });
  });
}
