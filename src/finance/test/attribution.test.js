// Property / project attribution (Phase 5), end to end through the real Next.js
// route handlers against pg-mem. Run under tsx.
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
import { addressKeys, mentionsNumber } from '../lib/suggest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('property attribution (pg-mem)', async (t) => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  await createTrackerStubs(knex);
  await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
  setFinanceDb(knex);

  // Tracker data: three properties with units, a vendor with an open project.
  const [p1, p2, p3] = await knex('owned_properties')
    .insert([{ address: '1821-1825 NW 74th St' }, { address: '1205-1207 NE 117th St' }, { address: '20-22 NW 119th St' }])
    .returning('id')
    .then((r) => r.map((x) => x.id));
  const units = await knex('units')
    .insert([
      { property_id: p1, unit_label: '1821' }, { property_id: p1, unit_label: '1825' },
      { property_id: p2, unit_label: '1205' }, { property_id: p2, unit_label: '1207' },
      { property_id: p3, unit_label: '20' }, { property_id: p3, unit_label: '22' },
    ])
    .returning(['id', 'property_id', 'unit_label']);
  const unit = (label) => units.find((u) => u.unit_label === label).id;
  const [vendor] = await knex('vendors').insert({ name: 'Max Appliance', trade: 'appliance' }).returning('id');
  const [woP2] = await knex('work_orders')
    .insert({ property_id: p2, vendor_id: vendor.id, project_name: 'Fridge 1207', status: 'open', created_at: '2026-04-01 00:00:00' })
    .returning('id');
  const [woP1] = await knex('work_orders').insert({ property_id: p1, project_name: 'Roof', status: 'completed' }).returning('id');

  const server = await startRouteServer({ prefix: 'api' }); // /api/finance and /api/admin
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const upload = async (...files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'fixtures', f))]), f);
    const r = await fetch(base + '/finance/upload', { method: 'POST', body: fd });
    return r.json();
  };
  const txnBy = async (search) => (await call('GET', `/finance/transactions?search=${encodeURIComponent(search)}`)).body.transactions[0];
  const queue = async () => (await call('GET', '/finance/attribution/queue')).body;

  try {
    await t.test('uploads import rows in required categories as unattributed (queue)', async () => {
      const up = await upload('bankofamerica.csv', 'amex_gold.csv');
      assert.ok(up.new_rows > 0);
      const q = await queue();
      const cats = Object.fromEntries(q.by_category.map((c) => [c.category, c.count]));
      assert.equal(cats.Repairs, 1); // MAX APPLIANCE REPAIRUS
      assert.equal(cats['Lawn Care'], 1); // LAWNSTARTER
      assert.equal(q.count, 2);
      assert.deepEqual((await call('GET', '/finance/attribution/count')).body, { count: 2 });
    });

    await t.test('PUT category to a required category without a property → 400', async () => {
      const publix = await txnBy('publix');
      const r = await call('PUT', `/finance/transactions/${publix.id}/category`, { category: 'Repairs' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Category 'Repairs' requires a property/);
      assert.equal((await txnBy('publix')).category, 'Groceries'); // nothing changed
    });

    await t.test('PUT category with a property saves both; a row that already has one needs none', async () => {
      const publix = await txnBy('publix');
      const r = await call('PUT', `/finance/transactions/${publix.id}/category`, { category: 'Home Depot', property_id: p2, unit_id: unit('1205') });
      assert.equal(r.status, 200);
      assert.equal(r.body.category, 'Home Depot');
      assert.equal(r.body.property_id, p2);
      assert.equal(r.body.unit_id, unit('1205'));
      const again = await call('PUT', `/finance/transactions/${publix.id}/category`, { category: 'Repairs' });
      assert.equal(again.status, 200); // already attributed
      assert.equal(again.body.property_id, p2);
    });

    await t.test('PATCH attribution validates that unit and project belong to the property', async () => {
      const lawn = await txnBy('lawnstarter');
      const wrongUnit = await call('PATCH', `/finance/transactions/${lawn.id}/attribution`, { property_id: p1, unit_id: unit('1205') });
      assert.equal(wrongUnit.status, 400);
      assert.match(wrongUnit.body.error, /does not belong to property/);
      const wrongProject = await call('PATCH', `/finance/transactions/${lawn.id}/attribution`, { property_id: p1, work_order_id: woP2.id });
      assert.equal(wrongProject.status, 400);
      const missing = await call('PATCH', `/finance/transactions/${lawn.id}/attribution`, { property_id: 9999 });
      assert.equal(missing.status, 400);
      const ok = await call('PATCH', `/finance/transactions/${lawn.id}/attribution`, { property_id: p1, unit_id: unit('1821'), work_order_id: woP1.id });
      assert.equal(ok.status, 200);
      assert.deepEqual([ok.body.property_id, ok.body.unit_id, ok.body.work_order_id], [p1, unit('1821'), woP1.id]);
      assert.equal((await queue()).count, 1); // only the Repairs row left
    });

    await t.test('attribution survives re-uploading the same CSV, and a delete + re-upload', async () => {
      const lawn = await txnBy('lawnstarter');
      const re = await upload('amex_gold.csv');
      assert.equal(re.new_rows, 0); // dedup skipped it; the row keeps its attribution
      assert.equal((await txnBy('lawnstarter')).property_id, p1);

      await knex('transactions').where({ id: lawn.id }).del();
      const back = await upload('amex_gold.csv');
      assert.equal(back.new_rows, 1);
      const restored = await txnBy('lawnstarter');
      assert.notEqual(restored.id, lawn.id);
      assert.deepEqual([restored.property_id, restored.unit_id, restored.work_order_id], [p1, unit('1821'), woP1.id]);
    });

    await t.test('turning requires_property on queues a category at once; off removes it but keeps attribution', async () => {
      const before = (await queue()).count;
      const groceryRows = (await call('GET', '/finance/transactions?category=Groceries')).body.transactions;
      assert.ok(groceryRows.length >= 1);
      const on = await call('PUT', '/admin/category-settings/Groceries', { requires_property: true });
      assert.equal(on.status, 200);
      assert.equal(on.body.queued, groceryRows.length);
      assert.equal((await queue()).count, before + groceryRows.length);

      // attribute one Groceries row, then turn the rule off
      await call('PATCH', `/finance/transactions/${groceryRows[0].id}/attribution`, { property_id: p3 });
      assert.equal((await queue()).count, before + groceryRows.length - 1);
      const off = await call('PUT', '/admin/category-settings/Groceries', { requires_property: false });
      assert.equal(off.body.queued, 0);
      assert.equal((await queue()).count, before);
      const kept = (await call('GET', '/finance/transactions?category=Groceries')).body.transactions.find((x) => x.id === groceryRows[0].id);
      assert.equal(kept.property_id, p3); // attribution kept
      // the category change now needs no property
      const ok = await call('PUT', `/finance/transactions/${groceryRows[1]?.id ?? groceryRows[0].id}/category`, { category: 'Groceries' });
      assert.equal(ok.status, 200);
    });

    await t.test('bulk attribution, and allow_project_tag off blocks project tags', async () => {
      const repair = (await queue()).transactions[0];
      const bulk = await call('PATCH', '/finance/transactions/attribution', { ids: [repair.id], property_id: p2, work_order_id: woP2.id });
      assert.equal(bulk.status, 200);
      assert.equal(bulk.body.updated, 1);
      assert.equal((await queue()).count, 0);

      await call('PUT', '/admin/category-settings/Repairs', { allow_project_tag: false });
      const blocked = await call('PATCH', '/finance/transactions/attribution', { ids: [repair.id], property_id: p2, work_order_id: woP2.id });
      assert.equal(blocked.status, 400);
      assert.match(blocked.body.error, /Project tagging is turned off for: Repairs/);
      await call('PUT', '/admin/category-settings/Repairs', { allow_project_tag: true });
    });

    await t.test('new project from a transaction; project actual spend sums linked rows', async () => {
      const comcast = await txnBy('comcast'); // -115.05
      const created = await call('POST', `/finance/transactions/${comcast.id}/project`, { property_id: p3 });
      assert.equal(created.status, 201);
      const wo = created.body.work_order;
      assert.equal(wo.status, 'open');
      assert.equal(wo.project_name, comcast.description);
      assert.equal(Number(wo.quoted_cost), 115); // starting cost, whole dollars
      assert.equal(created.body.transaction.work_order_id, wo.id);

      // link a second expense and a refund to the same project
      const valet = await txnBy('valet'); // -20.00
      await call('PATCH', `/finance/transactions/${valet.id}/attribution`, { property_id: p3, work_order_id: wo.id });
      await knex('transactions').insert({ date: '2026-04-30', description: 'COMCAST REFUND', amount: 15.05, source: 'Bank of America', category: 'Wifi', category_group: 'Living', dedup_hash: 'refund-1', property_id: p3, work_order_id: wo.id });
      const spend = (await call('GET', `/finance/rollups/projects?propertyId=${p3}`)).body.projects[wo.id];
      assert.deepEqual(spend, { actual_spend: 120, transaction_count: 3 }); // 115.05 + 20 − 15.05

      const prop = (await call('GET', `/finance/rollups/property/${p3}?year=2026`)).body;
      assert.equal(prop.transactions.length >= 3, true);
      assert.equal(prop.ytd.Wifi, -100);
      assert.equal(prop.months['2026-04'].Travel ?? prop.months['2026-04'].Parking, -20);
    });

    await t.test('suggestions, in priority order: vendor → address → default → history', async () => {
      // A Repairs row that names the vendor and a street number of another property.
      await knex('transactions').insert({ date: '2026-05-02', description: 'MAX APPLIANCE 1821 NW', amount: -50, source: 'Amex Gold', category: 'Repairs', category_group: 'Investments', dedup_hash: 'sugg-1' });
      await call('PUT', '/admin/category-settings/Repairs', { default_property_id: p3 });
      const q = await queue();
      const row = q.transactions.find((x) => x.description === 'MAX APPLIANCE 1821 NW');
      assert.deepEqual([row.suggestion.source, row.suggestion.property_id, row.suggestion.work_order_id], ['vendor', p2, woP2.id]);
      const all = (await call('GET', `/finance/transactions/${row.id}/suggestions`)).body.suggestions;
      assert.deepEqual(all.map((s) => [s.source, s.property_id]), [['vendor', p2], ['address', p1], ['default', p3]]);
      assert.equal(all[1].unit_id, unit('1821')); // the number is also a unit label

      // history: the last property picked for a merchant
      const lawnRow = await txnBy('lawnstarter'); // attributed to p1 earlier
      await knex('transactions').insert({ date: '2026-05-12', description: 'LAWNCARE* LAWNSTARTER', amount: -59.99, source: 'Amex Gold', category: 'Lawn Care', category_group: 'Investments', dedup_hash: 'sugg-2' });
      const lawn2 = (await queue()).transactions.find((x) => x.description === 'LAWNCARE* LAWNSTARTER' && x.id !== lawnRow.id);
      // the earlier pick had a unit and a project; history suggests the property only
      assert.deepEqual([lawn2.suggestion.source, lawn2.suggestion.property_id, lawn2.suggestion.unit_id, lawn2.suggestion.work_order_id], ['history', p1, null, null]);
    });

    await t.test('street-number matching: long numbers alone, short ones need the direction', () => {
      const a = addressKeys('20-22 NW 119th St', ['20', '22']);
      assert.deepEqual(a, { nums: ['20', '22'], dir: 'NW' });
      assert.equal(mentionsNumber('HOME DEPOT 20 NW 119', '20', 'NW'), true);
      assert.equal(mentionsNumber('AMAZON $20 GIFT', '20', 'NW'), false);
      assert.equal(mentionsNumber('PLUMBER 1205 NE', '1205', 'NE'), true);
      assert.equal(mentionsNumber('STORE 112050', '1205', 'NE'), false);
    });
  } finally {
    await new Promise((r) => server.close(r));
    setFinanceDb(null);
    await knex.destroy();
  }
});
