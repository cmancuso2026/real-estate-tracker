// Admin → Categories ordering: moving groups up/down and the ascending /
// descending presets (by total amount).
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { categoryOp } from '../services/admin.js';
import { loadTaxonomy } from '../lib/categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('taxonomy order: reorder groups, sort by total amount (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    const row = (i, category, group, amount) => ({ date: '2026-05-01', description: `T${i}`, amount, source: 'Bank of America', category, category_group: group, dedup_hash: `h${i}` });
    // Travel: Gas 300 (two rows), Hotel 900, Flights 50. Food: Groceries 400. W2 Income: Paycheck +5000.
    await knex('transactions').insert([
      row(1, 'Gas', 'Travel', -200), row(2, 'Gas', 'Travel', -100), row(3, 'Hotel', 'Travel', -900), row(4, 'Flights', 'Travel', -50),
      row(5, 'Groceries', 'Food', -400), row(6, 'Paycheck', 'W2 Income', 5000),
    ]);
    const groups = async () => (await loadTaxonomy(knex)).groups.map((g) => g.name);
    const cats = async (g) => (await loadTaxonomy(knex)).groups.find((x) => x.name === g).categories.map((c) => c.name);

    // Descending: biggest totals first. W2 Income 5000 > Travel 1250 > Food 400 > the rest (0, A→Z).
    await categoryOp(knex, { op: 'sort', groups: 'desc', categories: 'desc' });
    assert.deepEqual((await groups()).slice(0, 3), ['W2 Income', 'Travel', 'Food']);
    assert.deepEqual((await cats('Travel')).slice(0, 3), ['Hotel', 'Gas', 'Flights']);
    // Ascending categories only: zero-total ones first (A→Z), then Flights, Gas, Hotel; group order kept.
    await categoryOp(knex, { op: 'sort', categories: 'asc' });
    assert.deepEqual((await cats('Travel')).slice(-3), ['Flights', 'Gas', 'Hotel']);
    assert.equal((await cats('Travel'))[0], 'Boarding');
    assert.equal((await groups())[0], 'W2 Income');
    // Ascending groups: biggest last.
    await categoryOp(knex, { op: 'sort', groups: 'asc' });
    assert.deepEqual((await groups()).slice(-3), ['Food', 'Travel', 'W2 Income']);

    // Move a group up: it swaps with the one above; at the edge nothing changes.
    const before = await groups();
    await categoryOp(knex, { op: 'reorder_group', name: before[1], direction: 'up' });
    assert.deepEqual((await groups()).slice(0, 2), [before[1], before[0]]);
    await categoryOp(knex, { op: 'reorder_group', name: before[1], direction: 'up' });
    assert.equal((await groups())[0], before[1]);

    await assert.rejects(categoryOp(knex, { op: 'sort' }), /Pick groups and\/or categories/);
    await assert.rejects(categoryOp(knex, { op: 'sort', groups: 'sideways' }), /asc or desc/);
    await assert.rejects(categoryOp(knex, { op: 'reorder_group', name: 'Nope', direction: 'up' }), /not found/);
    assert.ok(await knex('admin_audit').where({ action: 'taxonomy.sort' }).first());
  } finally {
    await knex.destroy();
  }
});
