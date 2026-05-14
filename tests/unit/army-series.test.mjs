import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArmySeriesForPlayer,
  armyTeamSigns,
  precomputeStackedValues,
} from '../../src/content/army-series.ts';
import { pbgidUnitsMap } from '../../src/content/pbgid-map.ts';


describe('buildArmySeriesForPlayer', () => {
  test('returns empty array for player with no buildOrder', () => {
    const player = { name: 'P1', civilization: 'french' };
    const labels = [0, 20, 40, 60];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  test('returns empty array when buildOrder has only non-army items', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/villager', finished: [10], destroyed: [] },
        { type: 'Unit', icon: 'units/scout', finished: [15], destroyed: [] },
      ],
    };
    const labels = [0, 20, 40];
    const result = buildArmySeriesForPlayer(player, labels, '#ff0000');
    assert.equal(result.length, 0);
  });

  test('produces series for a single army unit type', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/knight', finished: [10, 30], destroyed: [50] },
      ],
    };
    const labels = [0, 20, 40, 60];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    assert.ok(result.length >= 1);
    const knightSeries = result.find(s => s.label.toLowerCase().includes('knight'));
    assert.ok(knightSeries, 'should find a knight series');
    assert.equal(knightSeries.createdTotal, 2);
    assert.equal(knightSeries.values.length, labels.length);
    assert.deepEqual([...knightSeries.values], [0, 1, 2, 1]);
  });

  test('merges same-label groups into one series', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/archer_2', finished: [10], destroyed: [] },
        { type: 'Unit', icon: 'units/archer_3', finished: [30], destroyed: [] },
      ],
    };
    const labels = [0, 20, 40];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    const archerSeries = result.filter(s => s.mergeKey === 'archer');
    assert.equal(archerSeries.length, 1, 'both age variants should merge');
    assert.equal(archerSeries[0].createdTotal, 2);
  });

  test('uses shared raw entity id to merge unresolved civ variants into canonical unit', () => {
    const previousAge2 = pbgidUnitsMap.get(9004188);
    const previousAge3 = pbgidUnitsMap.get(9004189);
    const previousHorseArcher = pbgidUnitsMap.get(133493);
    pbgidUnitsMap.set(9004188, {
      n: 'Mohe Tribesman',
      k: 'mohe-tribesman',
      i: 'https://data.aoe4world.com/images/units/mohe-tribesman-2.png',
    });
    pbgidUnitsMap.set(9004189, {
      n: 'Mohe Tribesman',
      k: 'mohe-tribesman',
      i: 'https://data.aoe4world.com/images/units/mohe-tribesman-2.png',
    });
    pbgidUnitsMap.set(133493, {
      n: 'Horse Archer',
      k: 'horse-archer',
      i: 'https://data.aoe4world.com/images/units/horse-archer-3.png',
    });
    try {
      const player = {
        name: 'P1',
        civilization: 'jin_dynasty',
        civilizationAttrib: 'jin_dynasty',
        buildOrder: [
          { id: '11270955', type: 'Unit', icon: 'icons/races/jin/units/horse_archer_2', pbgid: 9003972, finished: [10, 20], destroyed: [] },
          { id: '11270955', type: 'Unit', icon: 'icons/races/jin/units/grassland/horse_archer_grassland_2', pbgid: 9004188, finished: [30], destroyed: [] },
          { id: '11270956', type: 'Unit', icon: 'icons/races/jin/units/horse_archer_3', pbgid: 9003973, finished: [40], destroyed: [70] },
          { id: '11270956', type: 'Unit', icon: 'icons/races/jin/units/grassland/horse_archer_grassland_3', pbgid: 9004189, finished: [50], destroyed: [] },
          { id: 'unrelated-grassland', type: 'Unit', icon: 'icons/races/jin/units/grassland/horse_archer_grassland_2', pbgid: 9003972, finished: [55], destroyed: [] },
          { id: 'unrelated', type: 'Unit', icon: 'icons/races/rus/units/horse_archer_3', pbgid: 133493, finished: [60], destroyed: [] },
        ],
      };

      const result = buildArmySeriesForPlayer(player, [0, 20, 40, 60, 80], '#4dabf7');
      const mohe = result.find(s => s.mergeKey === 'mohe-tribesman');
      const horseArcher = result.find(s => s.mergeKey === 'horse-archer');
      const unresolvedGrassland = result.find(s => s.mergeKey === 'horse_archer_grassland');

      assert.ok(mohe, 'Mohe Tribesman series should exist');
      assert.ok(horseArcher, 'unrelated Horse Archer entity should remain separate');
      assert.ok(unresolvedGrassland, 'unrelated unresolved grassland Horse Archer entity should remain separate');
      assert.equal(mohe.label, 'Mohe Tribesman');
      assert.equal(mohe.createdTotal, 5);
      assert.deepEqual([...mohe.values], [0, 2, 4, 5, 4]);
      assert.equal(horseArcher.createdTotal, 1);
      assert.equal(unresolvedGrassland.createdTotal, 1);
      assert.equal(mohe.iconCandidates[0], 'https://data.aoe4world.com/images/units/mohe-tribesman-2.png');
    } finally {
      if (previousAge2) pbgidUnitsMap.set(9004188, previousAge2);
      else pbgidUnitsMap.delete(9004188);
      if (previousAge3) pbgidUnitsMap.set(9004189, previousAge3);
      else pbgidUnitsMap.delete(9004189);
      if (previousHorseArcher) pbgidUnitsMap.set(133493, previousHorseArcher);
      else pbgidUnitsMap.delete(133493);
    }
  });

  test('preserves upgrade timestamps sorted ascending', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/spearman', finished: [10], destroyed: [] },
        { type: 'Upgrade', icon: 'units/spearman_upgrade', finished: [50, 30], destroyed: [] },
      ],
    };
    const labels = [0, 20, 40, 60];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    const spear = result.find(s => s.mergeKey === 'spearman');
    assert.ok(spear, 'should have spearman series');
    if (spear.upgrades.length > 0) {
      for (let i = 1; i < spear.upgrades.length; i++) {
        assert.ok(spear.upgrades[i].time >= spear.upgrades[i - 1].time, 'upgrades sorted by time');
      }
    }
  });

  test('includes baseColor on each series entry', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/knight', finished: [10], destroyed: [] },
      ],
    };
    const labels = [0, 20];
    const result = buildArmySeriesForPlayer(player, labels, '#aabbcc');
    assert.ok(result.length >= 1);
    assert.equal(result[0].baseColor, '#aabbcc');
  });

  test('handles transformed timestamps', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/horseman', finished: [10], destroyed: [], transformed: [30] },
      ],
    };
    const labels = [0, 20, 40];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    const horseman = result.find(s => s.mergeKey === 'horseman');
    assert.ok(horseman);
    assert.equal(horseman.createdTotal, 2);
    assert.deepEqual([...horseman.values], [0, 1, 2]);
  });

  test('sorted _finishedTimes and _destroyedTimes', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/knight', finished: [50, 10, 30], destroyed: [60, 20] },
      ],
    };
    const labels = [0, 20, 40, 60];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    const knight = result.find(s => s.mergeKey === 'knight');
    assert.ok(knight);
    assert.deepEqual([...knight._finishedTimes], [10, 30, 50]);
    assert.deepEqual([...knight._destroyedTimes], [20, 60]);
  });

  test('collapses to max 10 series via collapseChartSeries', () => {
    const buildOrder = [];
    for (let i = 0; i < 12; i++) {
      buildOrder.push({
        type: 'Unit',
        icon: `units/unittype${i}`,
        finished: [10 * (i + 1)],
        destroyed: [],
      });
    }
    const player = { name: 'P1', civilization: 'english', buildOrder };
    const labels = [0, 20, 40, 60, 80, 100, 120, 140];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    assert.ok(result.length <= 10, `should collapse to <=10, got ${result.length}`);
  });

  test('iconCandidates is an array', () => {
    const player = {
      name: 'P1',
      civilization: 'english',
      buildOrder: [
        { type: 'Unit', icon: 'units/knight', finished: [10], destroyed: [] },
      ],
    };
    const labels = [0, 20];
    const result = buildArmySeriesForPlayer(player, labels, '#4dabf7');
    assert.ok(result.length >= 1);
    assert.ok(Array.isArray(result[0].iconCandidates));
  });
});


