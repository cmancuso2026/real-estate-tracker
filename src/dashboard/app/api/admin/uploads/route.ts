import { getUploads } from '@finance/services/admin.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/uploads — upload history, newest first.
export async function GET() {
  return run((knex) => getUploads(knex));
}
