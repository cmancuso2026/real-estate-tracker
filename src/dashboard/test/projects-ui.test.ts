// Recurring-cost rules and the Vendors → Projects table rows.
import test from 'node:test';
import assert from 'node:assert';
import { activeOn, describeRecurring, recurringFields } from '../lib/recurring';
import { projectRows } from '../lib/projects-overview';
import { tradeKey, humanizeTrade } from '../lib/trades';

test('recurring: monthly / yearly amounts, dates, validation', () => {
  assert.deepEqual(recurringFields({ frequency: 'yearly', amount: '1200', start_date: '2026-01-01', end_date: '2026-12-31' }), {
    frequency: 'yearly', amount: 1200, monthly_amount: 100, start_date: '2026-01-01', end_date: '2026-12-31',
  });
  assert.equal(recurringFields({ amount: 65 }).monthly_amount, 65);
  assert.equal(recurringFields({ monthly_amount: 40 }).frequency, 'monthly'); // older callers
  assert.equal(recurringFields({ frequency: 'yearly', amount: 100 }).monthly_amount, 8.33);
  assert.throws(() => recurringFields({ frequency: 'weekly', amount: 5 }), /monthly or yearly/);
  assert.throws(() => recurringFields({ amount: '' }), /positive number/);
  assert.throws(() => recurringFields({ amount: 5, start_date: '2026-05-01', end_date: '2026-04-01' }), /before the start/);
  assert.throws(() => recurringFields({ amount: 5, start_date: '05/01/2026' }), /YYYY-MM-DD/);
  const rc = { start_date: '2026-01-01', end_date: '2026-06-30' };
  assert.equal(activeOn(rc, '2025-12-31'), false);
  assert.equal(activeOn(rc, '2026-06-30'), true);
  assert.equal(activeOn({ ...rc, is_active: false }, '2026-03-01'), false);
  assert.equal(activeOn({}, '2030-01-01'), true);
  assert.equal(describeRecurring({ frequency: 'yearly', amount: 1200, start_date: null, end_date: null }), '$1,200 / year');
  assert.match(describeRecurring({ frequency: 'monthly', amount: 65, start_date: '2026-01-01', end_date: null }), /^\$65 \/ month · Jan 1, 2026 – ongoing$/);
});

test('trades: keys and labels', () => {
  assert.equal(tradeKey('AC / HVAC'), 'ac_hvac');
  assert.equal(tradeKey('  Pool Service! '), 'pool_service');
  assert.equal(humanizeTrade('pest_control'), 'Pest Control');
});

test('projects overview: quoted from the chosen quote, actual from transactions, variance', () => {
  const rows = projectRows(
    [
      {
        id: 1, property_id: 7, property_address: '1205 NE 117th', project_name: 'Roof', description: 'Leak over unit A', status: 'open',
        trades: ['roofing'], rating: 4,
        quotes: [
          { vendor_name: 'Cheap Roof', quoted_cost: '3000', final_cost: null, is_selected: false },
          { vendor_name: 'Good Roof', vendor_phone: '305-555-0100', vendor_rating: 5, quoted_cost: '4500', final_cost: '4700', is_selected: true },
        ],
      },
      { id: 2, property_id: 7, property_address: '1205 NE 117th', project_name: null, description: 'From a transaction', status: 'received', quoted_cost: 250 },
    ],
    { 1: { actual_spend: 4800, transaction_count: 3 } },
  );
  assert.deepEqual(
    [rows[0]!.vendor, rows[0]!.vendorPhone, rows[0]!.quoted, rows[0]!.final, rows[0]!.actual, rows[0]!.variance, rows[0]!.txnCount, rows[0]!.quoteCount],
    ['Good Roof', '305-555-0100', 4500, 4700, 4800, 300, 3, 2],
  );
  // No project name: the description is the name; starting cost is the quote; no transactions → no variance.
  assert.deepEqual([rows[1]!.name, rows[1]!.description, rows[1]!.quoted, rows[1]!.variance, rows[1]!.vendor], ['From a transaction', null, 250, null, null]);
});

test('quotes: combining files into one quote', async () => {
  const { mergeQuotes } = await import('../lib/quote-merge');
  const q = (p: Partial<import('../lib/quote-merge').VendorQuoteExtracted>) => ({
    vendor_name: null, vendor_phone: null, vendor_email: null, trade: null, project_name: null, quoted_cost: null, scope_of_work: null, quote_date: null, confidence_notes: null, ...p,
  });
  const m = mergeQuotes([
    q({ vendor_name: 'Top Roof', quoted_cost: 12000, scope_of_work: 'Re-roof main house', trade: 'roofing' }),
    q({ vendor_phone: '305-555-0140', quoted_cost: 1800.5, scope_of_work: 'Addendum: replace fascia' }),
    q({ scope_of_work: 're-roof main house', confidence_notes: 'Page 3 blurry' }),
  ]);
  assert.equal(m.vendor_name, 'Top Roof');
  assert.equal(m.vendor_phone, '305-555-0140');
  assert.equal(m.trade, 'roofing');
  assert.equal(m.quoted_cost, 13800.5);
  assert.equal(m.scope_of_work, 'Re-roof main house\nAddendum: replace fascia');
  assert.match(m.confidence_notes!, /Combined from 3 files: the amount is the sum \(\$12,000 \+ \$1,800\.5\)/);
  assert.match(m.confidence_notes!, /Page 3 blurry/);
  assert.match(mergeQuotes([q({ vendor_name: 'A' }), q({ vendor_name: 'B' })]).confidence_notes!, /different vendors \(A, B\)/);
  assert.equal(mergeQuotes([q({}), q({})]).quoted_cost, null);
});
