import { getAlertsAdmin } from '@finance/alerts/service.js';
import { interpretAlert, InterpretError, toRuleDraft } from '@/lib/alerts-interpret';
import { httpError, run, readJson } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/admin/alerts/interpret — { text } → { draft, understood, notes, new_channel }.
// Plain English → an alert draft for the Admin form to review (nothing is saved).
export async function POST(req: Request) {
  return run(async (knex) => {
    const { text } = await readJson(req);
    const prompt = String(text ?? '').trim();
    if (!prompt) throw httpError(400, 'Describe the alert first');
    if (prompt.length > 2000) throw httpError(400, 'Keep the description under 2,000 characters');
    const admin = await getAlertsAdmin(knex);
    try {
      const r = await interpretAlert(prompt, {
        channels: admin.channels.map((c: { name: string }) => c.name),
        accounts: admin.accounts,
        groups: admin.groups,
        today: new Date().toISOString().slice(0, 10),
      });
      return toRuleDraft(r, admin.channels, prompt);
    } catch (e) {
      if (e instanceof InterpretError) throw httpError(e.status, e.message);
      throw e;
    }
  });
}
