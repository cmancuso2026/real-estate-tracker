// Linking existing transactions to a project (services/projects.js), on pg-mem.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { setAllocations } from '../services/attribution.js';
import { linkProjectTransactions, listProjectTransactions, projectCandidates, unlinkProjectTransactions } from '../services/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('projects: link, candidates, splits and unlink (pg-mem)', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    const [a] = await knex('owned_properties').insert({ address: '1205 NE 117th St' }).returning('id');
    const [b] = await knex('owned_properties').insert({ address: '20 NW 119th St' }).returning('id');
    const [roof] = await knex('work_orders').insert({ property_id: a.id, project_name: 'Roof', status: 'open' }).returning('id');
    const [other] = await knex('work_orders').insert({ property_id: a.id, project_name: 'AC', status: 'open' }).returning('id');
    const row = (d, amount, date = '2026-05-01') => ({ date, description: d, amount, source: 'Bank of America', category: 'Repairs', category_group: 'Investments', dedup_hash: d });
    const ids = {};
    for (const [d, amt, date] of [['ROOFER DEPOSIT', -900, '2026-05-02'], ['HOME DEPOT', -120], ['SPLIT LUMBER', -200], ['ELSEWHERE', -50], ['AC TECH', -300]]) {
      const [r] = await knex('transactions').insert(row(d, amt, date)).returning('id');
      ids[d] = r.id;
    }
    // SPLIT LUMBER: 50/50 between the two properties. ELSEWHERE: only property B. AC TECH: already on the AC project.
    await setAllocations(knex, { id: ids['SPLIT LUMBER'] }, { mode: 'percent', rows: [{ property_id: a.id, value: 50 }, { property_id: b.id, value: 50 }] });
    await setAllocations(knex, { id: ids.ELSEWHERE }, { mode: 'percent', rows: [{ property_id: b.id, value: 100 }] });
    await linkProjectTransactions(knex, { id: other.id }, { ids: [ids['AC TECH']] });

    // Candidates for the roof: unassigned + this property's, not other properties' only, not another project's.
    const cand = await projectCandidates(knex, { propertyId: a.id, projectId: roof.id });
    assert.deepEqual(cand.transactions.map((t) => t.description).sort(), ['HOME DEPOT', 'ROOFER DEPOSIT', 'SPLIT LUMBER']);
    assert.equal(cand.transactions.find((t) => t.description === 'SPLIT LUMBER').on_property, true);
    assert.equal(cand.transactions.find((t) => t.description === 'HOME DEPOT').on_property, false);
    assert.deepEqual((await projectCandidates(knex, { propertyId: a.id, search: 'roof' })).transactions.map((t) => t.description), ['ROOFER DEPOSIT']);

    // Link: unassigned → 100% to the property and project; split keeps its amounts; other-property one is skipped.
    const res = await linkProjectTransactions(knex, { id: roof.id }, { ids: [ids['ROOFER DEPOSIT'], ids['SPLIT LUMBER'], ids.ELSEWHERE] });
    assert.equal(res.linked, 2);
    assert.deepEqual(res.skipped.map((s) => s.description), ['ELSEWHERE']);
    const allocs = async (id) => (await knex('transaction_allocations').where({ transaction_id: id }).orderBy('property_id')).map((x) => [x.property_id, Number(x.amount), x.work_order_id]);
    assert.deepEqual(await allocs(ids['ROOFER DEPOSIT']), [[a.id, -900, roof.id]]);
    assert.deepEqual(await allocs(ids['SPLIT LUMBER']), [[a.id, -100, roof.id], [b.id, -100, null]]);
    // The re-upload memory keeps the split with the project on it.
    const saved = await knex('attribution_overrides').where({ dedup_hash: 'SPLIT LUMBER' }).first();
    assert.equal(JSON.parse(saved.allocations_json).rows.find((r) => r.property_id === a.id).work_order_id, roof.id);

    const listed = await listProjectTransactions(knex, { id: roof.id });
    assert.deepEqual(listed.transactions.map((t) => t.description), ['ROOFER DEPOSIT', 'SPLIT LUMBER']);

    // Unlink: off the project, still on the property.
    assert.equal((await unlinkProjectTransactions(knex, { id: roof.id }, { ids: [ids['SPLIT LUMBER']] })).unlinked, 1);
    assert.deepEqual(await allocs(ids['SPLIT LUMBER']), [[a.id, -100, null], [b.id, -100, null]]);
    assert.deepEqual((await listProjectTransactions(knex, { id: roof.id })).transactions.map((t) => t.description), ['ROOFER DEPOSIT']);

    // Same filters as the Transactions page, plus scope.
    const f = (q) => projectCandidates(knex, { propertyId: a.id, projectId: roof.id, ...q }).then((r) => r.transactions.map((t) => t.description).sort());
    assert.deepEqual(await f({ scope: 'unassigned' }), ['HOME DEPOT']);
    assert.deepEqual(await f({ scope: 'property' }), ['SPLIT LUMBER']);
    assert.deepEqual(await f({ year: '2026', months: '5', search: 'depot' }), ['HOME DEPOT']);
    assert.deepEqual(await f({ year: '2025' }), []);
    assert.deepEqual(await f({ source: 'Amex Gold' }), []);
    assert.deepEqual(await f({ group: 'Investments' }), ['HOME DEPOT', 'SPLIT LUMBER']);
    assert.deepEqual(await f({ category: 'Groceries' }), []);
    const facets = (await projectCandidates(knex, { propertyId: a.id })).facets;
    assert.deepEqual([facets.years, facets.sources], [['2026'], ['Bank of America']]);
    assert.ok(facets.groups.find((g) => g.name === 'Investments').categories.includes('Repairs'));

    await assert.rejects(linkProjectTransactions(knex, { id: 9999 }, { ids: [ids['HOME DEPOT']] }), /Project 9999 not found/);
    await assert.rejects(linkProjectTransactions(knex, { id: roof.id }, { ids: [] }), /non-empty "ids"/);
    await assert.rejects(projectCandidates(knex, {}), /propertyId is required/);
  } finally {
    await knex.destroy();
  }
});
