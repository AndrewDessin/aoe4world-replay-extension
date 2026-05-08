import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  runtime: {
    sendMessage: (_msg, _cb) => {}
  }
};

const mod = await import('../../src/content/unit-data-cache.ts');
const {
  civDataSlugForPlayer,
  buildUnitDataIndexForCiv,
  unitDataIndex,
  unitDataLoaded,
  unitDataPendingFetches,
  lookupUnitDataByPbgid,
  lookupUnitDataForIcon,
  ensureUnitDataForSummary,
} = mod;

function resetState() {
  unitDataIndex.clear();
  unitDataLoaded.clear();
  unitDataPendingFetches.clear();
}

describe('civDataSlugForPlayer', () => {
  it('returns empty string for null/undefined player', () => {
    assert.equal(civDataSlugForPlayer(null), '');
    assert.equal(civDataSlugForPlayer(undefined), '');
  });

  it('maps known civilization ids', () => {
    assert.equal(civDataSlugForPlayer({ civilization: 'abbasid_dynasty' }), 'abbasid');
    assert.equal(civDataSlugForPlayer({ civilization: 'holy_roman_empire' }), 'hre');
    assert.equal(civDataSlugForPlayer({ civilization: 'french' }), 'french');
    assert.equal(civDataSlugForPlayer({ civilization: 'golden_horde' }), 'goldenhorde');
    assert.equal(civDataSlugForPlayer({ civilization: 'zhu_xis_legacy' }), 'zhuxi');
  });

  it('is case-insensitive for civilization', () => {
    assert.equal(civDataSlugForPlayer({ civilization: 'FRENCH' }), 'french');
    assert.equal(civDataSlugForPlayer({ civilization: 'Holy_Roman_Empire' }), 'hre');
  });

  it('falls back to civilizationAttrib when civilization is unknown', () => {
    assert.equal(civDataSlugForPlayer({ civilization: 'unknown', civilizationAttrib: 'english' }), 'english');
  });

  it('falls back to slug-shaped attrib for future civs', () => {
    assert.equal(civDataSlugForPlayer({ civilization: 'x', civilizationAttrib: 'newciv' }), 'newciv');
  });

  it('returns empty for non-slug-shaped attrib fallback', () => {
    assert.equal(civDataSlugForPlayer({ civilization: 'x', civilizationAttrib: 'has spaces' }), '');
    assert.equal(civDataSlugForPlayer({ civilization: 'x', civilizationAttrib: 'has_underscore' }), '');
  });

  it('returns empty for empty player object', () => {
    assert.equal(civDataSlugForPlayer({}), '');
  });
});

