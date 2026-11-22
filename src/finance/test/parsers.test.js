import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { parseFile, parseFileAuto, detectSource } from '../parsers/index.js';
import { fileToRows } from '../parsers/util.js';

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const detect = (name) => detectSource(fileToRows(fixture(name), name));
const byDesc = (rows, needle) => rows.find((r) => r.description.includes(needle));

test('Bank of America: skips CapOne credit, negates debits, skips preamble', () => {
  const { source, transactions } = parseFile(fixture('bankofamerica.csv'), 'bankofamerica.csv', 'bankofamerica');
  assert.equal(source, 'Bank of America');
  assert.equal(transactions.length, 7); // 8 data rows minus 1 Capital One credit
  assert.ok(!transactions.some((t) => /CAPITAL ONE/.test(t.description)), 'CapOne credit skipped');

  const um = byDesc(transactions, 'UM MY CHART');
  assert.equal(um.date, '2026-04-28');
  assert.equal(um.amount, -1430.95); // debit -> negative
  assert.equal(um.source, 'Bank of America');
});

test('Amex: dynamic header skip, sign flip, payment kept as positive offset', () => {
  const { source, transactions } = parseFile(fixture('amex_gold.csv'), 'amex_gold.csv', 'amex_gold');
  assert.equal(source, 'Amex Gold');
  assert.equal(transactions.length, 7); // all 7 data rows, incl. the payment

  const uber = byDesc(transactions, 'UBER EATS');
  assert.equal(uber.date, '2026-04-27');
  assert.equal(uber.amount, -92.87); // positive charge -> negative

  // Card-side bill payment kept: negative Amount flips to a positive offset.
  const payment = byDesc(transactions, 'THANK YOU');
  assert.equal(payment.amount, 382.79);
});

test('SoFi: keeps signed amounts, skips internal transfer, parses ISO dates', () => {
  const { source, transactions } = parseFile(fixture('sofi.csv'), 'sofi.csv', 'sofi');
  assert.equal(source, 'SoFi');
  assert.equal(transactions.length, 5); // 6 data rows minus the SoFi->SoFi transfer
  assert.ok(!transactions.some((t) => /transfer/i.test(t.rawCategory)), 'transfer skipped');

  const paycheck = byDesc(transactions, 'Franchise World');
  assert.equal(paycheck.date, '2026-04-22');
  assert.equal(paycheck.amount, 4267.93); // deposit stays positive
  assert.equal(paycheck.rawCategory, 'Direct Deposit');

  const capone = byDesc(transactions, 'CAPITAL ONE');
  assert.equal(capone.amount, -868.09); // withdrawal stays negative
});

test('Capital One: debit->negative, credit refund->positive, payment kept as offset', () => {
  const { source, transactions } = parseFile(fixture('capitalone.csv'), 'capitalone.csv', 'capitalone');
  assert.equal(source, 'Capital One');
  assert.equal(transactions.length, 5); // all 5 data rows, incl. the Payment/Credit

  const gas = byDesc(transactions, '7-11');
  assert.equal(gas.date, '2026-06-21');
  assert.equal(gas.amount, -31.74); // debit -> negative

  const refund = byDesc(transactions, 'HOME DEPOT');
  assert.equal(refund.amount, 48.05); // credit refund -> positive (comma in description parsed)

  // Card-side bill payment kept: Credit column -> positive offset.
  const payment = byDesc(transactions, 'ONLINE PYMT');
  assert.equal(payment.amount, 2019.45);
  assert.equal(payment.rawCategory, 'Payment/Credit');
});

test('unknown source throws a 400-tagged error', () => {
  assert.throws(() => parseFile(Buffer.from('x'), 'x.csv', 'nope'), /Unknown source/);
});

test('detectSource infers the format from column headers', () => {
  assert.equal(detect('bankofamerica.csv'), 'bankofamerica');
  assert.equal(detect('amex_gold.csv'), 'amex_gold');
  assert.equal(detect('sofi.csv'), 'sofi');
  // Capital One shares BoA's credit-card header but uses ISO dates -> capitalone.
  assert.equal(detect('capitalone.csv'), 'capitalone');
  assert.equal(detectSource([['no', 'matching', 'headers']]), null);
});

test('parseFileAuto parses without being told the source', () => {
  const r = parseFileAuto(fixture('sofi.csv'), 'sofi.csv');
  assert.equal(r.sourceKey, 'sofi');
  assert.equal(r.source, 'SoFi');
  assert.equal(r.transactions.length, 5);
});

test('parseFileAuto throws a 422 when the format is unrecognized', () => {
  const buf = Buffer.from('foo,bar,baz\n1,2,3\n');
  assert.throws(() => parseFileAuto(buf, 'mystery.csv'), /auto-detect/);
});
