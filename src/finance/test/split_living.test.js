// Migration 021: an existing database with the old "Living" group is split
// into Bills & Utilities / Shopping / Health & Personal / Fun, and the
// transactions follow their categories.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { up } from '../db/migrations/021_split_living_group.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('migration 021 splits Living (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });

    // Rebuild the pre-split taxonomy: everything in Living, Bar/Entertainment in Other.
    const gid = async (name) => (await knex('category_groups').where({ name }).first('id')).id;
    await knex('category_groups').where({ name: 'Bills & Utilities' }).update({ name: 'Living' });
    const living = await gid('Living');
    const other = await gid('Other');
    await knex('categories').whereIn('name', ['Amazon', 'Shopping', 'Family Dollar', 'Healthcare', 'Gym', 'Career', 'Roman', 'Gun']).update({ group_id: living });
    await knex('categories').whereIn('name', ['Bar', 'Entertainment']).update({ group_id: other });
    await knex('category_groups').whereIn('name', ['Shopping', 'Health & Personal', 'Fun']).del();
    // A category added in Admin stays with what's left of Living.
    await knex('categories').insert({ name: 'Pool Service', group_id: living, is_builtin: false, archived: false, sort_order: 0 });

    const txn = (category, category_group, i) => ({
      date: '2026-05-01', description: `T${i}`, amount: -10, source: 'Bank of America', category, category_group, dedup_hash: `h${i}`,
    });
    await knex('transactions').insert([
      txn('Electric', 'Living', 1), txn('Amazon', 'Living', 2), txn('Roman', 'Living', 3),
      txn('Gun', 'Living', 4), txn('Bar', 'Other', 5), txn('Uncategorized', 'Other', 6), txn('Pool Service', 'Living', 7),
    ]);

    await up(knex);
    await up(knex); // no-op the second time

    const groupOf = async (name) =>
      (await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', name).first('g.name as group')).group;
    const expected = {
      Electric: 'Bills & Utilities', 'Home Security': 'Bills & Utilities', 'Pool Service': 'Bills & Utilities',
      Amazon: 'Shopping', 'Family Dollar': 'Shopping',
      Healthcare: 'Health & Personal', Roman: 'Health & Personal', Career: 'Health & Personal',
      Gun: 'Fun', Bar: 'Fun', Entertainment: 'Fun',
      Uncategorized: 'Other',
    };
    for (const [cat, group] of Object.entries(expected)) assert.equal(await groupOf(cat), group, cat);
    assert.equal(await knex('category_groups').where({ name: 'Living' }).first(), undefined);

    const txGroups = Object.fromEntries((await knex('transactions').select('category', 'category_group')).map((r) => [r.category, r.category_group]));
    assert.deepEqual(txGroups, {
      Electric: 'Bills & Utilities', Amazon: 'Shopping', Roman: 'Health & Personal',
      Gun: 'Fun', Bar: 'Fun', Uncategorized: 'Other', 'Pool Service': 'Bills & Utilities',
    });
  } finally {
    await knex.destroy();
  }
});
