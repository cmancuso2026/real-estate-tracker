// Rent payments from finance transactions → rent_collections (lib/rentSync.js),
// with the matching rules carried over from the old Import Rent page.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { assignMonth, checkLate, extractZelleName, isHousingAuthority, matchScore, paymentFlags } from '../lib/rentMatch.js';
import { assignRentUnit, rentNeedingUnit, rentUnitOptions, syncRent } from '../lib/rentSync.js';
import { setCategory } from '../services/transactions.js';
import { rentBackfill } from '../services/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');

test('rent matching rules (same as Import Rent)', () => {
  assert.equal(extractZelleName('Zelle payment from SAMUEL PEREZ MARTINEZ Conf# xe14ougde'), 'SAMUEL PEREZ MARTINEZ');
  assert.equal(extractZelleName('Zelle payment from ANA RUIZ'), 'ANA RUIZ');
  assert.ok(isHousingAuthority('MIAMI-DADE PHCD DES:HAP PMT'));
  const t = { first_name: 'Samuel', last_name: 'Perez' };
  assert.equal(matchScore('SAMUEL PEREZ', t), 100);
  assert.equal(matchScore('SAMUEL PEREZ MARTINEZ', t), 95);
  assert.equal(matchScore('J PEREZ', t), 70);
  assert.equal(matchScore('NOBODY', t), 0);
  // last 5 days of a month → next month's rent
  assert.deepEqual(assignMonth('2026-10-28'), { assignedMonth: '2026-11', dueDate: '2026-11-01', isEarly: true });
  assert.deepEqual(assignMonth('12/29/2026'), { assignedMonth: '2027-01', dueDate: '2027-01-01', isEarly: true });
  assert.deepEqual(assignMonth('2026-11-03'), { assignedMonth: '2026-11', dueDate: '2026-11-01', isEarly: false });
  assert.equal(checkLate('2026-11-06', '2026-11-01', 5), false);
  assert.equal(checkLate('2026-11-07', '2026-11-01', 5), true);
  const lease = { rent_amount: 1800, late_fee_amount: 50, late_fee_grace_days: 5 };
  assert.equal(paymentFlags('2026-11-09', 1850, lease).lateFeeIncluded, true);
  assert.equal(paymentFlags('2026-11-09', 1800, lease).lateFeeApplicable, true);
});

