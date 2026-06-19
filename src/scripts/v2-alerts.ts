/**
 * npm run v2:alerts
 * Sends proactive alerts: lease expiry, unrated work orders, insurance expiry.
 * Triggered daily by the scheduler.
 */
import { sendProactiveAlerts } from '../notifications/property-v2.js';
import { closeDb } from '../db/index.js';

sendProactiveAlerts()
  .then(() => console.log('✓ Proactive alerts checked.'))
  .catch((err) => { console.error('✗ Alerts failed:', err); process.exitCode = 1; })
  .finally(() => closeDb());
