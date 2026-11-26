import { sendTest } from '@finance/alerts/engine.js';
import { run, type IdContext } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/:id/test — send the message as it reads now, whether or not it would fire.
export async function POST(_req: Request, { params }: IdContext) {
  return run(async (knex) => sendTest(knex, (await params).id));
}
