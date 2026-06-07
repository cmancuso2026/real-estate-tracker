import { buildSlackText, postToSlack } from '../notifications/slack.js';
import type { NotificationItem } from '../notifications/format.js';
import type { GradedProperty } from '../db/grades.js';

/**
 * Send a single sample Slack message to verify SLACK_WEBHOOK_URL and the
 * message formatting — independent of any data in the database.
 *
 *   npm run test:slack
 */
const sampleProperty: GradedProperty = {
  listing_id: 0,
  source: 'zillow',
  source_id: 'TEST',
  address: '123 Test Ave, Hialeah, FL 33012',
  city: 'Hialeah',
  state: 'FL',
  zip_code: '33012',
  latitude: null,
  longitude: null,
  price: 420_000,
  bedrooms: 3,
  bathrooms: 2,
  living_area: 1450,
  property_type: 'SINGLE_FAMILY',
  listing_url: 'https://www.zillow.com/homedetails/test/',
  overall_grade: 'A',
  overall_score: 3.7,
  coc_return: 9.4,
  monthly_cashflow: 612,
  price_per_sqft: 290,
  crime_index: 380.2,
  rental_prevalence: 58,
  reasoning:
    'Overall grade A for an SFH: strong cash-on-cash return of 9.4%, with solid monthly cash flow of $612/mo and price/sqft below the zip median.',
  graded_at: 'now',
};

const sampleItem: NotificationItem = {
  property: sampleProperty,
  zillowUrl: sampleProperty.listing_url,
  realtorUrl: null,
  belowMedianPct: 12,
};

async function main(): Promise<void> {
  const text = `🧪 *Test alert from Real Estate Tracker*\n\n${buildSlackText(sampleItem)}`;
  await postToSlack({ text });
  console.log('✓ Test Slack message sent.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
