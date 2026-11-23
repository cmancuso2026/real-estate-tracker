// Phase 6: per-property cash flow math, property-category mapping seed, and the
// combined Overview service against pg-mem.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { propertyCashFlow } from '../lib/cashflow.js';
import { matchProperty, roleFor, seedPropertyCategoryMap } from '../lib/propertyMap.js';
import { getOverview } from '../services/overview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');

test('per-property cash flow: mapped rent − mapped PITI − attributed expenses (fixture)', () => {
  const mappings = [
    { category: '1205 Rent', property_id: 2, role: 'income' },
    { category: '1207 Rent', property_id: 2, role: 'income' },
    { category: '1205 PITI', property_id: 2, role: 'piti' },
    { category: '20 Rent', property_id: 3, role: 'income' },
    { category: '20 PITI', property_id: 3, role: 'piti' },
    { category: '1821 Rent', property_id: null, role: 'income' }, // deliberately unmapped
  ];
  const t = (date, category, amount, property_id = null) => ({ date, category, amount, property_id });
  const txns = [
    // November (the month)
    t('2026-11-03', '1205 Rent', 1850),
    t('2026-11-03', '1207 Rent', 1800),
    t('2026-11-05', '1205 PITI', -2210.44),
    t('2026-11-10', 'Repairs', -400, 2), // attributed expense
    t('2026-11-12', 'Repairs', 50, 2), // refund reduces expenses
    t('2026-11-15', '1205 Rent', 25, 3), // mapped category wins over property_id
    t('2026-11-04', '20 Rent', 1650),
    t('2026-11-05', '20 PITI', -1490.12),
    t('2026-11-20', 'Lawn Care', -65, 3),
    t('2026-11-21', '1821 Rent', 1700), // unmapped on purpose → ignored
    t('2026-11-22', 'Groceries', -80), // not property-related → ignored
    // October (YTD only)
    t('2026-10-03', '1205 Rent', 1850),
    t('2026-10-05', '1205 PITI', -2210.44),
    // Outside YTD: previous year, and a later month
    t('2025-12-03', '1205 Rent', 1850),
    t('2026-12-03', '1205 Rent', 1850),
  ];
  const out = propertyCashFlow(txns, mappings, { month: '2026-11' });

  assert.deepEqual(out.get(2).month, { rent: 3675, piti: -2210.44, expenses: -350, net: 1114.56, count: 6 });
  assert.deepEqual(out.get(2).ytd, { rent: 5525, piti: -4420.88, expenses: -350, net: 754.12, count: 8 });
  assert.deepEqual(out.get(3).month, { rent: 1650, piti: -1490.12, expenses: -65, net: 94.88, count: 3 });
  assert.equal(out.has(1), false); // 1821's only category is unmapped
});

test('mapping seed: role from the name; a number must match exactly one property', () => {
  assert.equal(roleFor('1205 Rent'), 'income');
  assert.equal(roleFor('20 PITI'), 'piti');
  assert.equal(roleFor('1205 Mortgage'), 'piti');
  assert.equal(roleFor('1205 HOA'), 'expense');
  const props = [
    { id: 1, nums: ['1821', '1825'] },
    { id: 2, nums: ['1205', '1207'] },
    { id: 3, nums: ['20', '22'] },
  ];
  assert.equal(matchProperty('1207 Rent', props), 2);
  assert.equal(matchProperty('20 PITI', props), 3);
  assert.equal(matchProperty('Repairs', props), null);
  assert.equal(matchProperty('999 Rent', props), null);
  assert.equal(matchProperty('20 Rent', [...props, { id: 4, nums: ['20'] }]), null); // ambiguous
});

