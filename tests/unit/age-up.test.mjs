import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAgeUps, planAgeUpPlacement, ageUpMarginTopForRows, AGE_UP_DEFAULT_MARGIN,
} from '../../src/content/age-up.ts';

test('extractAgeUps reads analysis.landmarks path and sorts ascending', () => {
  const summary = {
    players: [{
      name: 'P1',
      analysis: { landmarks: [
        { newAge: 3, gameTime: 600 },
        { newAge: 2, gameTime: 240 },
        { newAge: 4, gameTime: 1500 },
      ]},
    }],
  };
  const got = extractAgeUps(summary);
  assert.equal(got.length, 3);
  assert.deepEqual(got.map(a => a.gameTimeSec), [240, 600, 1500]);
  assert.deepEqual(got.map(a => a.label), ['II', 'III', 'IV']);
  assert.equal(got[0].playerName, 'P1');
});

test('extractAgeUps ignores out-of-range ages and bad timestamps', () => {
  const summary = {
    players: [{ analysis: { landmarks: [
      { newAge: 1, gameTime: 60 },
      { newAge: 5, gameTime: 60 },
      { newAge: 2, gameTime: 0 },
      { newAge: 2, gameTime: -10 },
      { newAge: 3, gameTime: 'not a number' },
      { newAge: 2, gameTime: 100 },
    ]}}],
  };
  const got = extractAgeUps(summary);
  assert.equal(got.length, 1);
  assert.equal(got[0].label, 'II');
});

test('extractAgeUps falls back to ageUpTimes M:SS strings', () => {
  const summary = {
    players: [{
      name: 'P2',
      ageUpTimes: { feudalAge: '4:00', castleAge: '10:30', imperialAge: '25:00' },
    }],
  };
  const got = extractAgeUps(summary);
  assert.equal(got.length, 3);
  assert.deepEqual(got.map(a => a.gameTimeSec), [240, 630, 1500]);
  assert.deepEqual(got.map(a => a.label), ['II', 'III', 'IV']);
});

test('extractAgeUps handles empty/missing input', () => {
  assert.deepEqual(extractAgeUps(null), []);
  assert.deepEqual(extractAgeUps({}), []);
  assert.deepEqual(extractAgeUps({ players: [] }), []);
  assert.deepEqual(extractAgeUps({ players: [{ name: 'X' }] }), []);
});

test('extractAgeUps falls through to ageUpTimes when landmarks is empty array', () => {
  // Regression: an empty landmarks array previously short-circuited the
  // ageUpTimes fallback, hiding age-ups when both shapes were present.
  const summary = {
    players: [{
      name: 'P',
      analysis: { landmarks: [] },
      ageUpTimes: { feudalAge: '4:00', castleAge: '10:00' },
    }],
  };
  const got = extractAgeUps(summary);
  assert.equal(got.length, 2);
  assert.equal(got[0].label, 'II');
  assert.equal(got[1].label, 'III');
});

const fakeCtx = (charPx = 8) => ({
  save() {}, restore() {}, font: '',
  measureText: (s) => ({ width: String(s).length * charPx }),
});

test('planAgeUpPlacement returns empty for no input', () => {
  const out = planAgeUpPlacement(fakeCtx(), [], 600, 20, 20, 800, 760);
  assert.deepEqual(out, { items: [], rowCount: 0 });
  const out2 = planAgeUpPlacement(fakeCtx(), [{ gameTimeSec: 100, label: 'II' }], 0, 20, 20, 800, 760);
  assert.deepEqual(out2, { items: [], rowCount: 0 });
});

test('planAgeUpPlacement places non-overlapping ages on row 0', () => {
  const ageUps = [
    { gameTimeSec: 100, label: 'II', color: '#000' },
    { gameTimeSec: 400, label: 'III', color: '#000' },
    { gameTimeSec: 700, label: 'IV', color: '#000' },
  ];
  const { items, rowCount } = planAgeUpPlacement(fakeCtx(), ageUps, 1000, 20, 20, 800, 760);
  assert.equal(items.length, 3);
  assert.equal(rowCount, 1);
  for (const it of items) assert.equal(it.row, 0);
});

test('planAgeUpPlacement stacks colliding labels onto higher rows', () => {
  const ageUps = [
    { gameTimeSec: 500, label: 'II', color: '#a' },
    { gameTimeSec: 500, label: 'II', color: '#b' },
    { gameTimeSec: 500, label: 'II', color: '#c' },
    { gameTimeSec: 500, label: 'II', color: '#d' },
  ];
  const { items, rowCount } = planAgeUpPlacement(fakeCtx(), ageUps, 1000, 20, 20, 800, 760);
  assert.equal(items.length, 4);
  assert.ok(rowCount >= 2, `colliding labels must stack; got rowCount=${rowCount}`);
  const rows = new Set(items.map(i => i.row));
  assert.ok(rows.size >= 2, 'at least two distinct rows used');
});

test('ageUpMarginTopForRows >= floor and grows with row count', () => {
  assert.equal(ageUpMarginTopForRows(0), AGE_UP_DEFAULT_MARGIN);
  assert.equal(ageUpMarginTopForRows(1), AGE_UP_DEFAULT_MARGIN);
  const r3 = ageUpMarginTopForRows(3);
  assert.ok(r3 >= AGE_UP_DEFAULT_MARGIN);
  assert.ok(ageUpMarginTopForRows(5) >= r3, 'monotonically non-decreasing');
});
