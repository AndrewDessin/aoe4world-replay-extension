import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validColor, civsOverlap, parseCssColor, shadeColor,
  lookupReplayColorIndex, playerColor,
  PLAYER_COLORS, AOE4_PLAYER_COLOR_HEX,
} from '../../src/content/colors.ts';

test('validColor accepts 0..7, rejects rest', () => {
  for (let i = 0; i < 8; i++) assert.equal(validColor(i), true, `${i} should be valid`);
  assert.equal(validColor(-1), false);
  assert.equal(validColor(8), false);
  assert.equal(validColor(1.5), false);
  assert.equal(validColor('3'), false);
  assert.equal(validColor(null), false);
  assert.equal(validColor(undefined), false);
});

test('civsOverlap matches prefix and _ha_ variants', () => {
  assert.equal(civsOverlap('french', 'french_ha_kni'), true);
  assert.equal(civsOverlap('french_ha_kni', 'french'), true);
  assert.equal(civsOverlap('english', 'french'), false);
  assert.equal(civsOverlap('japanese_ha_sen', 'japanese_ha_sho'), true);
  assert.equal(civsOverlap('chinese', 'chinese'), true);
});

test('parseCssColor handles rgb, hex3, hex6, garbage', () => {
  assert.deepEqual(parseCssColor('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.deepEqual(parseCssColor('rgba(10,20,30,0.5)'), [10, 20, 30]);
  assert.deepEqual(parseCssColor('#abc'), [170, 187, 204]);
  assert.deepEqual(parseCssColor('#aabbcc'), [170, 187, 204]);
  assert.deepEqual(parseCssColor('not-a-color'), [77, 171, 247]);
});

test('shadeColor clamps to [24,245] and is unchanged at total=1', () => {
  const unchanged = shadeColor('#7f7f7f', 0, 1);
  assert.equal(unchanged, '#7f7f7f');
  const stops = [0,1,2,3,4].map(i => shadeColor('#7f7f7f', i, 5));
  assert.equal(new Set(stops).size, 5, 'distinct shades');
  for (const c of stops) {
    const [r,g,b] = parseCssColor(c);
    for (const v of [r,g,b]) {
      assert.ok(v >= 24 && v <= 245, `${c} channel ${v} should be in [24,245]`);
    }
  }
});

test('lookupReplayColorIndex prefers name+civ, then unique name, then slot', () => {
  const summary = {
    _aoe4ReplayPlayers: [
      { name: 'Spartain', civilization: 'french', color: 0, slot: 0 },
      { name: 'Slynk', civilization: 'english', color: 1, slot: 1 },
    ],
  };
  assert.equal(lookupReplayColorIndex(summary, { name: 'Spartain', civilizationAttrib: 'french' }, 0), 0);
  assert.equal(lookupReplayColorIndex(summary, { name: 'Slynk', civilizationAttrib: 'english' }, 1), 1);
  assert.equal(lookupReplayColorIndex(summary, { name: 'Spartain', civilizationAttrib: 'knights_templar' }, 0), 0);
  assert.equal(lookupReplayColorIndex({}, { name: 'X' }, 0), null);
  assert.equal(lookupReplayColorIndex(null, { name: 'X' }, 0), null);
});

test('playerColor falls back to native then PLAYER_COLORS', () => {
  const summary = {
    _aoe4ReplayPlayers: [{ name: 'A', civilization: 'french', color: 2, slot: 0 }],
  };
  assert.equal(playerColor(summary, { name: 'A', civilizationAttrib: 'french' }, 0), AOE4_PLAYER_COLOR_HEX[2]);
  const native = new Map([['b', '#abcdef']]);
  assert.equal(playerColor({}, { name: 'B' }, 1, native), '#abcdef');
  assert.equal(playerColor({}, { name: 'C' }, 0), PLAYER_COLORS[0]);
  assert.equal(playerColor({}, { name: 'C' }, 9), PLAYER_COLORS[1]);
});
