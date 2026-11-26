import { linkProjectTransactions, listProjectTransactions, unlinkProjectTransactions } from '@finance/services/projects.js';
import { run, readJson, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/projects/:id/transactions — the transactions linked to a project.
export async function GET(_req: Request, { params }: IdContext) {
  return run(async (knex) => listProjectTransactions(knex, await params));
}

// POST /api/finance/projects/:id/transactions — { ids } links them to the project.
export async function POST(req: Request, { params }: IdContext) {
  return run(async (knex) => linkProjectTransactions(knex, await params, await readJson(req)));
}

// DELETE /api/finance/projects/:id/transactions — { ids } takes them off the project.
export async function DELETE(req: Request, { params }: IdContext) {
  return run(async (knex) => unlinkProjectTransactions(knex, await params, await readJson(req)));
}
