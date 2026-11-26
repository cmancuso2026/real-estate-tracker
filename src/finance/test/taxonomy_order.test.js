// Admin → Categories ordering: moving groups up/down and the ascending /
// descending presets (by net total over a period: spending negative, income
// positive).
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { categoryOp } from '../services/admin.js';
import { loadTaxonomy, sortPeriodStart } from '../lib/categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TODAY = '2026-11-26';

test('sort periods', () => {
  assert.equal(sortPeriodStart('3m', TODAY), '2026-09-01');
  assert.equal(sortPeriodStart('12m', TODAY), '2025-12-01');
  assert.equal(sortPeriodStart('ytd', TODAY), '2026-01-01');
  assert.equal(sortPeriodStart('all', TODAY), null);
  assert.equal(sortPeriodStart('3m', '2026-02-10'), '2025-12-01');
});

test('taxonomy order: reorder groups, sort by net total (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    let i = 0;
    const row = (category, group, amount, date = '2026-10-15') => ({ date, description: `T${(i += 1)}`, amount, source: 'Bank of America', category, category_group: group, dedup_hash: `h${i}` });
    // Sep–Nov, like the Categories page: Investments -21,105, Baby -5,985, Food -4,801,
    // Travel -3,531 (Hotel -2,000, Gas -1,531), Fun -301, W2 Income +40,144.
    await knex('transactions').insert([
      row('Repairs', 'Investments', -21105), row('Baby Gear', 'Baby', -5985), row('Groceries', 'Food', -4801),
      row('Hotel', 'Travel', -2000), row('Gas', 'Travel', -1531), row('Bar', 'Fun', -301), row('Paycheck', 'W2 Income', 40144),
      // Older than 3 months: only counts for 12 months / all time.
      row('Bar', 'Fun', -50000, '2026-03-01'),
    ]);
    const groups = async () => (await loadTaxonomy(knex)).groups.map((g) => g.name);
    const cats = async (g) => (await loadTaxonomy(knex)).groups.find((x) => x.name === g).categories.map((c) => c.name);
    const used = ['Investments', 'Baby', 'Food', 'Travel', 'Fun', 'W2 Income'];
    const only = (list) => list.filter((g) => used.includes(g));

    // Ascending, last 3 months: biggest spending first, income last.
    await categoryOp(knex, { op: 'sort', groups: 'asc', categories: 'asc', period: '3m', today: TODAY });
    assert.deepEqual(only(await groups()), ['Investments', 'Baby', 'Food', 'Travel', 'Fun', 'W2 Income']);
    assert.equal((await groups()).at(-1), 'W2 Income', 'income after every zero-total group');
    assert.deepEqual((await cats('Travel')).slice(0, 2), ['Hotel', 'Gas']);
    // Descending: income first.
    await categoryOp(knex, { op: 'sort', groups: 'desc', period: '3m', today: TODAY });
    assert.deepEqual(only(await groups()), ['W2 Income', 'Fun', 'Travel', 'Food', 'Baby', 'Investments']);
    // All time: the old $50k bar tab makes Fun the biggest spender.
    await categoryOp(knex, { op: 'sort', groups: 'asc', period: 'all', today: TODAY });
    assert.equal((await groups())[0], 'Fun');

    // Move a group up: it swaps with the one above; at the edge nothing changes.
    const before = await groups();
    await categoryOp(knex, { op: 'reorder_group', name: before[1], direction: 'up' });
    assert.deepEqual((await groups()).slice(0, 2), [before[1], before[0]]);
    await categoryOp(knex, { op: 'reorder_group', name: before[1], direction: 'up' });
    assert.equal((await groups())[0], before[1]);

    await assert.rejects(categoryOp(knex, { op: 'sort' }), /Pick groups and\/or categories/);
    await assert.rejects(categoryOp(knex, { op: 'sort', groups: 'sideways' }), /asc or desc/);
    await assert.rejects(categoryOp(knex, { op: 'sort', groups: 'asc', period: 'decade' }), /period must be/);
    await assert.rejects(categoryOp(knex, { op: 'reorder_group', name: 'Nope', direction: 'up' }), /not found/);
    assert.match((await knex('admin_audit').where({ action: 'taxonomy.sort' }).orderBy('id', 'desc').first()).summary, /all time/);
  } finally {
    await knex.destroy();
  }
});
