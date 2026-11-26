// Unit tests for the finance UI logic ported from the old single-page app
// (src/dashboard/lib/finance-ui). The full side-by-side comparison with the old
// page was run in a browser; these pin the rules most likely to regress.
import test from 'node:test';
import assert from 'node:assert';
import { buildChart, getBucketKey } from '../lib/finance-ui/chart';
import { balancesByBucket, bucketRange } from '../lib/finance-ui/cash';
import { buildCategoryTable } from '../lib/finance-ui/categoryTable';
import { fmt, fmtShort } from '../lib/finance-ui/format';
import { defaultMonthSelection, defaultYearSelection, propertyOfCat } from '../lib/finance-ui/period';
import { computeDiscrepancies, merchantKey } from '../lib/finance-ui/review';
import { buildTaxonomy } from '../lib/finance-ui/taxonomy';
import { applyGlobalFilters, EMPTY_FILTERS } from '../lib/finance-ui/filters';
import { heroTotals, nextSort } from '../lib/finance-ui/transactions';
import type { PropertyGroup, Txn } from '../lib/finance-ui/types';

const tax = buildTaxonomy({
  Food: ['Eating Out', 'Groceries'],
  Investments: ['1205 Rent', '1207 Rent', 'Repairs'],
  Living: ['Shopping'],
  'W2 Income': ['Paycheck'],
  Other: ['Uncategorized'],
});
const props: PropertyGroup[] = [{ id: 7, name: '1205-1207 NE 117th St', units: ['1205', '1207'], categories: ['1205 Rent', '1207 Rent'] }];
let nextId = 1;
const tx = (date: string, desc: string, amt: number, cat: string, extra: Partial<Txn> = {}): Txn => ({
  id: nextId++, date, desc, src: 'Amex Gold', amt, cat, manual: false, cleared: false, note: '',
  propertyId: null, workOrderId: null, unitId: null, allocations: [], fullyAllocated: false, unallocated: null, ...extra,
});

test('money formatting matches the old page', () => {
  assert.equal(fmt(1234.5), '+$1,234.50');
  assert.equal(fmt(-0.5), '-$0.50');
  assert.equal(fmtShort(-1250), '-$1.3k');
  assert.equal(fmtShort(950), '+$950');
});

test('default period: current year; current + prior two months, wrapping past January', () => {
  const jan = new Date(2026, 0, 15);
  assert.deepEqual(defaultYearSelection(['2026', '2025'], jan), ['2026']);
  assert.deepEqual(defaultYearSelection(['2025'], jan), ['2025']); // falls back to all
  assert.deepEqual(defaultMonthSelection(['1', '4', '11', '12'], jan), ['1', '12', '11']);
  assert.deepEqual(defaultMonthSelection(['5', '6'], jan), ['5', '6']); // none present → all
});

test('taxonomy keeps the API order; archived categories keep their group', () => {
  const t2 = buildTaxonomy({ Food: ['Groceries', 'Eating Out'], Other: ['Uncategorized'] }, { Gym: 'Living', Groceries: 'Food' });
  assert.deepEqual(Object.keys(t2.groups), ['Food', 'Other']);
  assert.deepEqual(t2.groups.Food, ['Groceries', 'Eating Out']); // Admin order, not re-sorted
  assert.equal(t2.catToGroup.Gym, 'Living'); // archived (not in groups) still resolves
  assert.deepEqual(t2.allSubcats, ['Eating Out', 'Groceries', 'Uncategorized']);
});

test('mapped categories roll up to their property', () => {
  assert.equal(propertyOfCat('1207 Rent', props)?.id, 7);
  assert.equal(propertyOfCat('Repairs', props), null);
  assert.equal(propertyOfCat('20 Rent', props), null);
});

test('weekly buckets start on Sunday', () => {
  assert.equal(getBucketKey('2026-11-19', 'weekly'), '2026-11-15'); // Thu → Sun
  assert.equal(getBucketKey('2026-11-19', 'monthly'), '2026-11');
});

test('chart: property net view plots Rent / Costs / Net', () => {
  const rows = [tx('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent'), tx('2026-11-05', 'MTG', -2000, '1207 Rent')];
  const m = buildChart(rows, tax, '', 'prop:7', 'monthly')!;
  assert.deepEqual(m.series.map((s) => [s.label, s.data]), [['Rent', [1850]], ['Costs', [2000]], ['Net', [-150]]]);
});

