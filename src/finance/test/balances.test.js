// Cash position: daily closing balances from Bank of America checking exports.
process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';
import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { bofaCheckingBalances } from '../parsers/balances.js';
import { processUpload } from '../services/upload.js';
import { cashSummary, getBalances } from '../lib/balances.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = (name) => ({ buffer: fs.readFileSync(path.join(__dirname, 'fixtures', name)), originalname: name });

test('BofA checking export → one closing balance per day; other files → none', () => {
  const b = bofaCheckingBalances(file('bofa_checking.csv').buffer, 'bofa_checking.csv');
  assert.deepEqual(b, [
    { date: '2026-10-01', balance: 5000 },
    { date: '2026-10-03', balance: 6700 }, // last row of the day
    { date: '2026-10-15', balance: 9200 },
    { date: '2026-10-20', balance: 6200 },
    { date: '2026-11-03', balance: 8050 },
    { date: '2026-11-21', balance: 7050 },
  ]);
  assert.deepEqual(bofaCheckingBalances(file('bankofamerica.csv').buffer, 'bankofamerica.csv'), [], 'credit card export has no balance');
  assert.deepEqual(bofaCheckingBalances(file('amex_gold.csv').buffer, 'amex_gold.csv'), []);
});

test('upload saves balances (re-upload replaces), summaries for the pages', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    const up = await processUpload(knex, [file('bofa_checking.csv'), file('amex_gold.csv')]);
    assert.equal(up.balances_saved, 6);
    assert.equal(up.new_rows > 0, true);
    const again = await processUpload(knex, [file('bofa_checking.csv')]);
    assert.equal(again.new_rows, 0, 'transactions dedup as before');
    assert.equal((await knex('account_balances').count({ c: '*' }).first()).c, 6, 'balances replaced, not duplicated');
    const { accounts } = await getBalances(knex);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].account, 'Bank of America checking');
    assert.deepEqual(accounts[0].latest, { date: '2026-11-21', balance: 7050 });
    assert.deepEqual(accounts[0].month_ends, [{ month: '2026-10', balance: 6200 }, { month: '2026-11', balance: 7050 }]);
    const [s] = await cashSummary(knex);
    assert.equal(s.change_30d, 7050 - 6200, 'vs the balance in force 30 days before (Oct 22)');
    assert.equal(s.change_ytd, 7050 - 5000, 'history starts this year → vs the first balance of the year');
  } finally {
    await knex.destroy();
  }
});
