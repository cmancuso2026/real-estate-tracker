import { testDescription } from '@finance/lib/merchantRules.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/merchant-rules/test — { description, source } → which rule wins, step by step.
export async function POST(req: Request) {
  return run(async (knex) => {
    const b = await readJson(req);
    return testDescription(knex, { description: String(b.description ?? ""), source: String(b.source ?? "") });
  });
}
