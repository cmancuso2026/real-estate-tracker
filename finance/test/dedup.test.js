const test = require('node:test');
const assert = require('node:assert');
const { dedupHash } = require('../lib/dedup');

test('dedupHash is stable and 32 hex chars', () => {
  const h = dedupHash('2026-04-28', 'UM MY CHART BILLING', -1430.95);
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(h, dedupHash('2026-04-28', 'UM MY CHART BILLING', -1430.95));
});

test('dedupHash normalizes description case, outer+inner whitespace, and amount precision', () => {
  const a = dedupHash('2026-04-28', 'um my chart billing', -1430.95);
  const b = dedupHash('2026-04-28', '  UM MY   CHART  BILLING  ', -1430.95);
  assert.equal(a, b);
});

test('dedupHash is source-agnostic: same charge across sources collapses', () => {
  // The same real charge imported from different files/accounts must dedupe.
  const a = dedupHash('2026-10-03', 'DORRIANS RED HAND', -200);
  const b = dedupHash('2026-10-03', 'DORRIANS RED HAND', -200);
  assert.equal(a, b);
});

test('dedupHash differs when date, description, or amount differ', () => {
  const base = dedupHash('2026-04-28', 'X', -10);
  assert.notEqual(base, dedupHash('2026-04-29', 'X', -10));
  assert.notEqual(base, dedupHash('2026-04-28', 'Y', -10));
  assert.notEqual(base, dedupHash('2026-04-28', 'X', -11));
});
