import { createRule, getAlertsAdmin } from '@finance/alerts/service.js';
import { run, readJson } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/alerts — rules, Slack channels (no webhook URLs), recent sends, and form data.
export async function GET() {
  return run((knex) => getAlertsAdmin(knex));
}

// POST /api/admin/alerts — create an alert.
export async function POST(req: Request) {
  return run(async (knex) => createRule(knex, await readJson(req)), 201);
}
