import { listCategorySettings } from '@finance/lib/attribution.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/category-settings — per-category rules (requires_property, allow_project_tag, default_property_id).
export async function GET() {
  return run(async (knex) => ({ settings: await listCategorySettings(knex) }));
}
