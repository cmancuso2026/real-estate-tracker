// Splitting transactions across properties (transaction_allocations): the
// math, the migration from transactions.property_id, the API, the queue,
// re-uploads, and the roll-ups. Run under tsx (uses the real route handlers).
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { startRouteServer } from './helpers/finance-api-server.js';
import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { setFinanceDb } from '../../dashboard/lib/finance.ts';
import { computeAllocations, evenPercents } from '../lib/allocations.js';
import { getOverview } from '../services/overview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');
const amounts = (rows) => rows.map((r) => r.amount);

test('split math: percent and dollar modes, cents rounding, rejects unbalanced', () => {
  // $100 three ways: the last row takes the rounding remainder.
  assert.deepEqual(amounts(computeAllocations(-100, 'percent', [{ property_id: 1, value: 33.333 }, { property_id: 2, value: 33.333 }, { property_id: 3, value: 33.334 }])), [-33.33, -33.33, -33.34]);
  assert.deepEqual(evenPercents(3), [33.333, 33.333, 33.334]);
  assert.deepEqual(amounts(computeAllocations(-100.01, 'percent', evenPercents(3).map((v, i) => ({ property_id: i + 1, value: v })))), [-33.34, -33.34, -33.33]);
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + r.amount * 100, 0));
  for (const total of [-0.07, -19.99, -1234.57, 250]) {
    const rows = computeAllocations(total, 'percent', [{ property_id: 1, value: 70 }, { property_id: 2, value: 30 }]);
    assert.equal(sum(rows), Math.round(total * 100), `${total} splits to the cent`);
  }
  // Dollar mode: values typed positive take the transaction's sign; percent is not stored.
  const d = computeAllocations(-250, 'amount', [{ property_id: 1, value: 200 }, { property_id: 2, value: 50 }]);
  assert.deepEqual(d.map((r) => [r.amount, r.percent, r.input_mode]), [[-200, null, 'amount'], [-50, null, 'amount']]);
  // Unbalanced
  assert.throws(() => computeAllocations(-100, 'percent', [{ property_id: 1, value: 60 }, { property_id: 2, value: 30 }]), /add up to 100% \(they add up to 90%\)/);
  assert.throws(() => computeAllocations(-100, 'amount', [{ property_id: 1, value: 60 }, { property_id: 2, value: 30 }]), /\$10\.00 unallocated/);
  assert.throws(() => computeAllocations(-100, 'amount', [{ property_id: 1, value: 60 }, { property_id: 2, value: 50 }]), /\$10\.00 too much/);
  assert.throws(() => computeAllocations(-100, 'percent', [{ property_id: 1, value: 100 }, { property_id: 2, value: 0 }]), /above zero/);
  assert.throws(() => computeAllocations(-100, 'ratio', [{ property_id: 1, value: 100 }]), /mode must be one of/);
});

test('migration: existing single attributions become 100% allocations; the later drop works', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    const cfg = { directory: MIGRATIONS };
    // up to 012: transactions still has property_id
    for (let i = 0; i < 12; i += 1) await knex.migrate.up(cfg);
    const [p] = await knex('owned_properties').insert({ address: '20-22 NW 119th St' }).returning('id');
    const [u] = await knex('units').insert({ property_id: p.id, unit_label: '20' }).returning('id');
    const [w] = await knex('work_orders').insert({ property_id: p.id, project_name: 'Roof', status: 'open' }).returning('id');
    const row = (d, amount, extra = {}) => ({ date: '2026-05-01', description: d, amount, source: 'Bank of America', category: 'Repairs', category_group: 'Investments', dedup_hash: d, ...extra });
    await knex('transactions').insert([
      row('ROOFER', -900, { property_id: p.id, unit_id: u.id, work_order_id: w.id }),
      row('LAWN', -65, { property_id: p.id }),
      row('PUBLIX', -20),
    ]);
    await knex.migrate.up(cfg); // 013
    const allocs = await knex('transaction_allocations').orderBy('amount');
    assert.deepEqual(
      allocs.map((a) => [Number(a.amount), Number(a.percent), a.input_mode, a.property_id, a.unit_id, a.work_order_id]),
      [[-900, 100, 'percent', p.id, u.id, w.id], [-65, 100, 'percent', p.id, null, null]],
    );
    // The old columns stay for now (an untouched copy of the attributions)…
    assert.equal(await knex.schema.hasColumn('transactions', 'property_id'), true);
    assert.equal((await knex.migrate.list(cfg))[1].length, 0, 'no pending migrations: 014 is not in this release');
    // …and the later migration that drops them works when it is moved in.
    const later = await import('../db/later/014_drop_transaction_property_columns.js');
    await later.up(knex);
    assert.equal(await knex.schema.hasColumn('transactions', 'property_id'), false);
    assert.equal(await knex.schema.hasColumn('transactions', 'work_order_id'), false);
    assert.equal(await knex.schema.hasColumn('transactions', 'unit_id'), false);
    assert.equal((await knex('transaction_allocations').count({ c: '*' }).first()).c, 2);
  } finally {
    await knex.destroy();
  }
});

