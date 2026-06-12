import { queryOne, execute } from './index.js';

/**
 * Outbound-notification dedup. Every alert we send is logged in `alerts_sent`
 * keyed by (listing_id, channel, alert_type) — a UNIQUE constraint that lets us
 * answer "have we already told someone about this?" cheaply. Slack uses this to
 * never alert on the same property twice; the email digest logs each property it
 * included for an audit trail (but always sends regardless).
 */

export type AlertChannel = 'slack' | 'email';

/** True if an alert with this exact (listing, channel, type) was already sent. */
export async function hasAlertBeenSent(
  listingId: number,
  channel: AlertChannel,
  alertType: string,
): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM alerts_sent
     WHERE listing_id = $1 AND channel = $2 AND alert_type = $3`,
    [listingId, channel, alertType],
  );
  return row !== null;
}

/**
 * Record that an alert was sent. Idempotent: relies on the UNIQUE constraint and
 * ON CONFLICT DO NOTHING, so a duplicate is a no-op. Returns true when a new row
 * was actually written (i.e. this was the first time), false if it already existed.
 */
export async function recordAlertSent(
  listingId: number,
  channel: AlertChannel,
  alertType: string,
): Promise<boolean> {
  const res = await execute(
    `INSERT INTO alerts_sent (listing_id, channel, alert_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (listing_id, channel, alert_type) DO NOTHING`,
    [listingId, channel, alertType],
  );
  return (res.rowCount ?? 0) > 0;
}
