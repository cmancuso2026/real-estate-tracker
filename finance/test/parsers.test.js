const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseFile } = require('../parsers');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
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

test('Amex: dynamic header skip, sign flip, payment+thankyou skipped', () => {
  const { source, transactions } = parseFile(fixture('amex_gold.csv'), 'amex_gold.csv', 'amex_gold');
  assert.equal(source, 'Amex Gold');
  assert.equal(transactions.length, 6); // 7 data rows minus the ONLINE PAYMENT - THANK YOU
  assert.ok(!transactions.some((t) => /THANK YOU/i.test(t.description)), 'payment skipped');

  const uber = byDesc(transactions, 'UBER EATS');
  assert.equal(uber.date, '2026-04-27');
  assert.equal(uber.amount, -92.87); // positive charge -> negative
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

test('Capital One: debit->negative, credit refund->positive, skips card payment', () => {
  const { source, transactions } = parseFile(fixture('capitalone.csv'), 'capitalone.csv', 'capitalone');
  assert.equal(source, 'Capital One');
  assert.equal(transactions.length, 4); // 5 data rows minus the Payment/Credit
  assert.ok(!transactions.some((t) => /PAYMENT\/CREDIT/i.test(t.rawCategory)), 'card payment skipped');

  const gas = byDesc(transactions, '7-11');
  assert.equal(gas.date, '2026-06-21');
  assert.equal(gas.amount, -31.74); // debit -> negative

  const refund = byDesc(transactions, 'HOME DEPOT');
  assert.equal(refund.amount, 48.05); // credit refund -> positive (comma in description parsed)
});

test('unknown source throws a 400-tagged error', () => {
  assert.throws(() => parseFile(Buffer.from('x'), 'x.csv', 'nope'), /Unknown source/);
});