test('splits end to end (pg-mem + route handlers)', async (t) => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  await createTrackerStubs(knex);
  await knex.migrate.latest({ directory: MIGRATIONS });
  setFinanceDb(knex);
  const [p1, p2, p3] = (await knex('owned_properties').insert([{ address: '1821-1825 NW 74th St' }, { address: '1205-1207 NE 117th St' }, { address: '20-22 NW 119th St' }]).returning('id')).map((r) => r.id);
  const units = await knex('units')
    .insert([{ property_id: p1, unit_label: '1821' }, { property_id: p2, unit_label: '1205' }, { property_id: p3, unit_label: '20' }])
    .returning(['id', 'unit_label']);
  const unit = (l) => units.find((u) => u.unit_label === l).id;
  const [wo] = await knex('work_orders').insert({ property_id: p2, project_name: 'Fridge 1207', status: 'open' }).returning('id');

  const server = await startRouteServer({ prefix: 'api' });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const upload = async (file) => {
    const fd = new FormData();
    fd.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'fixtures', file))]), file);
    return (await fetch(base + '/finance/upload', { method: 'POST', body: fd })).json();
  };
  const txnBy = async (search) => (await call('GET', `/finance/transactions?search=${encodeURIComponent(search)}`)).body.transactions[0];
  const queueRow = async (id) => (await call('GET', '/finance/attribution/queue')).body.transactions.find((r) => r.id === id);

  try {
    await upload('bankofamerica.csv'); // MAX APPLIANCE REPAIRUS -101.97 lands in Repairs (needs a property)
    const repair = await txnBy('max appliance');
    assert.equal(repair.amount, -101.97);
    assert.ok(await queueRow(repair.id), 'starts in the queue');

    await t.test('percent split: saved, rounded, out of the queue, badge data', async () => {
      const r = await call('PUT', `/finance/transactions/${repair.id}/allocations`, {
        mode: 'percent',
        rows: [{ property_id: p1, value: 33.333 }, { property_id: p2, work_order_id: wo.id, value: 33.333 }, { property_id: p3, unit_id: unit('20'), value: 33.334 }],
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(amounts(r.body.allocations), [-33.99, -33.99, -33.99]);
      assert.equal(r.body.fully_allocated, true);
      assert.equal(r.body.property_id, null); // a split has no single property
      assert.equal(await queueRow(repair.id), undefined);
    });

    await t.test('dollar split; unbalanced, foreign unit or project → 400 and nothing changes', async () => {
      const bad = await call('PUT', `/finance/transactions/${repair.id}/allocations`, { mode: 'amount', rows: [{ property_id: p1, value: 50 }, { property_id: p2, value: 50 }] });
      assert.equal(bad.status, 400);
      assert.match(bad.body.error, /\$1\.97 unallocated/);
      const foreignUnit = await call('PUT', `/finance/transactions/${repair.id}/allocations`, { mode: 'amount', rows: [{ property_id: p1, unit_id: unit('20'), value: 101.97 }] });
      assert.equal(foreignUnit.status, 400);
      assert.match(foreignUnit.body.error, /does not belong to property/);
      const foreignProject = await call('PUT', `/finance/transactions/${repair.id}/allocations`, { mode: 'percent', rows: [{ property_id: p1, work_order_id: wo.id, value: 100 }] });
      assert.equal(foreignProject.status, 400);
      assert.equal((await txnBy('max appliance')).allocations.length, 3, 'unchanged');

      const ok = await call('PUT', `/finance/transactions/${repair.id}/allocations`, { mode: 'amount', rows: [{ property_id: p2, work_order_id: wo.id, value: 80 }, { property_id: p3, value: 21.97 }] });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.allocations.map((a) => [a.property_id, a.amount, a.input_mode]), [[p2, -80, 'amount'], [p3, -21.97, 'amount']]);
    });

    await t.test('roll-ups count each property its share', async () => {
      const proj = (await call('GET', `/finance/rollups/projects?propertyId=${p2}`)).body.projects[wo.id];
      assert.deepEqual(proj, { actual_spend: 80, transaction_count: 1 });
      const spend2 = (await call('GET', `/finance/rollups/property/${p2}?year=2026`)).body;
      assert.equal(spend2.ytd.Repairs, -80);
      assert.equal(spend2.transactions[0].share, -80);
      const spend3 = (await call('GET', `/finance/rollups/property/${p3}?year=2026`)).body;
      assert.equal(spend3.ytd.Repairs, -21.97);
      const o = await getOverview(knex, { month: '2026-04', today: '2026-04-30' });
      const flow = (id) => o.properties.find((p) => p.id === id).cash_flow.month.expenses;
      assert.equal(flow(p2), -80);
      assert.equal(flow(p3), -21.97);
    });

    await t.test('partial split stays in the queue with what is unallocated', async () => {
      await knex('transaction_allocations').where({ transaction_id: repair.id, property_id: p3 }).del();
      const q = await queueRow(repair.id);
      assert.ok(q, 'partial → queue');
      assert.equal(q.unallocated, -21.97);
      assert.equal(q.allocated, -80);
      // a category change into a required category needs a full allocation
      const r = await call('PUT', `/finance/transactions/${repair.id}/category`, { category: 'Lawn Care' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /only partly allocated/);
      // …or one property, which replaces the split with 100%
      const one = await call('PUT', `/finance/transactions/${repair.id}/category`, { category: 'Lawn Care', property_id: p1 });
      assert.equal(one.status, 200);
      assert.deepEqual(one.body.allocations.map((a) => [a.property_id, a.amount, a.percent]), [[p1, -101.97, 100]]);
    });

    await t.test('bulk assign gives each row one 100% allocation', async () => {
      const r = await call('PATCH', '/finance/transactions/attribution', { ids: [repair.id], property_id: p3, unit_id: unit('20') });
      assert.equal(r.status, 200);
      const rows = await knex('transaction_allocations').where({ transaction_id: repair.id });
      assert.deepEqual(rows.map((a) => [a.property_id, a.unit_id, Number(a.amount), Number(a.percent)]), [[p3, unit('20'), -101.97, 100]]);
    });

    await t.test('a split survives the row being deleted and uploaded again', async () => {
      await call('PUT', `/finance/transactions/${repair.id}/allocations`, { mode: 'percent', rows: [{ property_id: p1, value: 25 }, { property_id: p2, value: 75 }] });
      await knex('transactions').where({ id: repair.id }).del(); // allocations cascade away
      assert.equal((await knex('transaction_allocations').where({ transaction_id: repair.id })).length, 0);
      const up = await upload('bankofamerica.csv');
      assert.equal(up.new_rows, 1);
      const back = await txnBy('max appliance');
      assert.notEqual(back.id, repair.id);
      assert.deepEqual(back.allocations.map((a) => [a.property_id, a.amount, a.percent]), [[p1, -25.49], [p2, -76.48]].map(([p, a], i) => [p, a, [25, 75][i]]));
      assert.equal(back.fully_allocated, true);
    });

    await t.test('bulk: the same split for many transactions, all or nothing', async () => {
      const mk = (d, amt) => ({ date: '2026-05-0' + d, description: `LAWN ${d}`, amount: amt, source: 'Bank of America', category: 'Lawn Care', category_group: 'Investments', dedup_hash: `lawn-${d}` });
      const [a, b, c] = (await knex('transactions').insert([mk(1, -65), mk(2, -65), mk(3, -100)]).returning('id')).map((r) => r.id);
      // dollars only fit when the amounts match: -65 / -65 / -100 → 400, nothing saved
      const bad = await call('PUT', '/finance/transactions/allocations', { ids: [a, b, c], mode: 'amount', rows: [{ property_id: p1, value: 40 }, { property_id: p2, value: 25 }] });
      assert.equal(bad.status, 400);
      assert.match(bad.body.error, /LAWN 3/);
      assert.equal((await knex('transaction_allocations').whereIn('transaction_id', [a, b, c])).length, 0, 'nothing saved');
      const dollars = await call('PUT', '/finance/transactions/allocations', { ids: [a, b], mode: 'amount', rows: [{ property_id: p1, value: 40 }, { property_id: p2, value: 25 }] });
      assert.deepEqual(dollars.body, { success: true, updated: 2 });
      // percentages work for any mix, each on its own amount
      const pct = await call('PUT', '/finance/transactions/allocations', { ids: [a, c], mode: 'percent', rows: [{ property_id: p1, value: 50 }, { property_id: p3, unit_id: unit('20'), value: 50 }] });
      assert.equal(pct.status, 200);
      const rows = await knex('transaction_allocations').whereIn('transaction_id', [a, b, c]).orderBy('transaction_id').orderBy('id');
      assert.deepEqual(
        rows.map((r) => [r.transaction_id, r.property_id, Number(r.amount)]),
        [[a, p1, -32.5], [a, p3, -32.5], [b, p1, -40], [b, p2, -25], [c, p1, -50], [c, p3, -50]],
      );
      const q = (await call('GET', '/finance/attribution/queue')).body.transactions.map((r) => r.id);
      assert.ok(![a, b, c].some((id) => q.includes(id)), 'all three left the queue');
    });

    await t.test('clearing with rows: [] puts it back in the queue', async () => {
      const back = await txnBy('max appliance');
      const r = await call('PUT', `/finance/transactions/${back.id}/allocations`, { rows: [] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.allocations, []);
      assert.ok(await queueRow(back.id));
    });
  } finally {
    await new Promise((r) => server.close(r));
    setFinanceDb(null);
    await knex.destroy();
  }
});
