import { getDb } from './index.js';

/**
 * Outbound-notification dedup. Every alert we send is logged in `alerts_sent`
 * keyed by (listing_id, channel, alert_type) — a UNIQUE constraint that lets us
 * answer "have we already told someone about this?" cheaply. Slack uses this to
 * never alert on the same property twice; the email digest logs each property it
 * included for an audit trail (but always sends regardless).
 */

export type AlertChannel = 'slack' | 'email';

/** True if an alert with this exact (listing, channel, type) was already sent. */
export function hasAlertBeenSent(
  listingId: number,
  channel: AlertChannel,
  alertType: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM alerts_sent
       WHERE listing_id = ? AND channel = ? AND alert_type = ?`,
    )
    .get(listingId, channel, alertType);
  return row !== undefined;
}

/**
 * Record that an alert was sent. Idempotent: relies on the UNIQUE constraint and
 * INSERT OR IGNORE, so a duplicate is a no-op. Returns true when a new row was
 * actually written (i.e. this was the first time), false if it already existed.
 */
export function recordAlertSent(
  listingId: number,
  channel: AlertChannel,
  alertType: string,
): boolean {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO alerts_sent (listing_id, channel, alert_type)
       VALUES (?, ?, ?)`,
    )
    .run(listingId, channel, alertType);
  return info.changes > 0;
}
