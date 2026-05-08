import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitLabel,
  unitLabelBase,
  unitIconCandidates,
  unitAlias,
  findUnitGroupForUpgrade,
} from '../../src/content/unit-mapping.ts';
import {
  pbgidUnitsMap,
  pbgidTechsMap,
  pbgidUpgradesMap,
} from '../../src/content/pbgid-map.ts';
import { unitDataIndex } from '../../src/content/unit-data-cache.ts';


test('unitAlias returns Royal Knight for French lancer', () => {
  const alias = unitAlias('units/lancer_3', { civilizationAttrib: 'french' });
  assert.deepStrictEqual(alias, { displayName: 'Royal Knight', slugs: ['royal-knight-2'] });
});

test('unitAlias returns Royal Knight for bare lancer icon (French)', () => {
  const alias = unitAlias('units/lancer', { civilizationAttrib: 'french' });
  assert.deepStrictEqual(alias, { displayName: 'Royal Knight', slugs: ['royal-knight-2'] });
});

test('unitAlias returns null for non-French', () => {
  assert.equal(unitAlias('units/lancer_3', { civilizationAttrib: 'english' }), null);
  assert.equal(unitAlias('units/knight', { civilizationAttrib: 'french' }), null);
  assert.equal(unitAlias('units/lancer_3', null), null);
  assert.equal(unitAlias(null, null), null);
});


test('unitIconCandidates returns fallback chain for basic icon', () => {
  const candidates = unitIconCandidates('units/knight_3', null, null, null);
  assert.ok(candidates.length > 0, 'should return at least one candidate');
  assert.ok(candidates.some(c => c.includes('knight')), 'should include knight slug');
  assert.ok(candidates.some(c => c.includes('/knight-3.png')), 'should try age-3 variant');
  assert.ok(candidates.some(c => c.includes('/knight-1.png')), 'should include age-1 fallback');
});

test('unitIconCandidates handles horseman special case', () => {
  const candidates = unitIconCandidates('units/horseman', null, null, null);
  assert.ok(candidates.some(c => c.includes('/horseman-1.png')));
});

test('unitIconCandidates handles spearman special case', () => {
  const candidates = unitIconCandidates('units/spearman', null, null, null);
  assert.ok(candidates.some(c => c.includes('/spearman-1.png')));
});

test('unitIconCandidates handles chierosiphon special case', () => {
  const candidates = unitIconCandidates('units/chierosiphon', null, null, null);
  assert.ok(candidates.some(c => c.includes('cheirosiphon-3.png')));
});

test('unitIconCandidates handles war-elephant special case', () => {
  const candidates = unitIconCandidates('units/war_elephant', null, null, null);
  assert.ok(candidates.some(c => c.includes('war-elephant-3.png')));
});

test('unitIconCandidates handles elephant_raider rename', () => {
  const candidates = unitIconCandidates('units/elephant_raider', null, null, null);
  assert.ok(candidates.some(c => c.includes('raider-elephant')));
});

test('unitIconCandidates includes French lancer alias slugs', () => {
  const candidates = unitIconCandidates('units/lancer_3', null, { civilizationAttrib: 'french' }, null);
  assert.ok(candidates.some(c => c.includes('royal-knight-2.png')));
});

test('unitIconCandidates deduplicates entries', () => {
  const candidates = unitIconCandidates('units/archer', null, null, null);
  const unique = new Set(candidates);
  assert.equal(candidates.length, unique.size, 'should have no duplicates');
});

test('unitIconCandidates adds hyphenated variants for underscored filenames', () => {
  const candidates = unitIconCandidates('units/man_at_arms', null, null, null);
  assert.ok(candidates.some(c => c.includes('man-at-arms')));
});

test('unitIconCandidates uses pbgid unit icon when available', () => {
  const testPbgid = 999901;
  pbgidUnitsMap.set(testPbgid, { k: 'test-unit', n: 'Test Unit', i: 'https://cdn.example.com/test-unit.png' });
  try {
    const candidates = unitIconCandidates('units/whatever', null, null, testPbgid);
    assert.ok(candidates[0] === 'https://cdn.example.com/test-unit.png');
  } finally {
    pbgidUnitsMap.delete(testPbgid);
  }
});

test('unitIconCandidates uses pbgid upgrade icon when available', () => {
  const testPbgid = 999902;
  pbgidUpgradesMap.set(testPbgid, { k: 'vet-knight', n: 'Veteran Knight', i: 'https://cdn.example.com/vet-knight.png' });
  try {
    const candidates = unitIconCandidates('units/whatever', null, null, testPbgid);
    assert.ok(candidates.some(c => c === 'https://cdn.example.com/vet-knight.png'));
  } finally {
    pbgidUpgradesMap.delete(testPbgid);
  }
});

test('unitIconCandidates with null/empty icon uses label fallback', () => {
  const candidates = unitIconCandidates(null, 'Archer', null, null);
  assert.ok(candidates.length > 0);
});


test('unitLabel falls through to titleCased regex when no data source matches', () => {
  const label = unitLabel('units/fire_lancer_3', null, null);
  assert.equal(label, 'Fire Lancer');
});

test('unitLabel titleCases unknown unit with age suffix', () => {
  const label = unitLabel('units/heavy_crossbowman_age_4', null, null);
  assert.equal(label, 'Heavy Crossbowman');
});

test('unitLabel handles null icon', () => {
  const label = unitLabel(null, null, null);
  assert.equal(label, 'Unit');
});

test('unitLabel uses pbgid unit name when available', () => {
  const testPbgid = 999911;
  pbgidUnitsMap.set(testPbgid, { k: 'landsknecht', n: 'Landsknecht', i: '' });
  try {
    const label = unitLabel('units/whatever', null, testPbgid);
    assert.equal(label, 'Landsknecht');
  } finally {
    pbgidUnitsMap.delete(testPbgid);
  }
});

