import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResourceGatheredCharts } from '../../src/content/chart-resources.ts';

function player(overrides = {}) {
  return {
    name: 'Player',
    civilization: 'english',
    civilizationAttrib: 'english',
    color: 0,
    resources: {
      timestamps: [0, 20],
      food: [0, 5],
      foodGathered: [0, 10],
      wood: [0, 0],
      woodGathered: [0, 0],
      gold: [0, 0],
      goldGathered: [0, 0],
      stone: [0, 0],
      stoneGathered: [0, 0],
    },
    ...overrides,
  };
}

function chartByValue(charts, suffix) {
  return charts.find(chart => chart.value.endsWith(suffix));
}

describe('buildResourceGatheredCharts special resources', () => {
  it('does not synthesize a fake Silver chart from a scalar-only total', () => {
    const summary = {
      duration: 20,
      players: [
        player({
          name: 'Twon LEGEND',
          civilization: 'macedonian_dynasty',
          civilizationAttrib: 'byzantine_ha_mac',
          resources: {
            timestamps: [0, 20],
            food: [0, 0],
            foodGathered: [0, 100],
            wood: [0, 0],
            woodGathered: [0, 0],
            gold: [0, 0],
            goldGathered: [0, 0],
            stone: [0, 0],
            stoneGathered: [0, 0],
          },
          totalResourcesGathered: { oliveoil: 3764 },
        }),
      ],
    };

    const charts = buildResourceGatheredCharts(summary, new Map());

    // Olive Oil must not appear for a Macedonian player.
    assert.equal(chartByValue(charts, 'resources-gathered-oliveoil'), undefined);

    // Silver has no time-series here, so do not invent a perfectly linear line.
    const silver = chartByValue(charts, 'resources-gathered-silver');
    assert.equal(silver, undefined);

    const total = chartByValue(charts, 'resources-gathered-total');
    assert.ok(total, 'Total resources chart should still render from real time-series data');
    assert.equal(total.data.series[0].values.at(-1), 100);
  });

  it('renders Macedonian oliveoil-shaped time series as Silver', () => {
    const summary = {
      duration: 20,
      players: [
        player({
          name: 'Macedonian',
          civilization: 'macedonian_dynasty',
          civilizationAttrib: 'byzantine_ha_mac',
          resources: {
            timestamps: [0, 20],
            food: [0, 0],
            foodGathered: [0, 0],
            wood: [0, 0],
            woodGathered: [0, 0],
            gold: [0, 0],
            goldGathered: [0, 0],
            stone: [0, 0],
            stoneGathered: [0, 0],
            oliveoil: [0, 5],
            oliveoilGathered: [0, 10],
          },
        }),
      ],
    };

    const charts = buildResourceGatheredCharts(summary, new Map());
    const silver = chartByValue(charts, 'resources-gathered-silver');

    assert.ok(silver, 'Silver chart should render');
    assert.equal(silver.title, 'Resources Gathered: Silver');
    assert.deepEqual(silver.data.series[0].values, [0, 15]);
    assert.equal(chartByValue(charts, 'resources-gathered-oliveoil'), undefined);
  });

  it('renders Byzantine oliveoil time series as Olive Oil', () => {
    const summary = {
      duration: 20,
      players: [
        player({
          name: 'Byzantine',
          civilization: 'byzantines',
          civilizationAttrib: 'byzantine',
          resources: {
            timestamps: [0, 20],
            food: [0, 0],
            foodGathered: [0, 0],
            wood: [0, 0],
            woodGathered: [0, 0],
            gold: [0, 0],
            goldGathered: [0, 0],
            stone: [0, 0],
            stoneGathered: [0, 0],
            oliveoil: [0, 3],
            oliveoilGathered: [0, 7],
          },
        }),
      ],
    };

    const charts = buildResourceGatheredCharts(summary, new Map());
    const olive = chartByValue(charts, 'resources-gathered-oliveoil');

    assert.ok(olive, 'Olive Oil chart should render');
    assert.equal(olive.title, 'Resources Gathered: Olive Oil');
    assert.deepEqual(olive.data.series[0].values, [0, 10]);
    assert.equal(chartByValue(charts, 'resources-gathered-silver'), undefined);
  });

  it('can render both Olive Oil and Silver charts in the same match', () => {
    const summary = {
      duration: 20,
      players: [
        player({
          name: 'Byzantine',
          civilization: 'byzantines',
          civilizationAttrib: 'byzantine',
          resources: {
            timestamps: [0, 20],
            food: [0, 0],
            foodGathered: [0, 0],
            wood: [0, 0],
            woodGathered: [0, 0],
            gold: [0, 0],
            goldGathered: [0, 0],
            stone: [0, 0],
            stoneGathered: [0, 0],
            oliveoil: [0, 1],
            oliveoilGathered: [0, 2],
          },
        }),
        player({
          name: 'Macedonian',
          civilization: 'macedonian_dynasty',
          civilizationAttrib: 'byzantine_ha_mac',
          resources: {
            timestamps: [0, 20],
            food: [0, 0],
            foodGathered: [0, 0],
            wood: [0, 0],
            woodGathered: [0, 0],
            gold: [0, 0],
            goldGathered: [0, 0],
            stone: [0, 0],
            stoneGathered: [0, 0],
            silver: [0, 4],
            silverGathered: [0, 6],
          },
        }),
      ],
    };

    const charts = buildResourceGatheredCharts(summary, new Map());
    const olive = chartByValue(charts, 'resources-gathered-oliveoil');
    const silver = chartByValue(charts, 'resources-gathered-silver');

    assert.ok(olive, 'Olive Oil chart should render');
    assert.ok(silver, 'Silver chart should render');
    assert.equal(olive.data.series.length, 1);
    assert.equal(olive.data.series[0].label, 'Byzantine');
    assert.equal(silver.data.series.length, 1);
    assert.equal(silver.data.series[0].label, 'Macedonian');
    assert.deepEqual(silver.data.series[0].values, [0, 10]);
  });
});