describe('buildUnitDataIndexForCiv', () => {
  beforeEach(resetState);

  const sampleUnits = [
    { baseId: 'knight', id: 'knight-1', name: 'Knight', icon: 'icons/knight.png', costs: { food: 60, gold: 100 }, pbgid: 101, age: 3 },
    { baseId: 'spearman', id: 'spearman-1', name: 'Spearman', icon: 'icons/spearman.png', costs: { food: 60 }, pbgid: 200, age: 1 },
  ];

  it('stores index in unitDataIndex map and marks slug as loaded', () => {
    buildUnitDataIndexForCiv('french', sampleUnits);
    assert.ok(unitDataIndex.has('french'));
    assert.ok(unitDataLoaded.has('french'));
  });

  it('indexes by baseId (normalised)', () => {
    buildUnitDataIndexForCiv('french', sampleUnits);
    const idx = unitDataIndex.get('french');
    assert.ok(idx.has('knight'));
    assert.equal(idx.get('knight').name, 'Knight');
  });

  it('indexes by baseId_age', () => {
    buildUnitDataIndexForCiv('french', sampleUnits);
    const idx = unitDataIndex.get('french');
    assert.ok(idx.has('knight_3'));
    assert.ok(idx.has('spearman_1'));
  });

  it('indexes by pbgid via __pbgidIndex', () => {
    buildUnitDataIndexForCiv('french', sampleUnits);
    const idx = unitDataIndex.get('french');
    assert.ok(idx.__pbgidIndex.has(101));
    assert.equal(idx.__pbgidIndex.get(101).name, 'Knight');
  });

  it('handles units with attribName', () => {
    const units = [
      { baseId: 'archer', id: 'a1', name: 'Archer', attribName: 'unit_archer_en', age: 2 },
    ];
    buildUnitDataIndexForCiv('english', units);
    const idx = unitDataIndex.get('english');
    assert.ok(idx.has('archer'));
  });

  it('indexes by class names', () => {
    const units = [
      { baseId: 'maa', id: 'm1', name: 'Man-at-Arms', classes: ['infantry', 'melee'], age: 2 },
    ];
    buildUnitDataIndexForCiv('english', units);
    const idx = unitDataIndex.get('english');
    assert.ok(idx.has('infantry'));
    assert.ok(idx.has('melee'));
    assert.ok(idx.has('infantry_2'));
    assert.ok(idx.has('melee_2'));
  });

  it('indexes by icon slug', () => {
    const units = [
      { baseId: 'tc', id: 'tc1', name: 'TC', icon: 'https://cdn/icons/town-center.png' },
    ];
    buildUnitDataIndexForCiv('english', units);
    const idx = unitDataIndex.get('english');
    assert.ok(idx.has('town_center'));
  });

  it('indexes by icon slug with age suffix stripped', () => {
    const units = [
      { baseId: 'scout', id: 's1', name: 'Scout', icon: 'icons/scout_age2.png' },
    ];
    buildUnitDataIndexForCiv('french', units);
    const idx = unitDataIndex.get('french');
    assert.ok(idx.has('scout_age2'));
    assert.ok(idx.has('scout'));
  });

  it('handles empty units array', () => {
    buildUnitDataIndexForCiv('hre', []);
    const idx = unitDataIndex.get('hre');
    assert.ok(idx instanceof Map);
    assert.equal(idx.size, 0);
  });

  it('sorts by age so earliest entry wins baseId key', () => {
    const units = [
      { baseId: 'knight', id: 'k2', name: 'Knight II', age: 4 },
      { baseId: 'knight', id: 'k1', name: 'Knight I', age: 3 },
    ];
    buildUnitDataIndexForCiv('french', units);
    const idx = unitDataIndex.get('french');
    assert.equal(idx.get('knight').name, 'Knight I');
  });

  it('handles unit with no baseId/id gracefully', () => {
    const units = [{ name: 'Mystery' }];
    buildUnitDataIndexForCiv('english', units);
    const idx = unitDataIndex.get('english');
    assert.ok(idx instanceof Map);
  });

  it('normalises dashes to underscores in baseId', () => {
    const units = [{ baseId: 'man-at-arms', id: 'maa1', name: 'MAA', age: 2 }];
    buildUnitDataIndexForCiv('english', units);
    const idx = unitDataIndex.get('english');
    assert.ok(idx.has('man_at_arms'));
  });
});

describe('unitDataIndex singleton', () => {
  beforeEach(resetState);

  it('is a Map', () => {
    assert.ok(unitDataIndex instanceof Map);
  });

  it('get/set round-trips', () => {
    unitDataIndex.set('test', new Map([['a', 1]]));
    assert.equal(unitDataIndex.get('test').get('a'), 1);
  });
});

describe('lookupUnitDataByPbgid', () => {
  beforeEach(() => {
    resetState();
    buildUnitDataIndexForCiv('french', [
      { baseId: 'knight', id: 'k1', name: 'Knight', pbgid: 101, costs: { food: 60 } },
    ]);
  });

  it('returns entry for valid pbgid + player', () => {
    const result = lookupUnitDataByPbgid(101, { civilization: 'french' });
    assert.equal(result.name, 'Knight');
  });

  it('returns null for unknown pbgid', () => {
    assert.equal(lookupUnitDataByPbgid(999, { civilization: 'french' }), null);
  });

  it('returns null when pbgid is falsy', () => {
    assert.equal(lookupUnitDataByPbgid(0, { civilization: 'french' }), null);
    assert.equal(lookupUnitDataByPbgid(null, { civilization: 'french' }), null);
  });

  it('returns null when player civ slug is unknown', () => {
    assert.equal(lookupUnitDataByPbgid(101, { civilization: 'nonexist' }), null);
  });

  it('returns null when no index exists for civ', () => {
    assert.equal(lookupUnitDataByPbgid(101, { civilization: 'english' }), null);
  });
});

describe('lookupUnitDataForIcon', () => {
  beforeEach(() => {
    resetState();
    buildUnitDataIndexForCiv('french', [
      { baseId: 'knight', id: 'k1', name: 'Knight', icon: 'icons/knight.png', pbgid: 101, age: 3 },
      { baseId: 'spearman', id: 's1', name: 'Spear', icon: 'icons/spearman_age_2.png', age: 2 },
    ]);
  });

  it('finds by baseId key in index', () => {
    const r = lookupUnitDataForIcon('icons/knight', { civilization: 'french' });
    assert.equal(r.name, 'Knight');
  });

  it('finds by age-normalised candidate (basename_age → baseId_age)', () => {
    // spearman_age_2 → candidate spearman_2 via ageM branch
    const r = lookupUnitDataForIcon('icons/spearman_age_2', { civilization: 'french' });
    assert.ok(r);
  });

  it('returns null for null/empty icon', () => {
    assert.equal(lookupUnitDataForIcon('', { civilization: 'french' }), null);
    assert.equal(lookupUnitDataForIcon(null, { civilization: 'french' }), null);
  });

  it('returns null when civ slug is empty', () => {
    assert.equal(lookupUnitDataForIcon('icons/knight.png', null), null);
  });

  it('returns null when no index exists for civ', () => {
    assert.equal(lookupUnitDataForIcon('icons/knight.png', { civilization: 'english' }), null);
  });

  it('returns null when icon not found', () => {
    assert.equal(lookupUnitDataForIcon('icons/unknown_unit', { civilization: 'french' }), null);
  });
});

