// Migration 016: Figure Lending payments end up under 1821.
process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';
import { createTrackerStubs } from './helpers/tracker-stubs.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

test('016: Figure Lending category, mapping to 1821, rule applied to existing rows', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    const [p1821] = await knex('owned_properties').insert([{ address: '1821-1825 NW 74th St' }, { address: '20-22 NW 119th St' }]).returning('id');
    const cfg = { directory: MIGRATIONS };
    for (let i = 0; i < 14; i += 1) await knex.migrate.up(cfg); // through 015
    const row = (d, desc, manual = false, category = 'Uncategorized') => ({ date: d, description: desc, amount: -1210, source: 'SoFi', category, category_group: 'Other', is_manual: manual, dedup_hash: desc + d });
    await knex('transactions').insert([row('2026-10-02', 'FIGURE LENDING PAYMENT'), row('2026-11-02', 'FIGURE LENDING PAYMENT'), row('2026-11-05', 'PUBLIX', false, 'Groceries')]);
    await knex.migrate.latest(cfg); // 016
    const cat = await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', 'Figure Lending').first('g.name as group');
    assert.equal(cat.group, 'Investments');
    const map = await knex('property_category_map').where({ category: 'Figure Lending' }).first();
    assert.deepEqual([map.property_id, map.role], [p1821.id, 'piti']);
    const moved = await knex('transactions').where({ category: 'Figure Lending' });
    assert.equal(moved.length, 2);
    assert.equal((await knex('transaction_allocations').whereIn('transaction_id', moved.map((t) => t.id))).length, 2, '100% to 1821');
    assert.equal((await knex('transactions').where({ description: 'PUBLIX' }).first()).category, 'Groceries');
    // re-running changes nothing
    const { up } = await import('../db/migrations/016_figure_lending_1821.js');
    await up(knex);
    assert.equal((await knex('merchant_rules').where({ pattern: 'FIGURE LENDING' })).length, 1);
  } finally {
    await knex.destroy();
  }
});
