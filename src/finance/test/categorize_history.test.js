const test = require('node:test');
const assert = require('node:assert');
const {
  buildHistoryIndex,
  scoreFromHistory,
  categorizeWithHistory,
  normalizeTokens,
  jaccard,
} = require('../lib/categorize');

// Helper: a historical row.
const row = (description, category, category_group, is_manual = false) => ({
  description,
  category,
  category_group,
  is_manual,
});

test('normalizeTokens strips digits/special chars, uppercases, drops 1-char tokens', () => {
  assert.deepEqual(normalizeTokens('PUBLIX #1236'), ['PUBLIX']);
  assert.deepEqual(normalizeTokens('The Home Depot #6322'), ['THE', 'HOME', 'DEPOT']);
  assert.deepEqual(normalizeTokens('DD *DOORDASH SHOKUDO'), ['DD', 'DOORDASH', 'SHOKUDO']);
});

test('jaccard is 1 for identical token sets and 0 for disjoint', () => {
  const a = new Set(['HOME', 'DEPOT']);
  assert.equal(jaccard(a, new Set(['HOME', 'DEPOT'])), 1);
  assert.equal(jaccard(a, new Set(['PUBLIX'])), 0);
  assert.equal(jaccard(new Set(), a), 0);
});

test('normalizeTokens strips ACH addenda, keeping just the originator name', () => {
  assert.deepEqual(
    normalizeTokens('Franchise World DES:PAYROLL ID:CER000752935963 INDN:Cole Mancuso CO ID:138 PPD'),
    ['FRANCHISE', 'WORLD'],
  );
  assert.deepEqual(normalizeTokens('FRANCHISE WORLD DES:9958611334 ID:995861 INDN:COLE MANC'), [
    'FRANCHISE',
    'WORLD',
  ]);
  // A legit name that merely starts with an addenda-looking word must survive.
  assert.deepEqual(normalizeTokens('WEBSTER BANK PAYMENT'), ['WEBSTER', 'BANK', 'PAYMENT']);
});

test('normalizeTokens merges possessive apostrophes (McDonald\'s == McDonalds)', () => {
  assert.deepEqual(normalizeTokens("McDonald's F123 Miami FL"), ['MCDONALDS', 'MIAMI', 'FL']);
  assert.deepEqual(normalizeTokens('McDonalds'), ['MCDONALDS']);
});

test('categorizeWithHistory: verbose ACH payroll line inherits from clean merchant history', () => {
  // 3 clean "Franchise World" paychecks (SoFi) + 1 verbose BoA one; a new verbose
  // BoA line must learn Paycheck (ACH addenda stripped to FRANCHISE WORLD), not
  // fall to Uncategorized.
  const index = buildHistoryIndex([
    row('Franchise World', 'Paycheck', 'W2 Income'),
    row('Franchise World', 'Paycheck', 'W2 Income'),
    row('Franchise World', 'Paycheck', 'W2 Income'),
    row('Franchise World DES:PAYROLL ID:CER111 INDN:Cole Mancuso CO ID:138 PPD', 'Paycheck', 'W2 Income', true),
  ]);
  const r = categorizeWithHistory(
    'Franchise World DES:PAYROLL ID:CER999 INDN:Cole Mancuso CO ID:138 PPD',
    '',
    'Bank of America',
    index,
  );
  assert.equal(r.category, 'Paycheck');
  assert.equal(r.group, 'W2 Income');
  assert.equal(r.confidence, 1);
});

test('scoreFromHistory: IDF ignores generic tokens, matches on the distinctive one', () => {
  // Many Apple Pay charges in Miami across categories make APLPAY/MIAMI/FL
  // ubiquitous; a Starbucks query must match only the Starbucks rows, not the
  // dozen other "AplPay … Miami FL" charges that share 3 of 4 tokens.
  const rows = [];
  for (let i = 0; i < 6; i += 1) rows.push(row(`AplPay Publix ${i} Miami FL`, 'Groceries', 'Food'));
  for (let i = 0; i < 6; i += 1) rows.push(row(`AplPay Shell ${i} Miami FL`, 'Gas', 'Travel'));
  for (let i = 0; i < 3; i += 1) rows.push(row(`AplPay Starbucks ${i} Miami FL`, 'Eating Out', 'Food'));
  const index = buildHistoryIndex(rows);
  const s = scoreFromHistory('AplPay Starbucks 999 Miami FL', index);
  assert.equal(s.comparable, 3); // only the Starbucks rows
  assert.equal(s.category, 'Eating Out');
  assert.equal(s.confidence, 1);
});

test('scoreFromHistory: keys off the merchant token, not a shared location', () => {
  // Publix and McDonald's both in "North Miami FL": the Publix query must match
  // only Publix, not get diluted by McDonald's sharing NORTH/MIAMI/FL.
  const rows = [];
  for (let i = 0; i < 4; i += 1) rows.push(row(`Publix ${i} North Miami FL`, 'Groceries', 'Food'));
  for (let i = 0; i < 4; i += 1) rows.push(row(`McDonalds ${i} North Miami FL`, 'Eating Out', 'Food'));
  const index = buildHistoryIndex(rows);
  const s = scoreFromHistory('Publix 99 North Miami FL', index);
  assert.equal(s.comparable, 4); // only the Publix rows
  assert.equal(s.category, 'Groceries');
  assert.equal(s.confidence, 1);
});

