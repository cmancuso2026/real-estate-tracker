import { deleteRule, updateRule } from '@finance/lib/merchantRules.js';
import { readJson, run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/admin/merchant-rules/:id — edit any field.
export async function PUT(req: Request, { params }: IdContext) {
  return run(async (knex) => updateRule(knex, (await params).id, await readJson(req)));
}

// DELETE /api/admin/merchant-rules/:id
export async function DELETE(_req: Request, { params }: IdContext) {
  return run(async (knex) => deleteRule(knex, (await params).id));
}
