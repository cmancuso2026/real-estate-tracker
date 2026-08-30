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
  const s = scoreFromHistory('PUBLIX SUPERMARKET #99', index);
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

test('categorizeWithHistory: fewer than 3 comparable -> Uncategorized (even if unanimous)', () => {
  const index = buildHistoryIndex([
    row('PUBLIX #1', 'Groceries', 'Food'),
    row('PUBLIX #2', 'Groceries', 'Food'),
  ]);
  const r = categorizeWithHistory('PUBLIX #500', '', 'amex_gold', index);
  assert.equal(r.category, 'Uncategorized');
  assert.equal(r.confidence, 1); // reports the (too-thin) vote share
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
  const s = scoreFromHistory('TARGET STORE', index);
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
