import { deleteRule, updateRule } from '@finance/alerts/service.js';
import { run, readJson, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/alerts/:id — the whole alert, or just { enabled }.
export async function PATCH(req: Request, { params }: IdContext) {
  return run(async (knex) => updateRule(knex, await params, await readJson(req)));
}

// DELETE /api/admin/alerts/:id
export async function DELETE(_req: Request, { params }: IdContext) {
  return run(async (knex) => deleteRule(knex, await params));
}