test('spending table: property rows nest under their group; net total adds up', () => {
  const rows = [
    tx('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent'),
    tx('2026-11-04', 'PLUMBER', -400, 'Repairs', { note: 'water heater' }),
    tx('2026-11-06', 'PUBLIX', -60, 'Groceries'),
  ];
  const t = buildCategoryTable(rows, rows, tax, props, 'aggregate', '');
  const inv = t.groups.find((g) => g.group === 'Investments')!;
  assert.equal(inv.props[0]!.prop.id, 7);
  assert.deepEqual(inv.standalone.map((r) => r.cat), ['Repairs']);
  assert.match(inv.standalone[0]!.cells[0]!.note, /water heater/);
  assert.equal(t.totals[0], 1850 - 400 - 60);
});

test('review flags: split merchant + odd group; cleared rows are never flagged', () => {
  assert.equal(merchantKey('ZELLE TO JOHN SMITH 123'), 'JOHN SMITH');
  const a = tx('2026-11-01', 'STARBUCKS STORE 99', -5, 'Eating Out');
  const b = tx('2026-11-02', 'STARBUCKS STORE 99', -6, 'Shopping');
  const c = tx('2026-11-03', 'STARBUCKS STORE 99', -7, 'Shopping', { cleared: true });
  const d = computeDiscrepancies([a, b, c], tax);
  assert.deepEqual(d.flags.get(a.id)!.map((r) => r.type), ['inconsistent']);
  assert.deepEqual(d.flags.get(b.id)!.map((r) => r.type), ['inconsistent', 'oddgroup']);
  assert.equal(d.flags.has(c.id), false);
});

test('global filters: group, category, property roll-up, source, search', () => {
  const rent = tx('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent', { src: 'Bank of America' });
  const repair = tx('2026-11-04', 'PLUMBER', -400, 'Repairs');
  const food = tx('2026-11-06', 'PUBLIX', -60, 'Groceries');
  const rows = [rent, repair, food];
  const ids = (f: Partial<typeof EMPTY_FILTERS>) => applyGlobalFilters(rows, { ...EMPTY_FILTERS, ...f }, tax, props).map((t) => t.id);
  assert.deepEqual(ids({}), [rent.id, repair.id, food.id]);
  assert.deepEqual(ids({ group: 'Investments' }), [rent.id, repair.id]);
  assert.deepEqual(ids({ category: 'Repairs' }), [repair.id]);
  assert.deepEqual(ids({ category: 'prop:7' }), [rent.id]); // unit categories of property 7
  assert.deepEqual(ids({ source: 'Bank of America' }), [rent.id]);
  assert.deepEqual(ids({ search: 'groc' }), [food.id]); // search matches category too
  assert.deepEqual(ids({ search: 'BANK OF' }), [rent.id]); // …and source
});

test('sorting defaults, KPI totals', () => {
  const rows = [tx('2026-11-01', 'PUBLIX', -60, 'Groceries'), tx('2026-11-15', 'PAYROLL', 4000, 'Paycheck')];
  assert.deepEqual(nextSort({ key: 'date', dir: 'desc' }, 'amt'), { key: 'amt', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'date', dir: 'desc' }, 'desc'), { key: 'desc', dir: 'asc' });
  assert.deepEqual(heroTotals(rows), { income: 4000, spend: 60, flow: 3940, paychecks: 1, expenseCount: 1, transfers: 0, transferCount: 0 });
});

test('categories: assigned shares sit under their property, income first, the rest stays in the category', () => {
  const props2: PropertyGroup[] = [
    { id: 7, name: '1205-1207 NE 117th St', units: ['1205', '1207'], categories: ['1205 Rent'] },
    { id: 9, name: '1821-1825 NW 74th St', units: ['1821'], categories: [] },
  ];
  const alloc = (property_id: number, amount: number) => ({ property_id, unit_id: null, work_order_id: null, amount, percent: null, input_mode: 'amount' as const });
  const rows = [
    tx('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent'),
    tx('2026-11-04', 'PLUMBER', -300, 'Repairs', { allocations: [alloc(7, -300)], fullyAllocated: true }),
    tx('2026-11-05', 'HOME DEPOT', -100, 'Repairs', { allocations: [alloc(7, -60), alloc(9, -20)] }), // $20 not assigned yet
    tx('2026-11-06', 'HANDYMAN', -50, 'Repairs'),
  ];
  const t = buildCategoryTable(rows, rows, tax, props2, 'aggregate', '');
  const inv = t.groups.find((g) => g.group === 'Investments')!;
  assert.equal(inv.cells[0]!.v, 1400, 'group total unchanged by where shares sit');
  const p7 = inv.props.find((p) => p.prop.id === 7)!;
  assert.deepEqual(p7.cats.map((r) => [r.cat, r.side, r.cells[0]!.v]), [['1205 Rent', 'income', 1850], ['Repairs', 'expense', -360]]);
  assert.equal(p7.cells[0]!.v, 1490);
  const p9 = inv.props.find((p) => p.prop.id === 9)!;
  assert.deepEqual(p9.cats.map((r) => [r.cat, r.cells[0]!.v]), [['Repairs', -20]]);
  assert.deepEqual(inv.standalone.map((r) => [r.cat, r.cells[0]!.v]), [['Repairs', -70]], 'handyman + the unassigned $20');
});

