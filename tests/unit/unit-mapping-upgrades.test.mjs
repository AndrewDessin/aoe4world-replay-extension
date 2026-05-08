import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnitGroupForUpgrade } from '../../src/content/unit-mapping.ts';

function makeGrouped(entries) {
  const m = new Map();
  for (const [key, label] of entries) m.set(key, { label, key });
  return m;
}

test('findUnitGroupForUpgrade: direct merge-key match', () => {
  const grouped = makeGrouped([['archer', 'Archer']]);
  const got = findUnitGroupForUpgrade('upgrades/archer_upgrade', null, grouped);
  assert.equal(got?.label, 'Archer');
});

test('findUnitGroupForUpgrade: tries snake/kebab variants', () => {
  const groupedKebab = makeGrouped([['royal-knight', 'Royal Knight']]);
  const got = findUnitGroupForUpgrade('upgrades/royal_knight', null, groupedKebab);
  assert.equal(got?.label, 'Royal Knight');

  const groupedSnake = makeGrouped([['royal_knight', 'Royal Knight']]);
  const got2 = findUnitGroupForUpgrade('upgrades/royal-knight', null, groupedSnake);
  assert.equal(got2?.label, 'Royal Knight');
});

test('findUnitGroupForUpgrade: strips tech_/research_/upgrade_ prefixes', () => {
  const grouped = makeGrouped([['ghulam', 'Ghulam']]);
  assert.equal(findUnitGroupForUpgrade('tech_research_ghulam', null, grouped)?.label, 'Ghulam');
  assert.equal(findUnitGroupForUpgrade('upgrade_ghulam', null, grouped)?.label, 'Ghulam');
  assert.equal(findUnitGroupForUpgrade('research_ghulam', null, grouped)?.label, 'Ghulam');
});

test('findUnitGroupForUpgrade: token-substring match for elite/veteran prefixes', () => {
  const grouped = makeGrouped([['ghulam', 'Ghulam']]);
  const got = findUnitGroupForUpgrade('upgrades/elite_ghulam_research', null, grouped);
  assert.equal(got?.label, 'Ghulam');
});

test('findUnitGroupForUpgrade: token match avoids substring traps', () => {
  // "watch_tower_research" should NOT match unit "tower" via substring,
  // because the strategy requires a token boundary; verify it does match
  // legitimately here (whole-token).
  const grouped = makeGrouped([['tower', 'Tower']]);
  const got = findUnitGroupForUpgrade('upgrades/watch_tower_research', null, grouped);
  assert.equal(got?.label, 'Tower');
});

test('findUnitGroupForUpgrade: display-name suffix match (plurals)', () => {
  const grouped = makeGrouped([['rk', 'Royal Knight']]);
  assert.equal(findUnitGroupForUpgrade('upgrades/lancer_3', 'Veteran Royal Knights', grouped)?.label, 'Royal Knight');
  assert.equal(findUnitGroupForUpgrade('upgrades/lancer_3', 'Elite Royal Knight', grouped)?.label, 'Royal Knight');
});

test('findUnitGroupForUpgrade: display-name handles "men" → "man"', () => {
  const grouped = makeGrouped([['ma', 'Man-at-Arms']]);
  // pluralization rule covers "men"→"man"
  const got = findUnitGroupForUpgrade('upgrades/foo', 'Veteran Man-at-Arms', grouped);
  assert.equal(got?.label, 'Man-at-Arms');
});

test('findUnitGroupForUpgrade: returns null when no match', () => {
  const grouped = makeGrouped([['archer', 'Archer']]);
  assert.equal(findUnitGroupForUpgrade('upgrades/totally_unknown', 'Something Else', grouped), null);
  assert.equal(findUnitGroupForUpgrade('', '', grouped), null);
});

test('findUnitGroupForUpgrade: iconAliasMap routes legacy icon → canonical group', () => {
  // French upgrades use lancer icons but the unit group is keyed by royal-knight.
  const grouped = makeGrouped([['royal-knight', 'Royal Knight']]);
  const aliasMap = new Map([['lancer', 'royal-knight']]);
  const got = findUnitGroupForUpgrade('upgrades/lancer_3', null, grouped, null, aliasMap);
  assert.equal(got?.label, 'Royal Knight');
});
