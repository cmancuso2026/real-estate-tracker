// The Overview's Sankey: same numbers as the KPI cards (shared definition).
import test from 'node:test';
import assert from 'node:assert';

import { buildSankey, SAVED, SHORTFALL, TOTAL } from '../lib/finance-ui/sankey';
import { heroTotals } from '../lib/finance-ui/transactions';
import { buildTaxonomy } from '../lib/finance-ui/taxonomy';
import { metricsContext } from '../lib/finance-ui/metrics';
import type { Txn } from '../lib/finance-ui/types';

const tax = buildTaxonomy({
  'W2 Income': ['Paycheck', 'Taxes'],
  Investments: ['1205 Rent', 'Repairs', '1205 PITI'],
  Food: ['Groceries', 'Eating Out'],
  Financials: ['Amex'],
  Other: ['Other', 'Uncategorized'],
});
const ctx = metricsContext(tax.catToGroup, ['1205 Rent']);
let id = 1;
const tx = (amt: number, cat: string): Txn => ({
  id: id++, date: '2026-11-05', desc: cat, src: 'Bank of America', amt, cat, manual: false, cleared: false, note: '',
  propertyId: null, workOrderId: null, unitId: null, allocations: [], fullyAllocated: false, unallocated: null,
});
const sum = (xs: number[]) => Math.round(xs.reduce((s, v) => s + v, 0) * 100) / 100;

test('sankey: income sources → Total Income → groups → categories, saved = cash flow', () => {
  const rows = [
    tx(4200, 'Paycheck'), tx(1850, '1205 Rent'), tx(-2000, 'Amex'), tx(2000, 'Amex'),
    tx(-100, 'Groceries'), tx(20, 'Groceries'), tx(-60, 'Eating Out'), tx(-2210.44, '1205 PITI'), tx(-300, 'Repairs'), tx(-50, 'Taxes'),
  ];
  const m = buildSankey(rows, tax, ctx)!;
  const hero = heroTotals(rows, ctx);
  assert.equal(m.income, hero.income);
  assert.equal(m.spending, hero.spend);
  assert.equal(sum(m.flows.filter((f) => f.to === TOTAL).map((f) => f.flow)), hero.income, 'flows into Total Income = Income card');
  const toGroups = m.flows.filter((f) => f.from === TOTAL && f.to.startsWith('grp:'));
  assert.equal(sum(toGroups.map((f) => f.flow)), hero.spend, 'flows to spending groups = Spending card');
  assert.equal(m.flows.find((f) => f.to === SAVED)!.flow, hero.flow, 'Saved = Cash flow card');
  assert.deepEqual(m.flows.find((f) => f.to === 'cat:Groceries'), { from: 'grp:Food', to: 'cat:Groceries', flow: 80 }, 'refund netted');
  assert.equal(m.flows.some((f) => f.from.includes('Amex') || f.to.includes('Amex')), false, 'transfers left out');
  assert.equal(m.labels['grp:Other'], undefined);
  assert.equal(m.labels['cat:Taxes'], 'Taxes');
});

test('sankey: spending above income shows a Shortfall feeding Total Income', () => {
  const m = buildSankey([tx(1000, 'Paycheck'), tx(-1500, 'Repairs')], tax, ctx)!;
  assert.deepEqual(m.flows.find((f) => f.from === SHORTFALL), { from: SHORTFALL, to: TOTAL, flow: 500 });
  assert.equal(m.flows.some((f) => f.to === SAVED), false);
  assert.equal(buildSankey([tx(2000, 'Amex')], tax, ctx), null, 'only transfers → nothing to draw');
});

test('sankey zoom: one group → its categories → biggest merchants; transfers listed separately', async () => {
  const { buildGroupSankey, transfersLeftOut, merchantLabel } = await import('../lib/finance-ui/sankey');
  const row = (amt: number, cat: string, desc: string): Txn => ({ ...tx(amt, cat), desc });
  const rows = [
    row(-100, 'Groceries', 'PUBLIX #1234 MIAMI'), row(-50, 'Groceries', 'PUBLIX #99 MIAMI'), row(20, 'Groceries', 'PUBLIX REFUND'),
    row(-60, 'Eating Out', 'CHIPOTLE 2231'), row(-2000, 'Amex', 'AMEX PAYMENT'), row(2000, 'Amex', 'PAYMENT THANK YOU'), row(-1500, 'Repairs', 'PLUMBER'),
  ];
  assert.equal(merchantLabel('PUBLIX #1234 MIAMI'), 'PUBLIX MIAMI');
  const m = buildGroupSankey(rows, tax, ctx, 'Food')!;
  assert.equal(m.spending, 190, 'same net as the cards: 150 + 60 − 20 refund');
  assert.deepEqual(m.flows.filter((f) => f.from === 'grp:Food').map((f) => [f.to, f.flow]), [['cat:Groceries', 130], ['cat:Eating Out', 60]]);
  const groceryMerchants = m.flows.filter((f) => f.from === 'cat:Groceries');
  assert.equal(sum(groceryMerchants.map((f) => f.flow)), 130, 'merchant flows balance their category');
  assert.deepEqual(transfersLeftOut(rows, ctx), [{ cat: 'Amex', count: 2, out: 2000, in: 2000 }]);
});
