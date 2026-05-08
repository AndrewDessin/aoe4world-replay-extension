import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanUnitDisplayName, unitIconSlugFromUrl, unitIconCacheKey,
} from '../../src/content/unit-icons.ts';

test('cleanUnitDisplayName trims, collapses whitespace, rejects numerics', () => {
  assert.equal(cleanUnitDisplayName('   Foo  Bar  '), 'Foo Bar');
  assert.equal(cleanUnitDisplayName('Knight'), 'Knight');
  assert.equal(cleanUnitDisplayName(''), '');
  assert.equal(cleanUnitDisplayName(null), '');
  assert.equal(cleanUnitDisplayName(undefined), '');
  assert.equal(cleanUnitDisplayName('123'), '', 'pure-number is not a name');
  assert.equal(cleanUnitDisplayName('1-2'), '', 'range-of-numbers is not a name');
});

test('unitIconSlugFromUrl strips query, hash, .png, and -age suffix', () => {
  assert.equal(unitIconSlugFromUrl('https://x/units/knight-2.png?v=3'), 'knight');
  assert.equal(unitIconSlugFromUrl('https://x/units/knight-2.png?v=3', false), 'knight-2');
  assert.equal(unitIconSlugFromUrl('https://x/units/knight.png#frag'), 'knight');
  assert.equal(unitIconSlugFromUrl('/path/to/horseman-3.PNG'), 'horseman');
  assert.equal(unitIconSlugFromUrl('archer'), 'archer');
  assert.equal(unitIconSlugFromUrl(''), '');
  assert.equal(unitIconSlugFromUrl(null), '');
});

test('unitIconSlugFromUrl decodes URL-encoded names', () => {
  assert.equal(unitIconSlugFromUrl('https://x/units/elite%20ghulam.png'), 'elite ghulam');
});

test('unitIconCacheKey priority: candidates > iconUrl > icon > label', () => {
  assert.equal(unitIconCacheKey({ iconCandidates: ['a','b'], iconUrl: 'u', icon: 'i', label: 'l' }), 'a,b');
  assert.equal(unitIconCacheKey({ iconUrl: 'u', icon: 'i', label: 'l' }), 'u');
  assert.equal(unitIconCacheKey({ icon: 'i', label: 'l' }), 'i');
  assert.equal(unitIconCacheKey({ label: 'l' }), 'l');
  assert.equal(unitIconCacheKey({}), '');
  assert.equal(unitIconCacheKey(null), '');
});
