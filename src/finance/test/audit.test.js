// The change log must never fail a save: real Postgres knex.fn.now() values
// hold the connection pool (a circular structure), which broke every single
// property-mapping save in production ("Converting circular structure to JSON").
import test from 'node:test';
import assert from 'node:assert';
import knexFactory from 'knex';
import { safeJson } from '../lib/audit.js';

test('change-log JSON survives SQL expressions and circular values', async () => {
  const knex = knexFactory({ client: 'pg', connection: 'postgresql://unused@127.0.0.1:1/none', pool: { min: 0, max: 1 } });
  try {
    const loop = { a: 1 };
    loop.self = loop;
    const out = JSON.parse(safeJson({ category: '529', property_id: null, updated_at: knex.fn.now(), loop }));
    assert.deepEqual(out, { category: '529', property_id: null, updated_at: 'now()', loop: { a: 1 } });
  } finally {
    await knex.destroy();
  }
});
