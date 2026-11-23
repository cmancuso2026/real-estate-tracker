import { updateCategorySettings } from '@finance/services/admin.js';
import { readJson, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// PUT /api/admin/category-settings/:category — { requires_property?, allow_project_tag?,
// default_property_id?, dry_run? }. Turning requires_property on queues that
// category's unattributed rows at once; off takes them out and keeps saved
// attribution. dry_run → { changes: { queue_enter, queue_leave } }.
export async function PUT(req: Request, { params }: { params: Promise<{ category: string }> }) {
  return run(async (knex) => updateCategorySettings(knex, (await params).category, await readJson(req)));
}