describe('armyTeamSigns', () => {
  test('returns positive sign for the first native-legend team', () => {
    const players = [
      { name: 'Alice', team: 1 },
      { name: 'Bob', team: 2 },
    ];
    const signs = armyTeamSigns(players, ['Bob']);
    assert.equal(signs.get(2), 1, 'Bob team (2) should be positive');
    assert.equal(signs.get(1), -1, 'Alice team (1) should be negative');
  });

  test('defaults to first sorted team when nativePlayerOrder is empty', () => {
    const players = [
      { name: 'A', team: 3 },
      { name: 'B', team: 1 },
    ];
    const signs = armyTeamSigns(players, []);
    assert.equal(signs.get(1), 1, 'lowest team id should be positive');
    assert.equal(signs.get(3), -1);
  });

  test('handles single team', () => {
    const players = [
      { name: 'A', team: 1 },
      { name: 'B', team: 1 },
    ];
    const signs = armyTeamSigns(players, []);
    assert.equal(signs.get(1), 1);
  });

  test('handles players with undefined team', () => {
    const players = [
      { name: 'A', team: 1 },
      { name: 'B' },
    ];
    const signs = armyTeamSigns(players, []);
    assert.equal(signs.size, 1);
    assert.equal(signs.get(1), 1);
  });

  test('nativePlayerOrder match is case-insensitive', () => {
    const players = [
      { name: 'Alice', team: 1 },
      { name: 'Bob', team: 2 },
    ];
    const signs = armyTeamSigns(players, ['BOB']);
    assert.equal(signs.get(2), 1);
    assert.equal(signs.get(1), -1);
  });
});


