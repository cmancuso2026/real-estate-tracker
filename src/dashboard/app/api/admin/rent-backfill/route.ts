import { rentBackfill } from '@finance/services/admin.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/rent-backfill — preview (writes nothing): { scanned, created,
// updated, relinked, removed, already_recorded, unmatched: [...], changes: [...] }
export async function GET() {
  return run((knex) => rentBackfill(knex, { dry_run: true }));
}

// POST /api/admin/rent-backfill — { dry_run? } apply (or preview). Safe to repeat.
export async function POST(req: Request) {
  return run(async (knex) => rentBackfill(knex, await readJson(req)));
}
