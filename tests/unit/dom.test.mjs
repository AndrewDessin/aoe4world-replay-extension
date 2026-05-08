import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGameIdFromUrl, parseTimeToSeconds, escapeHtml, normalizeName } from '../../src/content/dom.ts';

test('getGameIdFromUrl extracts game id from detail URLs', () => {
  assert.equal(getGameIdFromUrl('https://aoe4world.com/players/883212-Spartain/games/230521696'), '230521696');
  assert.equal(getGameIdFromUrl('https://aoe4world.com/players/123/games/4567'), '4567');
  assert.equal(getGameIdFromUrl('/players/883212-Spartain/games/230521696?sig=x'), '230521696');
});

test('getGameIdFromUrl returns null for non-game URLs', () => {
  assert.equal(getGameIdFromUrl('https://aoe4world.com/players/883212-Spartain'), null);
  assert.equal(getGameIdFromUrl('https://aoe4world.com/leaderboard'), null);
  assert.equal(getGameIdFromUrl(''), null);
  assert.equal(getGameIdFromUrl(null), null);
  assert.equal(getGameIdFromUrl(undefined), null);
});

test('parseTimeToSeconds parses M:SS and MM:SS', () => {
  assert.equal(parseTimeToSeconds('12:34'), 754);
  assert.equal(parseTimeToSeconds('0:00'), 0);
  assert.equal(parseTimeToSeconds('5:07'), 307);
  assert.equal(parseTimeToSeconds('99:59'), 5999);
});

test('parseTimeToSeconds rejects bad input', () => {
  assert.equal(parseTimeToSeconds('abc'), null);
  assert.equal(parseTimeToSeconds('1:2:3'), null);
  assert.equal(parseTimeToSeconds(null), null);
  assert.equal(parseTimeToSeconds(undefined), null);
  assert.equal(parseTimeToSeconds(123), null);
  assert.equal(parseTimeToSeconds(''), null);
});

test('escapeHtml escapes the 5 entities', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("o'connor"), 'o&#39;connor');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(123), '123');
});

test('normalizeName trims and lowercases, null-safe', () => {
  assert.equal(normalizeName('  HELLO  '), 'hello');
  assert.equal(normalizeName('Spartain'), 'spartain');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(undefined), '');
  assert.equal(normalizeName(0), '');
});
