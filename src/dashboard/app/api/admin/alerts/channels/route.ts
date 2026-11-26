import { createChannel } from '@finance/alerts/service.js';
import { run, readJson } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/channels — { name, webhook_url?, slack_channel?, is_default? }
export async function POST(req: Request) {
  return run(async (knex) => createChannel(knex, await readJson(req)), 201);
}
