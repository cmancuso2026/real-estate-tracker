// End-to-end API test against an in-memory Postgres (pg-mem) running the REAL
// migrations. Exercises upload -> dedup -> transactions -> summary -> override.
//
// pg-mem can't parse the precision in `decimal(10,2)`, so we pass
// { noAstCoverageCheck: true } — that only relaxes the in-memory double; real
// Postgres (Railway) uses the migrations unchanged.
// pg-mem stores DATE as a timestamp and shifts string bounds by the session
// timezone, dropping boundary days under non-UTC zones. Real Postgres DATE has
// no time component and compares correctly; pin the test process to UTC so the
// in-memory double matches production behavior.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');

test('API integration (pg-mem)', async (t) => {
  const db = newDb({ noAstCoverageCheck: true });
  const knex = db.adapters.createKnex();
  await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });

  const app = require('../server');
  app.locals.db = knex; // inject the in-memory DB

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const getJson = async (p) => (await fetch(`${base}${p}`)).json();
  const uploadFixture = async (file, source) => {
    const buf = fs.readFileSync(path.join(__dirname, 'fixtures', file));
    const fd = new FormData();
    fd.append('file', new Blob([buf]), file);
    fd.append('source', source);
    const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  };

  try {
    await t.test('upload Bank of America', async () => {
      const { status, body } = await uploadFixture('bankofamerica.csv', 'bankofamerica');
      assert.equal(status, 200);
      assert.equal(body.source, 'Bank of America');
      assert.equal(body.total_rows, 7); // parser already dropped the CapOne credit
      assert.equal(body.new_rows, 7);
      assert.equal(body.skipped, 0);
    });

    await t.test('re-uploading the same file inserts nothing (dedup)', async () => {
      const { body } = await uploadFixture('bankofamerica.csv', 'bankofamerica');
      assert.equal(body.new_rows, 0);
      assert.equal(body.skipped, 7);
    });

    await t.test('upload Amex + SoFi', async () => {
      assert.equal((await uploadFixture('amex_gold.csv', 'amex_gold')).body.new_rows, 6);
      assert.equal((await uploadFixture('sofi.csv', 'sofi')).body.new_rows, 5);
    });

    await t.test('GET /api/years and /api/months', async () => {
      const y = await getJson('/api/years');
      assert.deepEqual(y.years, [2026]);
      const m = await getJson('/api/months?year=2026');
      assert.deepEqual(m.months, [1, 4]); // SoFi interest is Jan; everything else April
    });

    await t.test('GET /api/transactions with filters + pagination', async () => {
      const all = await getJson('/api/transactions?year=2026&limit=2000');
      assert.equal(all.total, 18); // 7 + 6 + 5
      assert.equal(all.transactions.length, 18);

      const april = await getJson('/api/transactions?year=2026&months=4');
      assert.equal(april.total, 17); // all but the January interest row

      const food = await getJson('/api/transactions?year=2026&group=Food');
      assert.ok(food.total > 0);
      assert.ok(food.transactions.every((tx) => tx.category_group === 'Food'));

      const search = await getJson('/api/transactions?year=2026&search=publix');
      assert.equal(search.total, 1);

      const page = await getJson('/api/transactions?year=2026&limit=5&offset=0');
      assert.equal(page.transactions.length, 5);
      assert.equal(page.total, 18);
    });

    await t.test('GET /api/summary aggregates and balances', async () => {
      const s = await getJson('/api/summary?year=2026&months=4');
      assert.ok(s.income > 0);
      assert.ok(s.spending > 0);
      assert.equal(Math.round((s.income - s.spending - s.cash_flow) * 100) / 100, 0);
      assert.ok('Food' in s.by_group);
      assert.ok('Groceries' in s.by_category);
      assert.ok(s.by_source['Bank of America'] > 0);
      assert.ok(s.by_month['2026-04']);
    });

    await t.test('GET /api/categories returns the taxonomy', async () => {
      const c = await getJson('/api/categories');
      assert.ok(Array.isArray(c.groups.Food));
      assert.equal(c.cat_to_group.Groceries, 'Food');
    });

    await t.test('PUT category override persists across re-upload', async () => {
      const list = await getJson('/api/transactions?year=2026&search=openai');
      assert.equal(list.total, 1);
      const { id } = list.transactions[0];

      const put = await fetch(`${base}/api/transactions/${id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Gym' }),
      });
      const updated = await put.json();
      assert.equal(updated.category, 'Gym');
      assert.equal(updated.category_group, 'Living'); // server derives group from taxonomy
      assert.equal(updated.is_manual, true);

      // Delete the row, then re-upload — the override must reapply automatically.
      await knex('transactions').where({ id }).del();
      const re = await uploadFixture('amex_gold.csv', 'amex_gold');
      assert.equal(re.body.new_rows, 1); // only the deleted OpenAI row comes back

      const check = await getJson('/api/transactions?year=2026&search=openai');
      assert.equal(check.transactions[0].category, 'Gym');
      assert.equal(check.transactions[0].is_manual, true);
    });

    await t.test('PUT rejects an invalid category', async () => {
      const list = await getJson('/api/transactions?year=2026&search=publix');
      const { id } = list.transactions[0];
      const r = await fetch(`${base}/api/transactions/${id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Nonsense' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('upload with no file returns 400', async () => {
      const fd = new FormData();
      fd.append('source', 'sofi');
      const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
      assert.equal(r.status, 400);
    });
  } finally {
    await new Promise((r) => server.close(r));
    await knex.destroy();
  }
});
