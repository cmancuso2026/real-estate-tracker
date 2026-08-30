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
      assert.equal((await uploadFixture('amex_gold.csv', 'amex_gold')).body.new_rows, 7);
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
      assert.equal(all.total, 19); // 7 + 7 + 5
      assert.equal(all.transactions.length, 19);

      const april = await getJson('/api/transactions?year=2026&months=4');
      assert.equal(april.total, 18); // all but the January interest row

      const food = await getJson('/api/transactions?year=2026&group=Food');
      assert.ok(food.total > 0);
      assert.ok(food.transactions.every((tx) => tx.category_group === 'Food'));

      const search = await getJson('/api/transactions?year=2026&search=publix');
      assert.equal(search.total, 1);

      const page = await getJson('/api/transactions?year=2026&limit=5&offset=0');
      assert.equal(page.transactions.length, 5);
      assert.equal(page.total, 19);
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

    await t.test('POST /api/categories adds a custom category and it is assignable', async () => {
      const post = await fetch(`${base}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Coffee', group: 'Food' }),
      });
      assert.equal(post.status, 201);
      const tax = await post.json();
      assert.ok(tax.groups.Food.includes('Coffee'));
      assert.equal(tax.cat_to_group.Coffee, 'Food');

      // The new category must now be assignable to a transaction.
      const list = await getJson('/api/transactions?year=2026&search=publix');
      const { id } = list.transactions[0];
      const put = await fetch(`${base}/api/transactions/${id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Coffee' }),
      });
      const updated = await put.json();
      assert.equal(updated.category, 'Coffee');
      assert.equal(updated.category_group, 'Food'); // group resolved from custom_categories
    });

    await t.test('POST /api/categories rejects bad input', async () => {
      const badGroup = await fetch(`${base}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nope', group: 'NotAGroup' }),
      });
      assert.equal(badGroup.status, 400);

      const dup = await fetch(`${base}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Groceries', group: 'Food' }), // built-in dup
      });
      assert.equal(dup.status, 400);

      const noName = await fetch(`${base}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  ', group: 'Food' }),
      });
      assert.equal(noName.status, 400);
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

    await t.test('PUT bulk-category updates many rows and persists overrides', async () => {
      const list = await getJson('/api/transactions?year=2026');
      const ids = list.transactions.slice(0, 3).map((r) => r.id);
      assert.equal(ids.length, 3);

      const put = await fetch(`${base}/api/transactions/bulk-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, category: 'Eating Out' }),
      });
      const result = await put.json();
      assert.equal(result.updated, 3);
      assert.equal(result.category_group, 'Food'); // derived server-side

      for (const id of ids) {
        const row = await knex('transactions').where({ id }).first();
        assert.equal(row.category, 'Eating Out');
        assert.equal(row.category_group, 'Food');
        assert.equal(!!row.is_manual, true);
        const ov = await knex('category_overrides').where({ dedup_hash: row.dedup_hash }).first();
        assert.equal(ov.category, 'Eating Out'); // override persisted for re-uploads
      }
    });

    await t.test('PUT bulk-category rejects bad input', async () => {
      const noIds = await fetch(`${base}/api/transactions/bulk-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [], category: 'Eating Out' }),
      });
      assert.equal(noIds.status, 400);

      const badCat = await fetch(`${base}/api/transactions/bulk-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [1], category: 'Nonsense' }),
      });
      assert.equal(badCat.status, 400);
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

    await t.test('POST /recategorize learns from history for uncategorized rows', async () => {
      // Seed 3 confidently-categorized "SPROUTS" rows + 1 uncategorized SPROUTS.
      const seed = (n, category, category_group, isManual = false) => ({
        date: '2026-05-01',
        description: `SPROUTS MARKET #${n}`,
        amount: -20,
        source: 'Amex Gold',
        category,
        category_group,
        is_manual: isManual,
        dedup_hash: `recat-test-${n}`,
      });
      await knex('transactions').insert([
        seed(1, 'Groceries', 'Food'),
        seed(2, 'Groceries', 'Food'),
        seed(3, 'Groceries', 'Food', true), // manual, extra weight
        seed(4, 'Uncategorized', 'Other'), // the target to re-run
      ]);

      const r = await fetch(`${base}/api/transactions/recategorize`, { method: 'POST' });
      const body = await r.json();
      assert.equal(r.status, 200);
      assert.ok(body.updated >= 1);

      const target = await knex('transactions').where({ dedup_hash: 'recat-test-4' }).first();
      assert.equal(target.category, 'Groceries');
      assert.equal(target.category_group, 'Food');
      assert.equal(!!target.is_manual, false); // auto, not manual
      assert.equal(Number(target.confidence_score), 1); // unanimous vote

      // A manual override must never be clobbered by re-run.
      await knex('transactions').insert(seed(5, 'Shopping', 'Living', true));
      await knex('transactions')
        .where({ dedup_hash: 'recat-test-5' })
        .update({ category: 'Shopping', category_group: 'Living', is_manual: true });
      await fetch(`${base}/api/transactions/recategorize`, { method: 'POST' });
      const kept = await knex('transactions').where({ dedup_hash: 'recat-test-5' }).first();
      assert.equal(kept.category, 'Shopping');
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
