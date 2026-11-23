import { createRule, listRules } from '@finance/lib/merchantRules.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/merchant-rules — your rules, in run order.
export async function GET() {
  return run(async (knex) => ({ rules: await listRules(knex) }));
}

// POST /api/admin/merchant-rules — { pattern, match_type, category, property_id?, work_order_id?, priority?, enabled? }.
export async function POST(req: Request) {
  return run(async (knex) => createRule(knex, await readJson(req)), 201);
}
