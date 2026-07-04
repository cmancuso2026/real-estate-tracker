const test = require('node:test');
const assert = require('node:assert');
const { dedupHash } = require('../lib/dedup');

test('dedupHash is stable and 32 hex chars', () => {
  const h = dedupHash('2026-04-28', 'UM MY CHART BILLING', -1430.95, 'Bank of America');
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(h, dedupHash('2026-04-28', 'UM MY CHART BILLING', -1430.95, 'Bank of America'));
});

test('dedupHash normalizes description case/whitespace and amount precision', () => {
  const a = dedupHash('2026-04-28', 'um my chart billing', -1430.95, 'Bank of America');
  const b = dedupHash('2026-04-28', '  UM MY CHART BILLING  ', -1430.9500, 'Bank of America');
  assert.equal(a, b);
});

test('dedupHash differs when any field differs', () => {
  const base = dedupHash('2026-04-28', 'X', -10, 'SoFi');
  assert.notEqual(base, dedupHash('2026-04-29', 'X', -10, 'SoFi'));
  assert.notEqual(base, dedupHash('2026-04-28', 'Y', -10, 'SoFi'));
  assert.notEqual(base, dedupHash('2026-04-28', 'X', -11, 'SoFi'));
  assert.notEqual(base, dedupHash('2026-04-28', 'X', -10, 'Amex Gold'));
});
