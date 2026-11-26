// Admin → Categories ordering: moving groups up/down and the A→Z / Z→A presets.
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

test('taxonomy order: reorder groups, sort presets (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    const groups = async () => (await loadTaxonomy(knex)).groups.map((g) => g.name);
    const cats = async (g) => (await loadTaxonomy(knex)).groups.find((x) => x.name === g).categories.map((c) => c.name);

    await categoryOp(knex, { op: 'sort', groups: 'asc', categories: 'asc' });
    const asc = await groups();
    assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    assert.deepEqual(await cats('Travel'), ['Boarding', 'Car Insurance', 'Car Maintenance', 'Car Payment', 'Flights', 'Gas', 'Hotel', 'Lyft', 'Parking', 'Sunpass']);

    // Move the second group up: it becomes first, the old first is second.
    await categoryOp(knex, { op: 'reorder_group', name: asc[1], direction: 'up' });
    assert.deepEqual((await groups()).slice(0, 2), [asc[1], asc[0]]);
    // At the edge: nothing changes.
    await categoryOp(knex, { op: 'reorder_group', name: asc[1], direction: 'up' });
    assert.equal((await groups())[0], asc[1]);

    // Groups Z→A only: categories keep their A→Z order.
    await categoryOp(knex, { op: 'sort', groups: 'desc' });
    assert.deepEqual(await groups(), [...asc].reverse());
    assert.equal((await cats('Travel'))[0], 'Boarding');
    // Categories Z→A only: group order kept.
    await categoryOp(knex, { op: 'sort', categories: 'desc' });
    assert.deepEqual(await groups(), [...asc].reverse());
    assert.equal((await cats('Travel'))[0], 'Sunpass');

    await assert.rejects(categoryOp(knex, { op: 'sort' }), /Pick groups and\/or categories/);
    await assert.rejects(categoryOp(knex, { op: 'sort', groups: 'sideways' }), /asc or desc/);
    await assert.rejects(categoryOp(knex, { op: 'reorder_group', name: 'Nope', direction: 'up' }), /not found/);
    assert.ok(await knex('admin_audit').where({ action: 'taxonomy.sort' }).first());
  } finally {
    await knex.destroy();
  }
});
