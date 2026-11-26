import { deleteChannel, updateChannel } from '@finance/alerts/service.js';
import { run, readJson, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/alerts/channels/:id — webhook_url '' removes it; leaving it out keeps it.
export async function PATCH(req: Request, { params }: IdContext) {
  return run(async (knex) => updateChannel(knex, await params, await readJson(req)));
}

// DELETE /api/admin/alerts/channels/:id — its alerts go to the default channel.
export async function DELETE(_req: Request, { params }: IdContext) {
  return run(async (knex) => deleteChannel(knex, await params));
}
