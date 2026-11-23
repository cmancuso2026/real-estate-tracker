// Admin portal (Phase 7), end to end through the real route handlers on pg-mem.
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
import { categorize } from '../lib/categorize.js';
import { parseFileAuto } from '../parsers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));

test('admin portal (pg-mem)', async (t) => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  let server;
  try {
    await createTrackerStubs(knex);
    const [prop] = await knex('owned_properties').insert({ address: '1205-1207 NE 117th St' }).returning('id');
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    setFinanceDb(knex);
    server = await startRouteServer({ prefix: 'api' });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (method, p, body) => {
      const r = await fetch(base + p, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: r.status, body: json, headers: r.headers };
    };
    const upload = async (...files) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', new Blob([fixture(f)]), f);
      return (await fetch(base + '/finance/upload', { method: 'POST', body: fd })).json();
    };
    const txn = async (search) => (await call('GET', `/finance/transactions?search=${encodeURIComponent(search)}`)).body.transactions[0];
    const op = (body) => call('POST', '/admin/categories', body);

    await t.test('built-in categorization is unchanged with zero merchant rules', async () => {
      assert.equal((await call('GET', '/admin/merchant-rules')).body.rules.length, 0);
      await upload('bankofamerica.csv', 'amex_gold.csv');
      // Every imported row has exactly the category the built-in rules give
      // (no history yet, so the rule fallback decides each one).
      for (const f of ['bankofamerica.csv', 'amex_gold.csv']) {
        const { source, transactions } = parseFileAuto(fixture(f), f);
        for (const x of transactions) {
          const row = await knex('transactions').where({ description: x.description, date: x.date }).first();
          assert.equal(row.category, categorize(x.description, x.rawCategory, source).category, x.description);
        }
      }
    });

    await t.test('taxonomy comes from the DB with the original response shape', async () => {
      const tax = (await call('GET', '/finance/categories')).body;
      assert.deepEqual(Object.keys(tax).sort(), ['cat_to_group', 'groups']);
      assert.ok(tax.groups.Investments.includes('Repairs'));
      assert.equal(tax.cat_to_group.Repairs, 'Investments');
    });

    await t.test('rename previews every table, then cascades in one go', async () => {
      // Make "Repairs" referenced from all five places.
      const repair = await txn('MAX APPLIANCE'); // built-in → Repairs
      await call('PUT', `/finance/transactions/${repair.id}/category`, { category: 'Repairs', property_id: prop.id }); // override
      await knex('property_category_map').insert({ category: 'Repairs', property_id: prop.id, role: 'expense', confirmed: true });
      await call('POST', '/admin/merchant-rules', { pattern: 'PLUMBING', category: 'Repairs' });

      const preview = await op({ op: 'rename', name: 'Repairs', new_name: 'Home Repairs', dry_run: true });
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.body.changes, {
        transactions: 1, category_overrides: 1, category_settings: 1, property_category_map: 1, merchant_rules: 1,
      });
      assert.equal((await txn('MAX APPLIANCE')).category, 'Repairs'); // dry run changed nothing

      const done = await op({ op: 'rename', name: 'Repairs', new_name: 'Home Repairs' });
      assert.equal(done.status, 200);
      for (const table of ['transactions', 'category_overrides', 'category_settings', 'property_category_map', 'merchant_rules']) {
        assert.equal(Number((await knex(table).where({ category: 'Repairs' }).count({ c: '*' }).first()).c), 0, table);
        assert.equal(Number((await knex(table).where({ category: 'Home Repairs' }).count({ c: '*' }).first()).c), 1, table);
      }
      const tax = (await call('GET', '/finance/categories')).body;
      assert.ok(tax.groups.Investments.includes('Home Repairs') && !tax.groups.Investments.includes('Repairs'));
      // requires_property moved with it
      const bad = await call('PUT', `/finance/transactions/${(await txn('PUBLIX')).id}/category`, { category: 'Home Repairs' });
      assert.equal(bad.status, 400);
    });

    await t.test('after a rename, the built-in rules still land in the new name', async () => {
      const repair = await txn('MAX APPLIANCE');
      await knex('category_overrides').where({ dedup_hash: (await knex('transactions').where({ id: repair.id }).first()).dedup_hash }).del();
      await knex('transactions').where({ id: repair.id }).del();
      await upload('bankofamerica.csv'); // built-in rule says "Repairs" → alias → "Home Repairs"
      assert.equal((await txn('MAX APPLIANCE')).category, 'Home Repairs');
    });

    await t.test('merge re-points rows and leaves an alias; delete in use is blocked', async () => {
      await op({ op: 'add', name: 'Coffee', group: 'Food' });
      const publix = await txn('PUBLIX');
      await call('PUT', `/finance/transactions/${publix.id}/category`, { category: 'Coffee' });
      const blocked = await op({ op: 'delete', name: 'Coffee' });
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /in use.*Merge/);

      const preview = await op({ op: 'merge', name: 'Coffee', into: 'Eating Out', dry_run: true });
      assert.equal(preview.body.changes.transactions, 1);
      assert.equal(preview.body.changes.category_overrides, 1);
      await op({ op: 'merge', name: 'Coffee', into: 'Eating Out' });
      const after = await txn('PUBLIX');
      assert.equal(after.category, 'Eating Out');
      assert.equal(after.category_group, 'Food');
      assert.ok(!(await call('GET', '/finance/categories')).body.cat_to_group.Coffee);
      assert.equal((await knex('category_aliases').where({ alias: 'Coffee' }).first()) != null, true);

      await op({ op: 'add', name: 'Unused', group: 'Other' });
      assert.equal((await op({ op: 'delete', name: 'Unused' })).status, 200);
    });

    await t.test('archive hides a category from dropdowns but keeps its history', async () => {
      const r = await op({ op: 'archive', name: 'Lawn Care' });
      assert.equal(r.status, 200);
      const tax = (await call('GET', '/finance/categories')).body;
      assert.ok(!tax.groups.Investments.includes('Lawn Care')); // hidden from dropdowns
      assert.equal(tax.cat_to_group['Lawn Care'], 'Investments'); // history still resolves
      assert.equal((await txn('LAWNSTARTER')).category, 'Lawn Care'); // rows keep it
      const put = await call('PUT', `/finance/transactions/${(await txn('PUBLIX')).id}/category`, { category: 'Lawn Care' });
      assert.equal(put.status, 400); // can't be assigned while archived
      await op({ op: 'unarchive', name: 'Lawn Care' });
      assert.ok((await call('GET', '/finance/categories')).body.groups.Investments.includes('Lawn Care'));
    });

    await t.test('the categories the app relies on are protected', async () => {
      assert.equal((await op({ op: 'rename', name: 'Uncategorized', new_name: 'Misc' })).status, 400);
    });

    await t.test('merchant rules run before built-in rules and history, in priority order', async () => {
      // Without rules: the built-in rule says Eating Out (history may outvote it).
      const tested = (await call('POST', '/admin/merchant-rules/test', { description: 'UBER EATS', source: 'Amex Gold' })).body;
      assert.equal(tested.steps[2].result.category, 'Eating Out');
      assert.notEqual(tested.winner.from, 'your rule');

      const lo = (await call('POST', '/admin/merchant-rules', { pattern: 'UBER', category: 'Lyft', priority: 50 })).body;
      const hi = (await call('POST', '/admin/merchant-rules', { pattern: 'uber eats', category: 'Restaurant', priority: 10, property_id: prop.id })).body;
      const test2 = (await call('POST', '/admin/merchant-rules/test', { description: 'UBER EATS', source: 'Amex Gold' })).body;
      assert.deepEqual(test2.winner, { from: 'your rule', category: 'Restaurant' }); // lowest priority number wins
      assert.equal(test2.steps[2].result.category, 'Eating Out'); // built-in still shown, but loses

      // Upload: delete the row and re-import — the rule wins and attributes it.
      const uber = await txn('UBER EATS');
      await knex('transactions').where({ id: uber.id }).del();
      await upload('amex_gold.csv');
      const back = await txn('UBER EATS');
      assert.equal(back.category, 'Restaurant');
      assert.equal(back.property_id, prop.id);

      // A disabled rule is ignored.
      await call('PUT', `/admin/merchant-rules/${hi.id}`, { enabled: false });
      assert.equal((await call('POST', '/admin/merchant-rules/test', { description: 'UBER EATS', source: 'Amex Gold' })).body.winner.category, 'Lyft');
      await call('DELETE', `/admin/merchant-rules/${lo.id}`);
      await call('DELETE', `/admin/merchant-rules/${hi.id}`);
    });

    await t.test('apply a rule to existing rows: preview, then apply (manual rows untouched)', async () => {
      const rule = (await call('POST', '/admin/merchant-rules', { pattern: 'WHOLE FOODS', category: 'Restaurant' })).body;
      const preview = await call('POST', `/admin/merchant-rules/${rule.id}/apply`, { dry_run: true });
      assert.equal(preview.body.changes.recategorized, 1);
      assert.equal((await txn('WHOLE FOODS')).category, 'Groceries');
      await call('POST', `/admin/merchant-rules/${rule.id}/apply`, {});
      assert.equal((await txn('WHOLE FOODS')).category, 'Restaurant');
      await call('DELETE', `/admin/merchant-rules/${rule.id}`);
    });

    await t.test('requires_property toggle previews queue changes before applying', async () => {
      const queued0 = (await call('GET', '/finance/attribution/count')).body.count;
      const preview = await call('PUT', '/admin/category-settings/Wifi', { requires_property: true, dry_run: true });
      assert.equal(preview.body.dry_run, true);
      assert.ok(preview.body.changes.queue_enter >= 1);
      const before = (await call('GET', '/finance/attribution/count')).body.count;
      assert.equal(before, queued0); // the preview changed nothing
      const on = await call('PUT', '/admin/category-settings/Wifi', { requires_property: true });
      assert.equal((await call('GET', '/finance/attribution/count')).body.count, queued0 + preview.body.changes.queue_enter);
      assert.equal(on.body.queued, preview.body.changes.queue_enter);
      await call('PUT', '/admin/category-settings/Wifi', { requires_property: false });
    });

    await t.test('property mapping: edit, confirm all, unmapped list', async () => {
      // "1207 Rent" was mapped by the seed (its number is in the address).
      assert.equal((await knex('property_category_map').where({ category: '1207 Rent' }).first()).property_id, prop.id);
      await op({ op: 'add', name: '1821 Rent', group: 'Investments' }); // no property with 1821
      const map = (await call('GET', '/admin/property-map')).body;
      assert.ok(map.unmapped.some((u) => u.category === '1821 Rent'));
      await call('PUT', '/admin/property-map', { category: '1821 Rent', property_id: prop.id, role: 'income', confirmed: false });
      const n = (await call('PUT', '/admin/property-map', { confirm_all: true })).body.confirmed;
      assert.ok(n >= 1);
      assert.equal((await knex('property_category_map').where({ category: '1821 Rent' }).first()).confirmed, true);
    });

    await t.test('change log records actions', async () => {
      const log = (await call('GET', '/admin/audit')).body.entries.map((e) => e.action);
      for (const a of ['category.rename', 'category.merge', 'category.archive', 'rule.create', 'rule.apply', 'settings.update', 'mapping.confirm_all']) {
        assert.ok(log.includes(a), a);
      }
    });
  } finally {
    if (server) await new Promise((r) => server.close(r));
    setFinanceDb(null);
    await knex.destroy();
  }
});