test('unitLabel uses pbgid tech name as second tier', () => {
  const testPbgid = 999912;
  pbgidTechsMap.set(testPbgid, { k: 'siege-eng', n: 'Siege Engineering' });
  try {
    const label = unitLabel('units/whatever', null, testPbgid);
    assert.equal(label, 'Siege Engineering');
  } finally {
    pbgidTechsMap.delete(testPbgid);
  }
});

test('unitLabel uses pbgid upgrade name as third tier', () => {
  const testPbgid = 999913;
  pbgidUpgradesMap.set(testPbgid, { k: 'vet-knight', n: 'Veteran Knight' });
  try {
    const label = unitLabel('units/whatever', null, testPbgid);
    assert.equal(label, 'Veteran Knight');
  } finally {
    pbgidUpgradesMap.delete(testPbgid);
  }
});

test('unitLabel uses unitAlias displayName for French lancer', () => {
  const label = unitLabel('units/lancer_3', { civilizationAttrib: 'french' }, null);
  assert.equal(label, 'Royal Knight');
});


test('unitLabelBase uses pbgid unit name when available', () => {
  const testPbgid = 999921;
  pbgidUnitsMap.set(testPbgid, { k: 'knight', n: 'Knight' });
  try {
    const label = unitLabelBase('knight', 'units/knight_3', null, testPbgid);
    assert.equal(label, 'Knight');
  } finally {
    pbgidUnitsMap.delete(testPbgid);
  }
});

test('unitLabelBase strips age prefix from per-civ data', () => {
  const civSlug = 'english';
  const idx = new Map();
  idx.set('man_at_arms', { id: 'man-at-arms', name: 'Early Man-at-Arms', icon: '' });
  unitDataIndex.set(civSlug, idx);
  try {
    const label = unitLabelBase('man_at_arms', 'units/man_at_arms', { civilization: 'english' }, null);
    assert.equal(label, 'Man-at-Arms');
  } finally {
    unitDataIndex.delete(civSlug);
  }
});

test('unitLabelBase tries kebab-case mergeKey on per-civ data', () => {
  const civSlug = 'french';
  const idx = new Map();
  idx.set('royal_knight', { id: 'royal-knight', name: 'Veteran Royal Knight', icon: '' });
  unitDataIndex.set(civSlug, idx);
  try {
    const label = unitLabelBase('royal-knight', 'units/royal_knight_3', { civilization: 'french' }, null);
    assert.equal(label, 'Royal Knight');
  } finally {
    unitDataIndex.delete(civSlug);
  }
});

test('unitLabelBase falls back to unitLabel when no civ data', () => {
  const label = unitLabelBase('fire_lancer', 'units/fire_lancer_3', null, null);
  assert.equal(label, 'Fire Lancer');
});

test('unitLabelBase falls back to unitLabel with unknown civ', () => {
  const label = unitLabelBase('fire_lancer', 'units/fire_lancer_3', { civilization: 'unknownciv' }, null);
  assert.equal(label, 'Fire Lancer');
});


function makeGrouped(entries) {
  const m = new Map();
  for (const [key, label] of entries) m.set(key, { label, key });
  return m;
}

test('findUnitGroupForUpgrade: upgrade pbgid resolves via base unit family', () => {
  const testPbgid = 999931;
  pbgidUpgradesMap.set(testPbgid, { k: 'vet-knight', n: 'Veteran Knight', b: 'royal-knight' });
  try {
    const grouped = makeGrouped([['royal-knight', 'Royal Knight']]);
    const got = findUnitGroupForUpgrade('upgrades/whatever', null, grouped, testPbgid);
    assert.equal(got?.label, 'Royal Knight');
  } finally {
    pbgidUpgradesMap.delete(testPbgid);
  }
});

test('findUnitGroupForUpgrade: upgrade pbgid tries snake_case variant', () => {
  const testPbgid = 999932;
  pbgidUpgradesMap.set(testPbgid, { k: 'vet-maa', n: 'Veteran MAA', b: 'man-at-arms' });
  try {
    const grouped = makeGrouped([['man_at_arms', 'Man-at-Arms']]);
    const got = findUnitGroupForUpgrade('upgrades/whatever', null, grouped, testPbgid);
    assert.equal(got?.label, 'Man-at-Arms');
  } finally {
    pbgidUpgradesMap.delete(testPbgid);
  }
});

test('findUnitGroupForUpgrade: upgrade pbgid uses iconAliasMap when grouped has legacy key', () => {
  const testPbgid = 999933;
  pbgidUpgradesMap.set(testPbgid, { k: 'vet-lancer', n: 'Veteran Lancer', b: 'royal-knight' });
  try {
    const grouped = makeGrouped([['lancer', 'Lancer (French)']]);
    const aliasMap = new Map([['lancer', 'royal-knight']]);
    const got = findUnitGroupForUpgrade('upgrades/whatever', null, grouped, testPbgid, aliasMap);
    assert.equal(got?.label, 'Lancer (French)');
  } finally {
    pbgidUpgradesMap.delete(testPbgid);
  }
});


test('findUnitGroupForUpgrade: stripped key uses iconAliasMap', () => {
  const grouped = makeGrouped([['royal-knight', 'Royal Knight']]);
  const aliasMap = new Map([['lancer', 'royal-knight']]);
  // "tech_lancer_upgrade" → stripped to "lancer" → alias → "royal-knight"
  const got = findUnitGroupForUpgrade('tech_lancer_upgrade', null, grouped, null, aliasMap);
  assert.equal(got?.label, 'Royal Knight');
});
