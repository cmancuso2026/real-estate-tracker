import { testChannel } from '@finance/alerts/service.js';
import { run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/channels/:id/test — post a hello message to the channel.
export async function POST(_req: Request, { params }: IdContext) {
  return run(async (knex) => testChannel(knex, await params));
}
