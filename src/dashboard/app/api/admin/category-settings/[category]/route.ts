import { setCategorySetting } from '@finance/lib/attribution.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/admin/category-settings/:category — { requires_property?, allow_project_tag?, default_property_id? }.
// Turning requires_property on queues that category's unattributed rows at once;
// turning it off takes them out of the queue and keeps any attribution saved.
// → { setting, queued }
export async function PUT(req: Request, { params }: { params: Promise<{ category: string }> }) {
  return run(async (knex) => setCategorySetting(knex, (await params).category, await readJson(req)));
}
