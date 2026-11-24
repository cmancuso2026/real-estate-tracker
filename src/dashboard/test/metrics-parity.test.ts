// Income / spending / cash flow: the landing page (getOverview), the summary
// API and the /finance cards and chart (client heroTotals / buildChart) must
// give the same numbers for the same month — one definition, in
// src/finance/lib/metrics.js.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from '../../finance/test/helpers/tracker-stubs.js';
import { getOverview } from '../../finance/services/overview.js';
import { getSummary } from '../../finance/services/summary.js';
import { getCategories } from '../../finance/services/categories.js';
import { listTransactions } from '../../finance/services/transactions.js';
import { getMetricsDefinition } from '../../finance/lib/metrics.js';
import { mapTxn, type ApiTxn, type Groups } from '../lib/finance-ui/types';
import { heroTotals } from '../lib/finance-ui/transactions';
import { buildChart } from '../lib/finance-ui/chart';
import { buildTaxonomy } from '../lib/finance-ui/taxonomy';
import { metricsContext } from '../lib/finance-ui/metrics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '..', '..', 'finance', 'db', 'migrations');

test('landing page, summary API and /finance agree for the same month', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    const [p] = await knex('owned_properties').insert({ address: '1205-1207 NE 117th St' }).returning('id');
    await knex('units').insert([{ property_id: p.id, unit_label: '1205', is_owner_unit: false }, { property_id: p.id, unit_label: '1207', is_owner_unit: false }]);
    await knex.migrate.latest({ directory: MIGRATIONS });
    await knex('property_category_map').where({ category: '1205 Rent' }).update({ property_id: p.id, role: 'income' });

    const row = (date: string, description: string, amount: number, category: string, group: string, source = 'Bank of America') => ({
      date, description, amount, category, category_group: group, source, dedup_hash: `${date}|${description}|${amount}`,
    });
    await knex('transactions').insert([
      row('2026-11-01', 'PAYROLL', 4200, 'Paycheck', 'W2 Income'),
      row('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent', 'Investments'),
      row('2026-11-05', 'AMERICAN EXPRESS PAYMENT', -2000, 'Amex', 'Financials'), // card payment out of checking
      row('2026-11-05', 'PAYMENT RECEIVED - THANK YOU', 2000, 'Amex', 'Financials', 'Amex Gold'), // the same payment on the card
      row('2026-11-06', 'PUBLIX', -100, 'Groceries', 'Food', 'Amex Gold'),
      row('2026-11-09', 'PUBLIX REFUND', 20, 'Groceries', 'Food', 'Amex Gold'), // a refund reduces spending
      row('2026-11-10', 'PLUMBER', -300, 'Repairs', 'Investments'),
      row('2026-11-12', 'IRS', -50, 'Taxes', 'W2 Income'), // money out of an income category reduces income (take-home)
      row('2026-11-14', 'MYSTERY DEPOSIT', 40, 'Uncategorized', 'Other'), // uncategorized deposits are income
      row('2026-11-30', 'VENMO PAYMENT', -75, 'Venmo', 'Other'), // Venmo counts as spending (017)
      row('2026-10-15', 'PUBLIX', -80, 'Groceries', 'Food', 'Amex Gold'), // October: outside the month
    ]);

    const venmo = await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', 'Venmo').first('g.name as group');
    assert.equal(venmo.group, 'Other', '017 moved Venmo out of Financials');
    const expected = { income: 6040, spending: 455, cash_flow: 5585 };

    // Landing page
    const o = await getOverview(knex, { month: '2026-11', today: '2026-11-23' });
    assert.deepEqual({ income: o.finance.month.income, spending: o.finance.month.spending, cash_flow: o.finance.month.cash_flow }, expected);
    assert.equal(o.finance.month.count, 8, '10 November rows, the two card-payment rows left out');
    assert.deepEqual(o.finance.top_groups.month, [{ group: 'Investments', spending: 300 }, { group: 'Food', spending: 80 }, { group: 'Other', spending: 75 }], 'W2 Income is never a spending group');

    // Summary API
    const s = await getSummary(knex, { year: '2026', months: '11' });
    assert.deepEqual({ income: s.income, spending: s.spending, cash_flow: s.cash_flow }, expected);
    assert.deepEqual(s.by_month['2026-11'], { income: 6040, spending: 455 });
    assert.equal(s.transfers, 0, 'the Amex payment out and its credit on the card net to zero');

    // /finance: the browser's rows, taxonomy and definition, November selected
    const cats = await getCategories(knex);
    const def = await getMetricsDefinition(knex);
    const tax = buildTaxonomy(cats.groups as Groups, cats.cat_to_group as Record<string, string>);
    const ctx = metricsContext(tax.catToGroup, def.income_categories);
    const { transactions } = await listTransactions(knex, { limit: '100000' });
    const nov = (transactions as ApiTxn[]).map(mapTxn).filter((t) => t.date.startsWith('2026-11'));
    const hero = heroTotals(nov, ctx);
    assert.deepEqual({ income: hero.income, spending: hero.spend, cash_flow: hero.flow }, expected);
    assert.equal(hero.transferCount, 2);

    // …and the chart's November bars
    const model = buildChart(nov, tax, '', '', 'monthly', ctx)!;
    const i = model.keys.indexOf('2026-11');
    assert.deepEqual([model.series[0]!.data[i], model.series[1]!.data[i]], [6040, 455]);
  } finally {
    await knex.destroy();
  }
});

test('a "Transfer" category is netted out wherever it sits (e.g. in W2 Income)', async () => {
  const { categoryKind, financeTotals, metricsContext } = await import('../../finance/lib/metrics.js');
  const ctx = metricsContext({ Paycheck: 'W2 Income', Transfer: 'W2 Income', Groceries: 'Food', 'Transfers out': 'Other' }, []);
  assert.equal(categoryKind('Transfer', ctx), 'transfer');
  assert.equal(categoryKind('Transfers out', ctx), 'transfer');
  assert.equal(categoryKind('Paycheck', ctx), 'income');
  const t = financeTotals(
    [
      { amount: 4000, category: 'Paycheck' },
      { amount: 2500, category: 'Transfer' }, // ONLINE BANKING TRANSFER in
      { amount: -2500, category: 'Transfer' }, // … and out
      { amount: -300, category: 'Transfer' }, // OVERDRAFT PROTECTION TO
      { amount: -100, category: 'Groceries' },
    ],
    ctx,
  );
  assert.deepEqual([t.income, t.spending, t.cash_flow, t.transfer_count], [4000, 100, 3900, 3]);
});
