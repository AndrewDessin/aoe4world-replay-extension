import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countInRange, RANGE_DRAG_THRESHOLD_PX } from '../../src/content/range.ts';

test('countInRange empty/missing arrays', () => {
  assert.equal(countInRange(null, 0, 100), 0);
  assert.equal(countInRange(undefined, 0, 100), 0);
  assert.equal(countInRange([], 0, 100), 0);
});

test('countInRange inclusive at endpoints', () => {
  const times = [10, 20, 30, 40, 50];
  assert.equal(countInRange(times, 20, 40), 3, '20,30,40 inclusive');
  assert.equal(countInRange(times, 10, 50), 5, 'all');
  assert.equal(countInRange(times, 0, 9), 0, 'before all');
  assert.equal(countInRange(times, 51, 100), 0, 'after all');
  assert.equal(countInRange(times, 25, 25), 0, 'exclusive miss');
  assert.equal(countInRange(times, 30, 30), 1, 'single point');
});

test('countInRange handles duplicates correctly', () => {
  const times = [10, 20, 20, 20, 30];
  assert.equal(countInRange(times, 20, 20), 3);
  assert.equal(countInRange(times, 15, 25), 3);
  assert.equal(countInRange(times, 10, 30), 5);
});

test('countInRange handles single element array', () => {
  assert.equal(countInRange([42], 0, 100), 1);
  assert.equal(countInRange([42], 42, 42), 1);
  assert.equal(countInRange([42], 43, 100), 0);
});

test('RANGE_DRAG_THRESHOLD_PX is positive integer', () => {
  assert.ok(Number.isInteger(RANGE_DRAG_THRESHOLD_PX));
  assert.ok(RANGE_DRAG_THRESHOLD_PX > 0);
});
