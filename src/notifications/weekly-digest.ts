import { getRecentGradedProperties } from '../db/grades.js';
import { recordAlertSent } from '../db/alerts.js';
import { getInvestorProfile, filterByProfile } from './profile-filter.js';
import {
  toNotificationItem,
  fmtMoney,
  fmtPct,
  fmtPriceSqft,
  fmtType,
  type NotificationItem,
} from './format.js';
import { sendViaSendGrid } from './email.js';

/**
 * Weekly A-grade email digest via SendGrid. Pulls every property whose current
 * grade is "A" that was graded in the last 7 days, renders it as a clean HTML
 * email (address/type, cash-on-cash, monthly cash flow, price/sqft vs zip
 * median, the plain-English grade reasoning, and a Zillow link), and always
 * sends — even in a quiet week it sends a short "market was quiet" note.
 *
 * Intended for a Friday 8 AM cron (see src/scheduler/index.ts). Like the daily
 * digest it applies the saved investor-profile filters so the email never
 * surfaces a property that would be hidden on the dashboard, and logs each
 * included property to alerts_sent for an audit trail.
 */

const ALERT_TYPE = 'weekly_digest';
const CHANNEL = 'email';
const A_GRADE_COLOR = '#1a7f37';
const WEEK_HOURS = 7 * 24;

export interface WeeklyDigestSummary {
  /** Number of A-grade opportunities included this week. */
  aCount: number;
  subject: string;
}

/**
 * Build and send the weekly A-grade digest. Defaults to a 7-day window; pass
 * `sinceHours` to widen it (the manual script can use a large value to pull in
 * existing data for a test send). Returns a summary even when nothing matched.
 */
export async function sendWeeklyDigest(
  opts: { sinceHours?: number; dryRun?: boolean } = {},
): Promise<WeeklyDigestSummary> {
  const sinceHours = opts.sinceHours ?? WEEK_HOURS;

  // Latest-grade-per-property within the window, run through the same
  // investor-profile filter the dashboard and daily digest use, then narrowed
  // to grade A — these are the week's opportunities.
  const properties = filterByProfile(
    await getRecentGradedProperties(sinceHours),
    await getInvestorProfile(),
  ).filter((p) => p.overall_grade === 'A');

  const items = await Promise.all(properties.map(toNotificationItem));
  const date = weekOfLabel();
  const subject = buildWeeklySubject(date, properties.length);
  const html =
    items.length > 0 ? buildWeeklyHtml(items, date) : buildQuietHtml(date);

  if (opts.dryRun) {
    console.log(`[dry-run] subject: ${subject}`);
    console.log(`[dry-run] ${properties.length} grade-A propert(y/ies)`);
  } else {
    await sendViaSendGrid(subject, html);
    for (const p of properties) {
      await recordAlertSent(p.listing_id, CHANNEL, ALERT_TYPE);
    }
  }

  return { aCount: properties.length, subject };
}

/** "🏠 Weekly A-Grade Properties - Week of Jun 6, 2026 - 3 opportunities found" */
export function buildWeeklySubject(date: string, count: number): string {
  const noun = `${count} opportunit${count === 1 ? 'y' : 'ies'} found`;
  return `🏠 Weekly A-Grade Properties - Week of ${date} - ${noun}`;
}

/** Full HTML email: one card per A-grade property. */
export function buildWeeklyHtml(items: NotificationItem[], date: string): string {
  const cards = items.map(propertyCard).join('\n');
  return shell(
    date,
    `<div style="color:#57606a;font-size:13px;margin-bottom:20px">Week of ${escapeHtml(date)} · ${items.length} A-grade opportunit${items.length === 1 ? 'y' : 'ies'}</div>
    ${cards}`,
  );
}

/** Short, friendly note for a week with no A-grade properties. */
export function buildQuietHtml(date: string): string {
  return shell(
    date,
    `<div style="color:#57606a;font-size:13px;margin-bottom:20px">Week of ${escapeHtml(date)}</div>
    <div style="background:#ffffff;border:1px solid #d0d7de;border-radius:6px;padding:20px;font-size:14px;line-height:1.5">
      <p style="margin:0 0 8px">No properties earned an <strong>A</strong> grade this week — the market was quiet.</p>
      <p style="margin:0;color:#57606a">We'll keep scanning new listings and rental comps. You'll hear from us next Friday, or sooner via Slack the moment an A-grade opportunity appears.</p>
    </div>`,
  );
}

function propertyCard(item: NotificationItem): string {
  const p = item.property;
  const address = escapeHtml(p.address ?? p.city ?? `Listing ${p.listing_id}`);
  const sub = [
    escapeHtml(fmtType(p.property_type)),
    p.zip_code ? escapeHtml(p.zip_code) : null,
    p.price != null ? escapeHtml(fmtMoney(p.price)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const reasoning = p.reasoning
    ? `<tr><td colspan="2" style="font-size:13px;color:#1f2328;padding-top:10px;line-height:1.5;border-top:1px solid #eaeef2;margin-top:8px">${escapeHtml(p.reasoning)}</td></tr>`
    : '';

  return `
  <div style="margin-bottom:16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td style="padding:14px;border:1px solid #d0d7de;border-radius:6px;background:#ffffff">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:15px;font-weight:600">${address}</td>
              <td align="right" style="font-size:15px;font-weight:700;color:${A_GRADE_COLOR}">A</td>
            </tr>
            <tr><td colspan="2" style="font-size:12px;color:#57606a;padding-top:2px">${sub}</td></tr>
            <tr><td colspan="2" style="font-size:13px;padding-top:10px">
              <strong>CoC return:</strong> ${escapeHtml(fmtPct(p.coc_return))} &nbsp;·&nbsp;
              <strong>Cash flow:</strong> ${escapeHtml(fmtMoney(p.monthly_cashflow))}/mo
            </td></tr>
            <tr><td colspan="2" style="font-size:13px;padding-top:4px">
              <strong>Price/sqft:</strong> ${escapeHtml(fmtPriceSqft(item))}
            </td></tr>
            ${reasoning}
            <tr><td colspan="2" style="font-size:13px;padding-top:10px">${linkAnchor(item)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

function linkAnchor(item: NotificationItem): string {
  if (item.zillowUrl) {
    return `🔗 <a href="${encodeURI(item.zillowUrl)}" style="color:#0969da">View on Zillow</a>`;
  }
  if (item.realtorUrl) {
    return `🔗 <a href="${encodeURI(item.realtorUrl)}" style="color:#0969da">View on Realtor.com</a>`;
  }
  return `<span style="color:#8c959f">No listing link available</span>`;
}

/** Shared HTML scaffold (header + footer) around the digest body. */
function shell(date: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2328">
  <div style="max-width:680px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;margin:0 0 4px">🏠 Weekly A-Grade Properties</h1>
    ${body}
    <div style="color:#8c959f;font-size:11px;margin-top:28px;border-top:1px solid #d0d7de;padding-top:12px">
      Generated by Real Estate Tracker for the week of ${escapeHtml(date)}. Grades reflect cash-on-cash, cash flow, price/sqft, crime, and rental-demand components.
    </div>
  </div>
</body>
</html>`;
}

/** Label for the Friday the digest covers, e.g. "Jun 6, 2026". */
function weekOfLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
