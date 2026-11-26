// "Rent this month" is the same everywhere: due from the lease, every payment
// added up (a split payment is several rent_collections rows, each carrying
// the full rent as amount_due).
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { leaseForMonth, rentForMonth, sumRent } from '../lib/rentMonth.js';
import { getOverview } from '../services/overview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOV = ['2026-11-01', '2026-11-30'];

test('rentForMonth: split payments, no record, vacant, lease changes', () => {
  const leases = [
    { unit_id: 1, start_date: '2025-12-01', end_date: '2026-11-30', rent_amount: 2000 },
    { unit_id: 2, start_date: '2025-01-17', end_date: '2027-01-16', rent_amount: 2460 },
    { unit_id: 3, start_date: '2026-11-01', end_date: '2027-10-31', rent_amount: 2100 },
    { unit_id: 3, start_date: '2025-11-01', end_date: '2026-10-31', rent_amount: 1950 }, // last year's lease
  ];
  const rows = [
    { unit_id: 1, due_date: '2026-11-01', amount_due: 2000, amount_paid: 2000 },
    // Unit 2 paid in two parts: each row says $2,460 due.
    { unit_id: 2, due_date: '2026-11-01', amount_due: 2460, amount_paid: 433 },
    { unit_id: 2, due_date: '2026-11-01', amount_due: 2460, amount_paid: 2027 },
    { unit_id: 2, due_date: '2026-10-01', amount_due: 2460, amount_paid: 2460 }, // other month: ignored
  ];
  const m = rentForMonth({ unitIds: [1, 2, 3, 4], leases, rows, start: NOV[0], end: NOV[1], occupied: new Set([1, 2, 3]) });
  assert.deepEqual(m.get(1), { due: 2000, collected: 2000, outstanding: 0, payments: 1, status: 'paid' });
  assert.deepEqual(m.get(2), { due: 2460, collected: 2460, outstanding: 0, payments: 2, status: 'paid' });
  assert.deepEqual(m.get(3), { due: 2100, collected: 0, outstanding: 2100, payments: 0, status: 'no_record' });
  assert.deepEqual(m.get(4), { due: 0, collected: 0, outstanding: 0, payments: 0, status: 'none' }, 'vacant, nothing recorded');
  assert.deepEqual(sumRent(m), { due: 6560, collected: 4460, outstanding: 2100 });
  assert.equal(leaseForMonth(leases.filter((l) => l.unit_id === 3), ...NOV).rent_amount, 2100);
  // A partial payment.
  const p = rentForMonth({ unitIds: [2], leases, rows: rows.slice(1, 2), start: NOV[0], end: NOV[1] });
  assert.deepEqual(p.get(2), { due: 2460, collected: 433, outstanding: 2027, payments: 1, status: 'partial' });
});

test('overview: rent this month matches the rent roll (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    // The screenshots: 1205-1207 (2,000 + 2,100), 1821-1825 (2,100 + 2,100), 20-22 (20: 2,460; 22: you).
    const prop = async (address) => (await knex('owned_properties').insert({ address }).returning('id'))[0].id;
    const unit = async (property_id, unit_label, owner = false) => (await knex('units').insert({ property_id, unit_label, is_owner_unit: owner }).returning('id'))[0].id;
    const p1 = await prop('1205-1207 NE 117th St');
    const p2 = await prop('1821-1825 NW 74th St');
    const p3 = await prop('20-22 NW 119th St');
    const u = {
      1205: await unit(p1, '1205'), 1207: await unit(p1, '1207'),
      1821: await unit(p2, '1821'), 1825: await unit(p2, '1825'),
      20: await unit(p3, '20'), 22: await unit(p3, '22', true),
    };
    const rents = { 1205: 2000, 1207: 2100, 1821: 2100, 1825: 2100, 20: 2460 };
    for (const [label, rent] of Object.entries(rents)) {
      const [t] = await knex('tenants').insert({ unit_id: u[label], first_name: 'T', last_name: label }).returning('id');
      await knex('leases').insert({ tenant_id: t.id, unit_id: u[label], start_date: '2026-01-01', end_date: '2027-06-30', rent_amount: rent });
    }
    const pay = (label, amount_paid, n = 1) => ({ unit_id: u[label], due_date: '2026-11-01', amount_due: rents[label], amount_paid, paid_date: `2026-11-0${n}`, source: 'finance_upload' });
    // 1821 has no record; unit 20 paid in two parts.
    await knex('rent_collections').insert([pay(1205, 2000), pay(1207, 2100), pay(1825, 2100), pay(20, 433, 2), pay(20, 2027, 3)]);

    const o = await getOverview(knex, { month: '2026-11', today: '2026-11-26' });
    const re = o.real_estate;
    assert.equal(re.rent_roll, 10760);
    assert.deepEqual(re.rent_this_month, { due: 10760, collected: 8660, outstanding: 2100 }, 'due = rent roll; 1821 still owes');
    const row = (address) => o.properties.find((x) => x.address === address);
    assert.deepEqual([row('20-22 NW 119th St').rent_collected, row('20-22 NW 119th St').rent_due], [2460, 2460], 'unit 20 paid in full, not twice due');
    assert.deepEqual([row('1821-1825 NW 74th St').rent_collected, row('1821-1825 NW 74th St').rent_due], [2100, 4200], '1821 counts as due');
    assert.deepEqual([row('1205-1207 NE 117th St').rent_collected, row('1205-1207 NE 117th St').rent_due], [4100, 4100]);
  } finally {
    await knex.destroy();
  }
});
