/**
 * Check the alerts set up in Admin → Notifications once: real-time ones, and
 * scheduled ones whose local time has passed and haven't been sent for today's
 * slot. The scheduler runs this every 5 minutes (`npm run alerts:run`).
 */
import { assertDatabaseUrl } from '../db/init.js';
import { createFinanceKnex } from '../finance/db/connection.js';
import { runAlerts } from '../finance/alerts/engine.js';

async function main(): Promise<void> {
  const knex = createFinanceKnex(assertDatabaseUrl(), { poolMax: 2 });
  try {
    if (!(await knex.schema.hasTable('alert_rules'))) {
      console.log('alerts: tables not created yet (run npm run db:migrate)');
      return;
    }
    const results = await runAlerts(knex);
    for (const r of results) {
      console.log(`  ${r.error ? '✗' : r.sent ? '✓ sent' : '· checked'} ${r.rule}${r.error ? ` — ${r.error}` : ''}`);
    }
    console.log(`alerts: ${results.length} checked, ${results.filter((r) => r.sent).length} sent`);
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error('alerts run failed:', err);
  process.exit(1);
});