describe('precomputeStackedValues', () => {
  test('handles empty series array', () => {
    precomputeStackedValues([]);
  });

  test('stacks positive series bottom-up', () => {
    const s1 = { values: [1, 2, 3], sign: 1, playerName: 'P1' };
    const s2 = { values: [4, 5, 6], sign: 1, playerName: 'P1' };
    precomputeStackedValues([s1, s2]);
    // After reversal for positive side, s2 is processed first, then s1
    // s2 base=0, s2 top=values
    // s1 base=s2 top, s1 top=s1 base + s1 values
    for (let i = 0; i < 3; i++) {
      assert.equal(s1._stackTop[i], s1._stackBase[i] + s1.values[i]);
      assert.equal(s2._stackTop[i], s2._stackBase[i] + s2.values[i]);
    }
    const topSeries = [s1, s2].find(s => Math.max(...s._stackTop) === Math.max(...s1._stackTop, ...s2._stackTop));
    assert.ok(topSeries);
  });

  test('negative series stack in negative direction', () => {
    const s1 = { values: [-3, -6, -9], sign: -1, playerName: 'P2' };
    precomputeStackedValues([s1]);
    assert.equal(s1._stackBase[0], 0);
    assert.equal(s1._stackTop[0], -3);
    assert.equal(s1._stackTop[1], -6);
    assert.equal(s1._stackTop[2], -9);
  });

  test('hidden series get base == top (zero height)', () => {
    const s1 = { values: [5, 10], sign: 1, playerName: 'P1' };
    const s2 = { values: [3, 7], sign: 1, playerName: 'P1', _hidden: true };
    const s3 = { values: [2, 4], sign: 1, playerName: 'P1' };
    precomputeStackedValues([s1, s2, s3]);
    for (let i = 0; i < 2; i++) {
      assert.equal(s2._stackBase[i], s2._stackTop[i], 'hidden series has zero height');
    }
  });

  test('per-player aggregate bands (_playerBase and _playerTop)', () => {
    const s1 = { values: [2, 4], sign: 1, playerName: 'P1' };
    const s2 = { values: [3, 5], sign: 1, playerName: 'P1' };
    const s3 = { values: [1, 2], sign: 1, playerName: 'P2' };
    precomputeStackedValues([s1, s2, s3]);
    assert.ok(s1._playerBase);
    assert.ok(s1._playerTop);
    assert.deepEqual([...s1._playerBase], [...s2._playerBase]);
    assert.deepEqual([...s1._playerTop], [...s2._playerTop]);
    assert.ok(s3._playerBase);
  });

  test('mixed positive and negative series', () => {
    const pos = { values: [5], sign: 1, playerName: 'P1' };
    const neg = { values: [-3], sign: -1, playerName: 'P2' };
    precomputeStackedValues([pos, neg]);
    assert.ok(pos._stackTop[0] > 0, 'positive top > 0');
    assert.ok(neg._stackTop[0] < 0, 'negative top < 0');
  });

  test('monotonic stacking: each successive top includes previous', () => {
    const s1 = { values: [10], sign: 1, playerName: 'P1' };
    const s2 = { values: [20], sign: 1, playerName: 'P1' };
    const s3 = { values: [5], sign: 1, playerName: 'P1' };
    precomputeStackedValues([s1, s2, s3]);
    // After positive-side reversal, order is s3, s2, s1
    // Each series' base should equal the previous series' top
    // Total of all tops should equal 10 + 20 + 5 = 35
    const allTops = [s1._stackTop[0], s2._stackTop[0], s3._stackTop[0]];
    const maxTop = Math.max(...allTops);
    assert.equal(maxTop, 35);
  });

  test('default sign is positive when omitted', () => {
    const s = { values: [7, 14], playerName: 'P1' };
    precomputeStackedValues([s]);
    assert.equal(s._stackBase[0], 0);
    assert.equal(s._stackTop[0], 7);
    assert.equal(s._stackTop[1], 14);
  });
});
