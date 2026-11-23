// Transactions page: property slicers and where a bulk split starts.
import test from 'node:test';
import assert from 'node:assert';
import { bulkSplitStart, sliceCounts, sliceRows } from '../lib/finance-ui/propertySlicer';
import type { Alloc, Txn } from '../lib/finance-ui/types';

const a = (property_id: number, amount: number, percent: number | null = null): Alloc => ({ property_id, unit_id: null, work_order_id: null, amount, percent, input_mode: 'percent' });
let id = 1;
const tx = (amt: number, allocations: Alloc[], fullyAllocated = allocations.length > 0): Txn => ({
  id: id++, date: '2026-11-01', desc: 'X', src: 'Amex Gold', amt, cat: 'Repairs', manual: false, cleared: false, note: '',
  propertyId: allocations.length === 1 ? allocations[0]!.property_id : null, workOrderId: null, unitId: null, allocations, fullyAllocated, unallocated: null,
});

test('slicers: by property (a split counts for each), not assigned, and assignment type', () => {
  const one = tx(-100, [a(1, -100, 100)]);
  const split = tx(-100, [a(1, -60, 60), a(2, -40, 40)]);
  const partial = tx(-100, [a(2, -50, 50)], false);
  const none = tx(-30, []);
  const rows = [one, split, partial, none];
  assert.deepEqual(sliceRows(rows, '1', '').map((t) => t.id), [one.id, split.id]);
  assert.deepEqual(sliceRows(rows, '2', '').map((t) => t.id), [split.id, partial.id]);
  assert.deepEqual(sliceRows(rows, 'none', '').map((t) => t.id), [none.id]);
  assert.deepEqual(sliceRows(rows, '', 'split').map((t) => t.id), [split.id]);
  assert.deepEqual(sliceRows(rows, '', 'partial').map((t) => t.id), [partial.id]);
  assert.deepEqual(sliceRows(rows, '1', 'single').map((t) => t.id), [one.id]);
  const c = sliceCounts(rows);
  assert.deepEqual([c.none, c.byProperty.get(1), c.byProperty.get(2)], [1, 2, 2]);
});

test('bulk split starts from the split the rows share, else the sliced property at 100%', () => {
  const s1 = tx(-100, [a(1, -60, 60), a(2, -40, 40)]);
  const s2 = tx(-250, [a(1, -150, 60), a(2, -100, 40)]);
  assert.deepEqual(bulkSplitStart([s1, s2], '1').rows.map((r) => [r.property_id, r.value]), [['1', '60'], ['2', '40']]);
  const other = tx(-100, [a(1, -100, 100)]);
  assert.deepEqual(bulkSplitStart([s1, other], '1').rows.map((r) => [r.property_id, r.value]), [['1', '100'], ['', '']]);
});