test('rent sync: create, match, already recorded, needs a unit, recategorize away, re-upload', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    const [duplex, single] = (await knex('owned_properties').insert([{ address: '1205-1207 NE 117th St' }, { address: '20 NW 119th St' }]).returning('id')).map((r) => r.id);
    const [u1205, u1207, u20] = (
      await knex('units')
        .insert([
          { property_id: duplex, unit_label: '1205', is_owner_unit: false },
          { property_id: duplex, unit_label: '1207', is_owner_unit: false },
          { property_id: single, unit_label: '20', is_owner_unit: false },
        ])
        .returning('id')
    ).map((r) => r.id);
    const [tA, tB, tC] = (
      await knex('tenants')
        .insert([
          { unit_id: u1205, first_name: 'Ana', last_name: 'Ruiz', is_active: true },
          { unit_id: u1207, first_name: 'Samuel', last_name: 'Perez', is_active: true },
          { unit_id: u20, first_name: 'Joe', last_name: 'Bloggs', is_active: true },
        ])
        .returning('id')
    ).map((r) => r.id);
    const [l1205, l1207, l20] = (
      await knex('leases')
        .insert([
          { tenant_id: tA, unit_id: u1205, start_date: '2026-01-01', end_date: '2026-12-31', rent_amount: 1850, late_fee_amount: 50, late_fee_grace_days: 5 },
          { tenant_id: tB, unit_id: u1207, start_date: '2026-01-01', end_date: '2026-12-31', rent_amount: 1800, late_fee_amount: 50, late_fee_grace_days: 5 },
          { tenant_id: tC, unit_id: u20, start_date: '2026-01-01', end_date: '2026-12-31', rent_amount: 1650, late_fee_amount: 50, late_fee_grace_days: 5 },
        ])
        .returning('id')
    ).map((r) => r.id);
    await knex.migrate.latest({ directory: MIGRATIONS });
    await knex('property_category_map').insert([
      { category: 'Duplex Rent', property_id: duplex, role: 'income', confirmed: true },
    ]);
    await knex('property_category_map').where({ category: '1205 Rent' }).update({ property_id: duplex, role: 'income' });
    await knex('property_category_map').where({ category: '20 Rent' }).update({ property_id: single, role: 'income' });

    const txn = (description, amount, category, date = '2026-11-03', extra = {}) => ({
      date, description, amount, source: 'Bank of America', category, category_group: 'Investments', is_manual: false, dedup_hash: `${description}|${date}|${amount}`, ...extra,
    });
    const ids = (
      await knex('transactions')
        .insert([
          txn('Zelle payment from SAMUEL PEREZ Conf# abc', 1800, '1205 Rent'), // name beats the category → 1207
          txn('Zelle payment from SOMEONE ELSE Conf# def', 1850, 'Duplex Rent'), // no name match → amount → 1205
          txn('MIAMI-DADE PHCD DES:HAP PMT', 950, 'Duplex Rent'), // no name, no amount → needs a unit
          txn('Zelle payment from JOE BLOGGS', 1650, '20 Rent', '2026-11-08'), // single unit; late
          txn('Zelle payment from JOE BLOGGS', 1650, '20 Rent', '2026-10-03'), // entered by hand already
          txn('WHOLE FOODS', -80, 'Groceries', '2026-11-03', { category_group: 'Food' }),
          txn('Zelle payment from ANA RUIZ', 1850, '1205 Rent', '2026-09-04'), // entered by hand on 09-02
        ])
        .returning('id')
    ).map((r) => r.id);
    const [samuel, other, phcd, joeNov, joeOct, groceries, anaSep] = ids;
    // the same payment typed in by hand, two days earlier than the bank date
    await knex('rent_collections').insert({ unit_id: u1205, lease_id: l1205, due_date: '2026-09-01', amount_due: 1850, paid_date: '2026-09-02', amount_paid: 1850, source: 'manual' });
    await knex('rent_collections').insert({ unit_id: u20, lease_id: l20, due_date: '2026-10-01', amount_due: 1650, paid_date: '10/03/2026', amount_paid: 1650, source: 'csv_import' });

    // Admin → Rent from uploads: the preview (GET) writes nothing
    const preview = await rentBackfill(knex, { dry_run: true });
    assert.deepEqual(
      { created: preview.created, already: preview.already_recorded, unmatched: preview.unmatched.map((u) => u.id) },
      { created: 3, already: 2, unmatched: [phcd] },
    );
    assert.equal(await knex('rent_collections').where({ source: 'finance_upload' }).count({ c: '*' }).first().then((r) => Number(r.c)), 0, 'dry run writes nothing');

    // …Apply writes and logs it in the change log
    const applied = await rentBackfill(knex, {});
    assert.equal(applied.created, 3);
    assert.match((await knex('admin_audit').where({ action: 'rent.backfill' }).first()).summary, /3 created/);
    const rows = await knex('rent_collections').where({ source: 'finance_upload' }).orderBy('transaction_id');
    const by = new Map(rows.map((r) => [r.transaction_id, r]));
    assert.equal(by.get(samuel).unit_id, u1207);
    assert.equal(by.get(samuel).lease_id, l1207);
    assert.equal(by.get(other).unit_id, u1205);
    assert.equal(by.get(joeNov).unit_id, u20);
    assert.equal(by.get(joeNov).is_late, true);
    assert.equal(by.get(joeNov).late_fee_applicable, true);
    assert.equal(by.get(joeNov).due_date, '2026-11-01');
    assert.equal(by.get(joeNov).paid_date, '2026-11-08');
    assert.equal(by.has(joeOct), false, 'the csv_import row already covers it');
    assert.equal(by.has(anaSep), false, 'a hand-entered row within 7 days covers it (dates arrive as Date objects, as in the app)');
    assert.equal((await knex('rent_collections').where({ source: 'csv_import' }).first()).transaction_id, null, 'old rows untouched');

    // Idempotent.
    const again = await syncRent(knex);
    assert.deepEqual([again.created, again.updated, again.removed], [0, 0, 0]);

    // Needs a unit → pick one.
    assert.deepEqual((await rentNeedingUnit(knex)).map((r) => r.id), [phcd]);
    assert.deepEqual((await rentUnitOptions(knex, phcd)).map((u) => u.unit_label), ['1205', '1207']);
    await assert.rejects(assignRentUnit(knex, phcd, { unit_id: u20 }), /isn't part of this payment's property/);
    await assignRentUnit(knex, phcd, { unit_id: u1207 });
    assert.deepEqual(await rentNeedingUnit(knex), []);
    await syncRent(knex);
    assert.equal((await knex('rent_collections').where({ transaction_id: phcd }).first()).unit_id, u1207, 'your pick survives a sync');

    // A category change through the API syncs that row: away from rent → removed; into rent → created.
    await setCategory(knex, { id: String(joeNov) }, { category: 'Other' });
    assert.equal(await knex('rent_collections').where({ transaction_id: joeNov }).first(), undefined);
    await setCategory(knex, { id: String(joeNov) }, { category: '20 Rent', property_id: single });
    assert.equal((await knex('rent_collections').where({ transaction_id: joeNov }).first()).unit_id, u20);
    await setCategory(knex, { id: String(groceries) }, { category: 'Shopping' });
    assert.equal(await knex('rent_collections').where({ transaction_id: groceries }).first(), undefined, 'spending never becomes rent');

    // Deleting a transaction unlinks its row; uploading the same bank row again relinks it.
    const rentId = (await knex('rent_collections').where({ transaction_id: samuel }).first()).id;
    const row = await knex('transactions').where({ id: samuel }).first();
    await knex('transactions').where({ id: samuel }).del();
    assert.equal((await knex('rent_collections').where({ id: rentId }).first()).transaction_id, null);
    const { id: _old, ...rest } = row;
    const [{ id: back }] = await knex('transactions').insert(rest).returning('id');
    const re = await syncRent(knex, [back]);
    assert.equal(re.relinked, 1);
    assert.equal((await knex('rent_collections').where({ id: rentId }).first()).transaction_id, back);
    assert.equal(await knex('rent_collections').where({ source: 'finance_upload' }).count({ c: '*' }).first().then((r) => Number(r.c)), 4);
    void l1205;
  } finally {
    await knex.destroy();
  }
});