test('exclude investments: Investments group, property-mapped categories and anything assigned to a property', async () => {
  const { withoutInvestments } = await import('../lib/finance-ui/filters');
  const props2: PropertyGroup[] = [{ id: 7, name: '1205-1207 NE 117th St', units: [], categories: ['1205 Rent', 'Figure Lending'] }];
  const rows = [
    tx('2026-11-01', 'PAYROLL', 4000, 'Paycheck'),
    tx('2026-11-03', 'ZELLE', 1850, '1205 Rent'),
    tx('2026-11-04', 'PLUMBER', -300, 'Repairs'),
    tx('2026-11-05', 'FIGURE', -1210, 'Figure Lending'),
    tx('2026-11-06', 'FPL', -150, 'Shopping', { allocations: [{ property_id: 7, unit_id: null, work_order_id: null, amount: -150, percent: 100, input_mode: 'percent' }] }),
    tx('2026-11-07', 'PUBLIX', -80, 'Groceries'),
  ];
  assert.deepEqual(withoutInvestments(rows, tax, props2).map((t) => t.desc), ['PAYROLL', 'PUBLIX']);
});

test('card payments are netted out of the Categories table and the Transactions summary', async () => {
  const { summaryBar } = await import('../lib/finance-ui/transactions');
  const { metricsContext } = await import('../lib/finance-ui/metrics');
  const { categoryKind } = await import('../../finance/lib/metrics.js');
  const tax2 = buildTaxonomy({ 'W2 Income': ['Paycheck'], Food: ['Groceries'], Financials: ['Amex'] });
  const ctx = metricsContext(tax2.catToGroup, []);
  const rows = [
    tx('2026-11-01', 'PAYROLL', 4000, 'Paycheck'),
    tx('2026-11-05', 'PUBLIX', -100, 'Groceries'),
    tx('2026-11-20', 'AMEX PAYMENT', -100, 'Amex'),
    tx('2026-11-21', 'PAYMENT THANK YOU', 100, 'Amex'),
  ];
  const t = buildCategoryTable(rows, rows, tax2, [], 'aggregate', '', (c) => categoryKind(c, ctx) === 'transfer');
  assert.deepEqual(t.groups.map((g) => g.group), ['W2 Income', 'Food']);
  assert.deepEqual(t.totals, [3900]);
  const s = summaryBar(rows, ctx);
  assert.deepEqual([s.income, s.expenses, s.count], [4000, -100, 4]);
});

test('cash position: balance at the end of each chart bucket', () => {
  assert.deepEqual(bucketRange('2026-02', 'monthly'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(bucketRange('2026-10-25', 'weekly'), { start: '2026-10-25', end: '2026-10-31' });
  const pts = [
    { date: '2026-09-30', balance: 100 },
    { date: '2026-10-06', balance: 50 },
    { date: '2026-10-31', balance: 80 },
    { date: '2026-11-23', balance: 120 },
  ];
  // Aug: before any balance → gap. Nov: latest so far. Dec: after the latest → gap.
  assert.deepEqual(balancesByBucket(pts, ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'], 'monthly'), [null, 100, 80, 120, null]);
  // Weeks start Sunday: Oct 4–10 ends on the Oct 6 balance; Nov 22–28 holds Nov 23.
  assert.deepEqual(balancesByBucket(pts, ['2026-10-04', '2026-11-22'], 'weekly'), [50, 120]);
  assert.deepEqual(balancesByBucket(pts, ['2026-10-07'], 'daily'), [50]);
});