test('buildHistoryIndex drops Uncategorized and empty-token rows, weights manual 2x', () => {
  const index = buildHistoryIndex([
    row('PUBLIX #1', 'Groceries', 'Food', false),
    row('PUBLIX #2', 'Groceries', 'Food', true), // manual -> weight 2
    row('SOMETHING', 'Uncategorized', 'Other'), // dropped: no signal
    row('###', 'Groceries', 'Food'), // dropped: no usable tokens
  ]);
  assert.equal(index.length, 2);
  assert.equal(index[0].weight, 1);
  assert.equal(index[1].weight, 2);
});

test('scoreFromHistory: unanimous vote yields confidence 1', () => {
  const index = buildHistoryIndex([
    row('PUBLIX #1', 'Groceries', 'Food'),
    row('PUBLIX #2', 'Groceries', 'Food'),
    row('PUBLIX #3', 'Groceries', 'Food'),
  ]);
  const s = scoreFromHistory('PUBLIX #99', index);
  assert.equal(s.comparable, 3);
  assert.equal(s.category, 'Groceries');
  assert.equal(s.group, 'Food');
  assert.equal(s.confidence, 1);
});

test('categorizeWithHistory: >=3 comparable + unanimous -> confident, is_manual stays false', () => {
  const index = buildHistoryIndex([
    row('PUBLIX #1', 'Groceries', 'Food'),
    row('PUBLIX #2', 'Groceries', 'Food'),
    row('PUBLIX #3', 'Groceries', 'Food'),
  ]);
  const r = categorizeWithHistory('PUBLIX #500', '', 'amex_gold', index);
  assert.equal(r.category, 'Groceries');
  assert.equal(r.group, 'Food');
  assert.equal(r.confidence, 1);
});

test('categorizeWithHistory: two AUTO matches is too little evidence -> Uncategorized', () => {
  const index = buildHistoryIndex([
    row('PUBLIX #1', 'Groceries', 'Food'), // auto -> weight 1
    row('PUBLIX #2', 'Groceries', 'Food'), // auto -> weight 1 (total 2 < MIN_EVIDENCE 3)
  ]);
  const r = categorizeWithHistory('PUBLIX #500', '', 'amex_gold', index);
  assert.equal(r.category, 'Uncategorized');
  assert.equal(r.confidence, 1); // reports the (too-thin) vote share
});

test('categorizeWithHistory: two MANUAL matches are enough evidence -> categorized', () => {
  // Mirrors the real "SP BOBBIE" case: user manually labeled the merchant twice;
  // weight 2+2 = 4 clears MIN_EVIDENCE, so the third occurrence auto-applies.
  const index = buildHistoryIndex([
    row('SP BOBBIE SAN FRANCISCO CA', 'Baby Gear', 'Baby', true),
    row('SP BOBBIE SAN FRANCISCO CA', 'Baby Gear', 'Baby', true),
  ]);
  const r = categorizeWithHistory('SP BOBBIE SAN FRANCISCO CA', '', 'amex_gold', index);
  assert.equal(r.category, 'Baby Gear');
  assert.equal(r.group, 'Baby');
  assert.equal(r.confidence, 1);
});

// Digit-only suffixes normalize away, so every row shares the token {PUBLIX}
// and all count as comparable to the query.
test('categorizeWithHistory: split vote at/under 90% -> Uncategorized', () => {
  const rows = [];
  for (let i = 0; i < 9; i += 1) rows.push(row(`PUBLIX ${i}`, 'Groceries', 'Food'));
  rows.push(row('PUBLIX 99', 'Shopping', 'Living')); // 9/10 = 0.9 exactly, not > 0.9
  const index = buildHistoryIndex(rows);
  const r = categorizeWithHistory('PUBLIX 500', '', 'amex_gold', index);
  assert.equal(r.category, 'Uncategorized');
  assert.equal(Math.round(r.confidence * 100) / 100, 0.9);
});

test('categorizeWithHistory: clear majority above 90% wins', () => {
  const rows = [];
  for (let i = 0; i < 19; i += 1) rows.push(row(`PUBLIX ${i}`, 'Groceries', 'Food'));
  rows.push(row('PUBLIX 99', 'Shopping', 'Living')); // 19/20 = 0.95
  const index = buildHistoryIndex(rows);
  const r = categorizeWithHistory('PUBLIX 500', '', 'amex_gold', index);
  assert.equal(r.category, 'Groceries');
  assert.equal(r.confidence, 0.95);
});

test('categorizeWithHistory: manual rows count double in the vote', () => {
  // 2 manual Shopping (weight 4) vs 3 auto Groceries (weight 3): Shopping wins.
  const index = buildHistoryIndex([
    row('TARGET 1', 'Groceries', 'Food', false),
    row('TARGET 2', 'Groceries', 'Food', false),
    row('TARGET 3', 'Groceries', 'Food', false),
    row('TARGET 4', 'Shopping', 'Living', true),
    row('TARGET 5', 'Shopping', 'Living', true),
  ]);
  const s = scoreFromHistory('TARGET #9', index);
  assert.equal(s.category, 'Shopping');
  assert.equal(s.comparable, 5);
});

test('categorizeWithHistory: zero history matches -> hardcoded rule fallback, confidence null', () => {
  const index = buildHistoryIndex([row('PUBLIX #1', 'Groceries', 'Food')]);
  const r = categorizeWithHistory('WILD FORK FOODS', '', 'amex_gold', index);
  assert.equal(r.category, 'Groceries'); // from amex rules
  assert.equal(r.group, 'Food');
  assert.equal(r.confidence, null);
});

test('categorizeWithHistory: empty history -> rule fallback', () => {
  const r = categorizeWithHistory('CAPITAL ONE ONLINE PYMT', '', 'bankofamerica', []);
  assert.equal(r.category, 'Capital One');
  assert.equal(r.group, 'Financials');
  assert.equal(r.confidence, null);
});
