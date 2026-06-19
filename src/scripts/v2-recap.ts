/**
 * npm run v2:recap
 * Generates and sends the monthly property management recap.
 * Triggered by the scheduler on the 1st of each month at 8:00 AM.
 */
import { sendPropertyRecap } from '../notifications/property-v2.js';
import { closeDb } from '../db/index.js';

sendPropertyRecap()
  .then(() => console.log('✓ Monthly recap sent.'))
  .catch((err) => { console.error('✗ Recap failed:', err); process.exitCode = 1; })
  .finally(() => closeDb());
