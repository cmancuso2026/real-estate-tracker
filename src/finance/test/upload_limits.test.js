// Upload limits on POST /api/finance/upload: at most 20 files, 15 MB each —
// the same limits the Express route had through multer. Multer surfaced them
// as 500s; the Next handler answers 400 with a clear message. Run under tsx.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';

import { startRouteServer } from './helpers/finance-api-server.js';
import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { setFinanceDb } from '../../dashboard/lib/finance.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('upload limits (pg-mem)', async (t) => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  await createTrackerStubs(knex); // tracker tables the finance migrations reference
  await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
  setFinanceDb(knex);
  const server = await startRouteServer();
  const url = `http://127.0.0.1:${server.address().port}/api/finance/upload`;
  const post = async (fd) => {
    const r = await fetch(url, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  };

  try {
    await t.test('more than 20 files → 400, nothing imported', async () => {
      const fd = new FormData();
      for (let i = 0; i < 21; i += 1) fd.append('files', new Blob(['Date,Description,Amount\n']), `f${i}.csv`);
      const { status, body } = await post(fd);
      assert.equal(status, 400);
      assert.match(body.error, /max 20/);
      assert.equal(Number((await knex('upload_log').count({ c: '*' }).first()).c), 0);
    });

    await t.test('a file over 15 MB → 400, nothing imported', async () => {
      const fd = new FormData();
      fd.append('files', new Blob([Buffer.alloc(15 * 1024 * 1024 + 1, 'a')]), 'huge.csv');
      const { status, body } = await post(fd);
      assert.equal(status, 400);
      assert.match(body.error, /File too large: huge\.csv/);
      assert.equal(Number((await knex('upload_log').count({ c: '*' }).first()).c), 0);
    });

    await t.test('a non-multipart request → 400 "No files uploaded"', async () => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /No files uploaded/);
    });
  } finally {
    await new Promise((r) => server.close(r));
    setFinanceDb(null);
    await knex.destroy();
  }
});
