import { config } from '../config.js';
import { getAGradeProperties } from '../db/grades.js';
import { hasAlertBeenSent, recordAlertSent } from '../db/alerts.js';
import { getInvestorProfile, filterByProfile } from './profile-filter.js';
import {
  toNotificationItem,
  fmtMoney,
  fmtPct,
  fmtPriceSqft,
  fmtBedsBaths,
  fmtSqft,
  fmtType,
  type NotificationItem,
} from './format.js';

/**
 * Slack alerts for grade-A properties.
 *
 * We send one message per A-graded property and dedupe via the alerts_sent
 * table so the same property is never alerted twice. Posting goes to the
 * incoming webhook in SLACK_WEBHOOK_URL.
 */

const ALERT_TYPE = 'new_a_grade';
const CHANNEL = 'slack';

export interface SlackSendSummary {
  candidates: number; // grade-A properties found
  sent: number; // messages actually posted
  skipped: number; // already alerted previously
}

/**
 * Post a Slack alert for every grade-A property that hasn't been alerted yet.
 * Records each successful send so the next run won't repeat it. Set
 * `opts.dryRun` to log what would be sent without posting or recording.
 */
export async function sendSlackAlerts(
  opts: { dryRun?: boolean } = {},
): Promise<SlackSendSummary> {
  // Only alert on A-grade properties that also match the investor profile —
  // never alert on something that would be filtered out on the dashboard.
  const properties = filterByProfile(
    await getAGradeProperties(),
    await getInvestorProfile(),
  );
  const summary: SlackSendSummary = {
    candidates: properties.length,
    sent: 0,
    skipped: 0,
  };

  for (const p of properties) {
    if (await hasAlertBeenSent(p.listing_id, CHANNEL, ALERT_TYPE)) {
      summary.skipped++;
      continue;
    }

    const item = await toNotificationItem(p);
    const text = buildSlackText(item);

    if (opts.dryRun) {
      console.log(`\n[dry-run] would send:\n${text}`);
      summary.sent++;
      continue;
    }

    await postToSlack({ text });
    await recordAlertSent(p.listing_id, CHANNEL, ALERT_TYPE);
    summary.sent++;
  }

  return summary;
}

/** Build the Slack mrkdwn message body for one property. */
export function buildSlackText(
  item: NotificationItem,
  dashboardUrl: string = config.dashboardUrl,
): string {
  const p = item.property;
  const address = p.address ?? p.city ?? `Listing ${p.listing_id}`;
  const lines = [
    `🏠 *${address}*`,
    `Grade: *${p.overall_grade}*`,
    `Cash on Cash: ${fmtPct(p.coc_return)}`,
    `Monthly Cash Flow: ${fmtMoney(p.monthly_cashflow)}`,
    `Price/SqFt: ${fmtPriceSqft(item)}`,
    `Beds/Baths: ${fmtBedsBaths(p)} | SqFt: ${fmtSqft(p)}`,
    `Type: ${fmtType(p.property_type)}`,
    linkLine(item),
  ];
  if (dashboardUrl) lines.push(`📊 View Dashboard: ${dashboardUrl}`);
  return lines.join('\n');
}

/**
 * Link line. Prefer Zillow; fall back to Realtor.com when there's no Zillow
 * URL. Slack mrkdwn link syntax is <url|label>.
 */
function linkLine(item: NotificationItem): string {
  if (item.zillowUrl) return `🔗 <${item.zillowUrl}|View on Zillow>`;
  if (item.realtorUrl) return `🔗 <${item.realtorUrl}|View on Realtor.com>`;
  return '🔗 (no listing link available)';
}

/** Low-level webhook POST. Slack replies with the literal body "ok" on success. */
export async function postToSlack(payload: {
  text: string;
}): Promise<void> {
  const res = await fetch(config.slackWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}
