import { previewRule } from '@finance/alerts/engine.js';
import { run, readJson } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/preview — the message an (unsaved) alert would send right now.
export async function POST(req: Request) {
  return run(async (knex) => previewRule(knex, await readJson(req)));
}