test('overview service (pg-mem)', async (t) => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
  await createTrackerStubs(knex);
  const [p1, p2, p3] = await knex('owned_properties')
    .insert([{ address: '1821-1825 NW 74th St' }, { address: '1205-1207 NE 117th St' }, { address: '20-22 NW 119th St' }])
    .returning('id')
    .then((r) => r.map((x) => x.id));
  const u = await knex('units')
    .insert([
      // every row sets is_owner_unit: pg-mem skips column defaults in mixed multi-row inserts
      { property_id: p1, unit_label: '1821', is_owner_unit: false }, { property_id: p1, unit_label: '1825', is_owner_unit: true },
      { property_id: p2, unit_label: '1205', is_owner_unit: false }, { property_id: p2, unit_label: '1207', is_owner_unit: false },
      { property_id: p3, unit_label: '20', is_owner_unit: false }, { property_id: p3, unit_label: '22', is_owner_unit: false },
    ])
    .returning(['id', 'unit_label']);
  const unit = (l) => u.find((x) => x.unit_label === l).id;
  // Migrations run after the properties exist, so migration 010 seeds the map.
  await knex.migrate.latest({ directory: MIGRATIONS });

    await t.test('seed maps the built-in per-property categories, unconfirmed', async () => {
      const rows = await knex('property_category_map').select('*').orderBy('category');
      assert.deepEqual(
        rows.map((r) => [r.category, r.property_id, r.role, r.confirmed]),
        [
          ['1205 PITI', p2, 'piti', false],
          ['1205 Rent', p2, 'income', false],
          ['1207 Rent', p2, 'income', false],
          ['20 PITI', p3, 'piti', false],
          ['20 Rent', p3, 'income', false],
        ],
      );
    });

    await t.test('re-seeding adds new categories only and never restores a removed mapping', async () => {
      await knex('property_category_map').where({ category: '20 PITI' }).update({ property_id: null }); // you unmapped it
      await knex('custom_categories').insert({ name: '1821 Rent', category_group: 'Investments' });
      const added = await seedPropertyCategoryMap(knex);
      assert.deepEqual(added.map((r) => [r.category, r.property_id]), [['1821 Rent', p1]]);
      assert.equal((await knex('property_category_map').where({ category: '20 PITI' }).first()).property_id, null);
      await knex('property_category_map').where({ category: '20 PITI' }).update({ property_id: p3 });
    });

    await t.test('overview numbers for a small fixture', async () => {
      // Tenants and leases: 1821 (rental) occupied; 1825 owner unit; 1205 + 1207 occupied; 20 occupied; 22 vacant.
      const tenant = async (unitLabel, first) =>
        (await knex('tenants').insert({ unit_id: unit(unitLabel), first_name: first, last_name: 'T' }).returning('id'))[0].id;
      const lease = (tid, unitLabel, start, end, rent) =>
        knex('leases').insert({ tenant_id: tid, unit_id: unit(unitLabel), start_date: start, end_date: end, rent_amount: rent });
      await lease(await tenant('1821', 'Ann'), '1821', '2026-01-01', '2026-12-31', 1700);
      const t1205 = await tenant('1205', 'Bo');
      await lease(t1205, '1205', '2025-01-01', '2025-12-31', 1750); // older lease
      await lease(t1205, '1205', '2026-01-01', '2026-12-15', 1850); // latest, ends within 60 days
      await lease(await tenant('1207', 'Cy'), '1207', '2026-03-01', '2027-02-28', 1800);
      await lease(await tenant('20', 'Di'), '20', '2026-06-01', '2027-05-31', 1650);
      await knex('rent_collections').insert([
        { unit_id: unit('1821'), due_date: '2026-11-01', amount_due: 1700, amount_paid: 1700 },
        { unit_id: unit('1205'), due_date: '2026-11-01', amount_due: 1850, amount_paid: 1000 },
        { unit_id: unit('1207'), due_date: '2026-11-01', amount_due: 1800, amount_paid: null },
        { unit_id: unit('20'), due_date: '2026-11-01', amount_due: 1650, amount_paid: 1650 },
        { unit_id: unit('20'), due_date: '2026-10-01', amount_due: 1650, amount_paid: 1650 }, // other month
      ]);
      await knex('insurance_policies').insert([
        { property_id: p2, carrier: 'Citizens', policy_type: 'landlord', effective_date: '2025-12-20', expiration_date: '2026-12-20' },
        { property_id: p3, carrier: 'Heritage', effective_date: '2026-06-01', expiration_date: '2027-06-01' },
      ]);
      const txn = (date, description, amount, category, extra = {}) => ({
        date, description, amount, category, category_group: 'Investments', source: 'Bank of America',
        dedup_hash: `${date}-${description}-${amount}`, ...extra,
      });
      await knex('transactions').insert([
        txn('2026-11-01', 'PAYROLL', 4200, 'Paycheck', { category_group: 'W2 Income' }),
        txn('2026-11-03', 'ZELLE 1205', 1850, '1205 Rent'),
        txn('2026-11-03', 'ZELLE 1207', 1800, '1207 Rent'),
        txn('2026-11-05', 'MTG 1205', -2210.44, '1205 PITI'),
        txn('2026-11-10', 'PLUMBER', -400, 'Repairs'),
        txn('2026-11-12', 'PUBLIX', -120, 'Groceries', { category_group: 'Food' }),
        txn('2026-10-03', 'ZELLE 1205', 1850, '1205 Rent'),
        txn('2026-10-12', 'PUBLIX', -80, 'Groceries', { category_group: 'Food' }),
      ]);
      // the plumber is attributed to 1205-1207 (100%)
      const plumber = await knex('transactions').where({ description: 'PLUMBER' }).first('id');
      await knex('transaction_allocations').insert({ transaction_id: plumber.id, property_id: p2, amount: -400, percent: 100, input_mode: 'percent' });
      await knex('upload_log').insert([
        { filename: 'boa-oct.csv', source: 'Bank of America', row_count: 3, new_rows: 3, skipped: 0 },
        { filename: 'boa-nov.csv', source: 'Bank of America', row_count: 6, new_rows: 5, skipped: 1 },
      ]);

      const o = await getOverview(knex, { month: '2026-11', today: '2026-11-22' });

      assert.deepEqual(o.finance.month, { income: 7850, spending: 2730.44, cash_flow: 5119.56, count: 6 });
      assert.deepEqual(o.finance.ytd, { income: 9700, spending: 2810.44, cash_flow: 6889.56, count: 8 });
      assert.deepEqual(o.finance.top_groups.month[0], { group: 'Investments', spending: 2610.44 });
      assert.equal(o.finance.latest_uploads[0].last_upload.filename, 'boa-nov.csv');
      assert.equal(o.finance.latest_uploads[0].data_through, '2026-11-12');

      const re = o.real_estate;
      assert.deepEqual([re.properties, re.units, re.rental_units, re.occupied_units, re.occupancy], [3, 6, 5, 4, 0.8]);
      assert.equal(re.rent_roll, 1700 + 1850 + 1800 + 1650); // latest leases only
      assert.deepEqual(re.rent_this_month, { due: 7000, collected: 4350, outstanding: 2650 });
      // within 60 days of Nov 22 (≤ Jan 21), soonest first; 1207 (Feb 28) and 20 (May 31) are later
      assert.deepEqual(re.expiring_leases.map((l) => [l.unit_label, l.end_date]), [['1205', '2026-12-15'], ['1821', '2026-12-31']]);
      assert.deepEqual(re.expiring_policies.map((p) => [p.carrier, p.expiration_date]), [['Citizens', '2026-12-20']]);

      const row = o.properties.find((p) => p.id === p2);
      assert.deepEqual([row.rental_units, row.occupied_units, row.scheduled_rent, row.rent_collected, row.rent_due], [2, 2, 3650, 1000, 3650]);
      assert.deepEqual(row.cash_flow.month, { rent: 3650, piti: -2210.44, expenses: -400, net: 1039.56, count: 4 });
      assert.deepEqual(row.cash_flow.ytd, { rent: 5500, piti: -2210.44, expenses: -400, net: 2889.56, count: 5 });
      assert.equal(o.properties.find((p) => p.id === p1).rental_units, 1); // owner unit excluded
      assert.deepEqual(o.mappings, { total: 6, unconfirmed: 6 });
    });
  } finally {
    await knex.destroy();
  }
});
