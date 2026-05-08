import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  niceCeilForChart, niceFloorForChart, niceGeometryForChart,
  summaryScaleX, summaryScaleY, formatGameTime, titleCase,
} from '../../src/content/canvas-geom.ts';

test('niceCeilForChart returns 1 for non-positive/non-finite', () => {
  assert.equal(niceCeilForChart(0), 1);
  assert.equal(niceCeilForChart(-5), 1);
  assert.equal(niceCeilForChart(NaN), 1);
  assert.equal(niceCeilForChart(Infinity), 1);
  assert.equal(niceCeilForChart(null), 1);
});

test('niceCeilForChart rounds up to a "nice" multiple', () => {
  assert.ok(niceCeilForChart(12) >= 12);
  assert.ok(niceCeilForChart(1234) >= 1234);
  assert.ok(niceCeilForChart(0.05) >= 0.05);
  // Small-enough ratio - should not over-shoot wildly
  assert.ok(niceCeilForChart(100) <= 200, 'shouldn\'t double the input');
});

test('niceFloorForChart handles negatives via mirror', () => {
  assert.equal(niceFloorForChart(0), 0);
  assert.equal(niceFloorForChart(50), 50);
  assert.ok(niceFloorForChart(-50) <= -50, 'negative floor goes lower');
  assert.equal(niceFloorForChart(NaN), 0);
});

test('niceGeometryForChart lead is symmetric around zero', () => {
  const g = niceGeometryForChart('lead', -3, 7);
  assert.equal(g.yMin, -g.yMax, 'lead chart symmetric');
  assert.ok(g.yMax >= 7);
});

test('niceGeometryForChart non-lead nice-rounds floor and ceil', () => {
  const g = niceGeometryForChart('army', 0, 100);
  assert.equal(g.yMin, 0);
  assert.ok(g.yMax >= 100);
});

test('niceGeometryForChart lead handles all-zero input', () => {
  const g = niceGeometryForChart('lead', 0, 0);
  assert.ok(g.yMax > 0, 'still produces non-degenerate axis');
  assert.equal(g.yMin, -g.yMax);
});

test('summaryScaleX/Y guard division-by-zero', () => {
  const margin = { top: 10, left: 20 };
  assert.equal(summaryScaleX(0, 1, margin, 100), 20, 'count=1 returns left edge');
  assert.equal(summaryScaleX(0, 5, margin, 100), 20);
  assert.equal(summaryScaleX(4, 5, margin, 100), 120);
  // yMin === yMax → no NaN
  const y = summaryScaleY(5, 5, 5, margin, 100);
  assert.ok(Number.isFinite(y));
});

test('formatGameTime renders M:SS', () => {
  assert.equal(formatGameTime(0), '0:00');
  assert.equal(formatGameTime(75), '1:15');
  assert.equal(formatGameTime(3661), '61:01');
  assert.equal(formatGameTime(-5), '0:00', 'negative clamped');
});

test('titleCase capitalises each word', () => {
  assert.equal(titleCase('hello world'), 'Hello World');
  assert.equal(titleCase('ROYAL knight'), 'Royal Knight');
  assert.equal(titleCase('camelCase'), 'Camelcase');
  assert.equal(titleCase(''), '');
});