describe('ensureUnitDataForSummary', () => {
  beforeEach(resetState);

  it('fetches missing civ data and calls onUpdated', (t, done) => {
    globalThis.chrome.runtime.sendMessage = (msg, cb) => {
      assert.equal(msg.type, 'getUnitData');
      assert.deepEqual(msg.civSlugs, ['french']);
      cb({
        success: true,
        units: {
          french: [{ baseId: 'knight', id: 'k1', name: 'Knight', pbgid: 1, costs: { food: 60 } }],
        },
      });
    };

    ensureUnitDataForSummary(
      { players: [{ civilization: 'french' }] },
      () => {
        assert.ok(unitDataLoaded.has('french'));
        assert.ok(unitDataIndex.has('french'));
        done();
      }
    );
  });

  it('no-ops when all slugs are already loaded', () => {
    unitDataLoaded.add('french');
    let called = false;
    globalThis.chrome.runtime.sendMessage = () => { called = true; };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] }, () => {});
    assert.ok(!called);
  });

  it('deduplicates inflight fetches', () => {
    let callCount = 0;
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      callCount++;
      cb({ success: true, units: { french: [] } });
    };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] });
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] });
    assert.equal(callCount, 1);
  });

  it('handles response with success=false gracefully', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      cb({ success: false });
    };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] });
    assert.ok(!unitDataPendingFetches.has('french'));
  });

  it('does not call onUpdated when response has no units', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      cb({ success: true, units: { french: [] } });
    };
    let updatedCalled = false;
    ensureUnitDataForSummary(
      { players: [{ civilization: 'french' }] },
      () => { updatedCalled = true; }
    );
    assert.ok(!updatedCalled);
  });

  it('handles null/invalid summary gracefully', () => {
    let called = false;
    globalThis.chrome.runtime.sendMessage = () => { called = true; };
    ensureUnitDataForSummary(null);
    ensureUnitDataForSummary({});
    ensureUnitDataForSummary({ players: 'not-array' });
    assert.ok(!called);
  });

  it('deduplicates player civs', () => {
    globalThis.chrome.runtime.sendMessage = (msg, cb) => {
      assert.equal(msg.civSlugs.length, 1);
      cb({ success: true, units: { french: [{ baseId: 'x', id: 'x', name: 'X' }] } });
    };
    ensureUnitDataForSummary({
      players: [{ civilization: 'french' }, { civilization: 'french' }],
    });
  });

  it('marks slug loaded for empty unit arrays without building index', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      cb({ success: true, units: { french: [] } });
    };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] });
    assert.ok(unitDataLoaded.has('french'));
  });

  it('does not invoke onUpdated when onUpdated is not a function', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      cb({ success: true, units: { french: [{ baseId: 'x', id: 'x', name: 'X' }] } });
    };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] }, null);
    ensureUnitDataForSummary({ players: [{ civilization: 'english' }] });
  });

  it('clears pending for slugs missing from a partial response', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => {
      cb({ success: true, units: { french: [{ baseId: 'x', id: 'x', name: 'X' }] } });
    };
    ensureUnitDataForSummary({
      players: [{ civilization: 'french' }, { civilization: 'english' }],
    });
    assert.ok(!unitDataPendingFetches.has('french'));
    assert.ok(!unitDataPendingFetches.has('english'), 'english must not stay pending forever');
  });

  it('clears pending when callback receives undefined response', () => {
    globalThis.chrome.runtime.sendMessage = (_msg, cb) => { cb(undefined); };
    ensureUnitDataForSummary({ players: [{ civilization: 'french' }] });
    assert.ok(!unitDataPendingFetches.has('french'));
  });
});

describe('lookupUnitDataForIcon .png + dash normalisation', () => {
  beforeEach(resetState);

  it('finds entry when icon URL contains .png extension', () => {
    buildUnitDataIndexForCiv('french', [
      { baseId: 'royal-knight', id: 'rk', name: 'Royal Knight', icon: 'icons/royal-knight.png', pbgid: 99 },
    ]);
    const r = lookupUnitDataForIcon('icons/royal-knight.png', { civilization: 'french' });
    assert.ok(r, 'lookup must strip .png and normalise dashes like the indexer does');
    assert.equal(r.name, 'Royal Knight');
  });
});
