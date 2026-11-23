import { builtinRules } from '@finance/lib/merchantRules.js';
import { run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/merchant-rules/builtin — the built-in rules from lib/categorize.js (read-only).
export async function GET() {
  return run(async () => ({ rulesets: builtinRules() }));
}
