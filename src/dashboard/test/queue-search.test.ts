// Needs Property search: description, amount and date in one box, plus ranges.
import test from 'node:test';
import assert from 'node:assert';
import { EMPTY_QUEUE_FILTERS, filterQueue } from '../lib/finance-ui/queueSearch';

const rows = [
  { id: 1, date: '2025-06-12', description: 'LAWNSTARTER', category: 'Lawn Care', amount: -65 },
  { id: 2, date: '2025-07-22', description: 'HOME DEPOT #6321', category: 'Home Depot', amount: -129.83 },
  { id: 3, date: '2026-06-03', description: 'HOME DEPOT #6321', category: 'Home Depot', amount: -65.5 },
  { id: 4, date: '2026-02-09', description: 'FIGURE LENDING PMT', category: 'Other - Home', amount: -1210 },
];
const ids = (q: string, extra = {}) => filterQueue(rows, { ...EMPTY_QUEUE_FILTERS, q, ...extra }).map((r) => r.id);

test('queue search: text, amounts, dates, ranges', () => {
  assert.deepEqual(ids(''), [1, 2, 3, 4]);
  assert.deepEqual(ids('home depot'), [2, 3]);
  assert.deepEqual(ids('lawn care'), [1], 'category text');
  assert.deepEqual(ids('figure'), [4]);
  assert.deepEqual(ids('65'), [1, 3], '65 → $65.00–$65.99');
  assert.deepEqual(ids('$65.00'), [1], 'exact cents');
  assert.deepEqual(ids('-65.5'), [3], 'sign ignored');
  assert.deepEqual(ids('1,210'), [4]);
  assert.deepEqual(ids('6321'), [2, 3], 'a number also matches text');
  assert.deepEqual(ids('2025-06'), [1]);
  assert.deepEqual(ids('2025-07-22'), [2]);
  assert.deepEqual(ids('6/12'), [1]);
  assert.deepEqual(ids('6/3/2026'), [3]);
  assert.deepEqual(ids('jun 12'), [1]);
  assert.deepEqual(ids('June 2026'), [3]);
  assert.deepEqual(ids('june'), [1, 3], 'any June');
  assert.deepEqual(ids('home depot 2026'), [3], 'a year on its own');
  assert.deepEqual(ids('home depot june'), [3]);
  assert.deepEqual(ids('', { from: '2026-01-01' }), [3, 4]);
  assert.deepEqual(ids('', { min: '100', max: '1000' }), [2]);
});
