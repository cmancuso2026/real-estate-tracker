// Cash position: daily closing balances from Bank of America checking and
// savings exports, one series per account, total cash across them.
process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';
import { createTrackerStubs } from './helpers/tracker-stubs.js';
import { bofaDepositBalances } from '../parsers/balances.js';
import { processUpload } from '../services/upload.js';
import { cashSummary, getBalances, renameAccount } from '../lib/balances.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = (name) => ({ buffer: fs.readFileSync(path.join(__dirname, 'fixtures', name)), originalname: name });
const bal = (name) => bofaDepositBalances(file(name).buffer, name);

test('reader: closing balance per day, opening balance on the day before, either row order', () => {
  const c = bal('bofa_checking.csv');
  assert.deepEqual(c.begin, { date: '2026-10-01', balance: 5000 });
  assert.equal(c.kind, 'Checking');
  assert.deepEqual(c.points, [
    { date: '2026-09-30', balance: 5000 }, // opening balance = Sep 30 close
    { date: '2026-10-03', balance: 6700 }, // last line of the day
    { date: '2026-10-15', balance: 9200 },
    { date: '2026-10-20', balance: 6200 },
    { date: '2026-11-03', balance: 8050 },
    { date: '2026-11-21', balance: 7050 },
    { date: '2026-11-30', balance: 7050 }, // "Ending balance as of 11/30" from the summary
  ]);
  const d = bal('bofa_checking_dec_newest_first.csv');
  assert.deepEqual(d.points, [
    { date: '2026-11-30', balance: 7050 },
    { date: '2026-12-02', balance: 8900 },
    { date: '2026-12-05', balance: 11350 }, // newest-first file: the day's close is its top line
  ]);
  assert.equal(bal('bofa_savings.csv').kind, 'Savings');
  assert.equal(bal('bankofamerica.csv'), null, 'credit card export has no balances');
});

test('upload: checking and savings kept apart, statements chain in any order, total cash', async () => {
  const knex = newDb({ noAstCoverageCheck: true }).adapters.createKnex();
  try {
    await createTrackerStubs(knex);
    await knex.migrate.latest({ directory: path.join(__dirname, '..', 'db', 'migrations') });
    // Dec checking first (newest), then Oct–Nov checking + Oct savings together
    await processUpload(knex, [file('bofa_checking_dec_newest_first.csv')]);
    const up = await processUpload(knex, [file('bofa_savings.csv'), file('bofa_checking.csv')]);
    assert.ok(up.balances_saved > 0);
    let { accounts, total } = await getBalances(knex);
    assert.deepEqual(accounts.map((a) => [a.account, a.latest]).sort(), [
      ['Checking', { date: '2026-12-05', balance: 11350 }],
      ['Savings', { date: '2026-10-31', balance: 20012.4 }],
    ]);
    assert.deepEqual(total.latest, { date: '2026-12-05', balance: 31362.4 }, 'checking + savings');
    // re-uploading changes nothing
    await processUpload(knex, [file('bofa_checking.csv'), file('bofa_savings.csv')]);
    assert.equal((await getBalances(knex)).accounts.length, 2);
    // rename
    await renameAccount(knex, { from: 'Savings', to: 'BofA Savings' });
    ({ accounts } = await getBalances(knex));
    assert.ok(accounts.some((a) => a.account === 'BofA Savings'));
    await assert.rejects(renameAccount(knex, { from: 'Checking', to: 'BofA Savings' }), /Can't merge/);
    const s = await cashSummary(knex);
    assert.equal(s.latest.balance, 31362.4);
    assert.equal(s.accounts.length, 2);
  } finally {
    await knex.destroy();
  }
});
