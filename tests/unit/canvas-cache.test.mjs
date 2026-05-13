import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_CACHE_PREFIX,
  playerCacheKey,
  ensureChartRenderCache,
  getCollapsedPlayers,
  isHighlightForPlayer,
  playerValueSumAt,
} from '../../src/content/canvas-cache.ts';

function makeMargin(top = 20) { return { top }; }

function lineSeries(key, values, playerName) {
  return { key, values, playerName };
}

function armySeries(key, { stackBase, stackTop, playerBase, playerTop, values, playerName, hidden } = {}) {
  const s = { key, values: values || [], playerName };
  if (stackBase) s._stackBase = stackBase;
  if (stackTop) s._stackTop = stackTop;
  if (playerBase) s._playerBase = playerBase;
  if (playerTop) s._playerTop = playerTop;
  if (hidden) s._hidden = true;
  return s;
}

function makeChart(type, series, opts = {}) {
  return {
    type,
    data: { labels: [], series },
    _geometry: opts.geometry || { yMin: 0, yMax: 100 },
    _legendNodes: opts.legendNodes || null,
    highlightKey: opts.highlightKey || null,
  };
}

describe('playerCacheKey', () => {
  it('prefixes with PLAYER_CACHE_PREFIX', () => {
    assert.equal(playerCacheKey('Alice'), PLAYER_CACHE_PREFIX + 'Alice');
  });
  it('handles empty string', () => {
    assert.equal(playerCacheKey(''), PLAYER_CACHE_PREFIX);
  });
});

describe('ensureChartRenderCache – line charts', () => {
  it('computes pixel-Y for simple series', () => {
    const s = lineSeries('food', [0, 50, 100]);
    const chart = makeChart('line', [s]);
    const margin = makeMargin(10);
    const plotH = 200;
    const result = ensureChartRenderCache(chart, margin, plotH);
    assert.ok(result instanceof Map);
    const ys = result.get('food');
    assert.ok(ys instanceof Float32Array);
    assert.equal(ys.length, 3);
    // v=0   => margin.top + (1 - (0-0)/100)*200 = 10+200 = 210
    assert.equal(ys[0], 210);
    // v=50  => 10 + (1 - 0.5)*200 = 10+100 = 110
    assert.equal(ys[1], 110);
    // v=100 => 10 + (1-1)*200 = 10
    assert.equal(ys[2], 10);
  });

  it('returns cached result when geometry unchanged', () => {
    const s = lineSeries('gold', [10, 20]);
    const chart = makeChart('line', [s]);
    const margin = makeMargin(5);
    const first = ensureChartRenderCache(chart, margin, 100);
    const second = ensureChartRenderCache(chart, margin, 100);
    assert.strictEqual(first, second);
  });

  it('invalidates when plotH changes', () => {
    const s = lineSeries('gold', [10]);
    const chart = makeChart('line', [s]);
    const margin = makeMargin(5);
    const first = ensureChartRenderCache(chart, margin, 100);
    const second = ensureChartRenderCache(chart, margin, 200);
    assert.notStrictEqual(first, second);
  });

  it('invalidates when margin.top changes', () => {
    const s = lineSeries('gold', [10]);
    const chart = makeChart('line', [s]);
    const first = ensureChartRenderCache(chart, makeMargin(5), 100);
    const second = ensureChartRenderCache(chart, makeMargin(15), 100);
    assert.notStrictEqual(first, second);
  });

  it('invalidates when yMin changes', () => {
    const s = lineSeries('gold', [10]);
    const chart = makeChart('line', [s], { geometry: { yMin: 0, yMax: 100 } });
    ensureChartRenderCache(chart, makeMargin(), 100);
    chart._geometry.yMin = 10;
    const second = ensureChartRenderCache(chart, makeMargin(), 100);
    assert.ok(second instanceof Map);
  });

  it('invalidates when yMax changes', () => {
    const s = lineSeries('gold', [10]);
    const chart = makeChart('line', [s], { geometry: { yMin: 0, yMax: 100 } });
    ensureChartRenderCache(chart, makeMargin(), 100);
    chart._geometry.yMax = 200;
    const second = ensureChartRenderCache(chart, makeMargin(), 100);
    assert.ok(second instanceof Map);
  });

  it('handles missing _geometry gracefully (defaults yMin=0 yMax=1)', () => {
    const s = lineSeries('wood', [0, 1]);
    const chart = makeChart('line', [s]);
    delete chart._geometry;
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    const ys = result.get('wood');
    // v=0 => 0 + (1 - 0)*100 = 100
    assert.equal(ys[0], 100);
    // v=1 => 0 + (1 - 1)*100 = 0
    assert.equal(ys[1], 0);
  });

  it('handles yMin === yMax (span fallback to 1)', () => {
    const s = lineSeries('stone', [5]);
    const chart = makeChart('line', [s], { geometry: { yMin: 5, yMax: 5 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    const ys = result.get('stone');
    // span = 0 => 1, v=5, (5-5)/1 = 0 => 0 + (1-0)*100 = 100
    assert.equal(ys[0], 100);
  });

  it('treats null/undefined values as 0', () => {
    const s = lineSeries('misc', [null, undefined, 50]);
    const chart = makeChart('line', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 200);
    const ys = result.get('misc');
    // null||0 => 0 => 0 + (1-0)*200 = 200
    assert.equal(ys[0], 200);
    assert.equal(ys[1], 200);
    // 50 => 0 + (1-0.5)*200 = 100
    assert.equal(ys[2], 100);
  });
});

describe('ensureChartRenderCache – army charts (stacked)', () => {
  it('produces stackBase/stackTop for series with _stackBase/_stackTop', () => {
    const s = armySeries('knight', {
      stackBase: [0, 10],
      stackTop: [20, 30],
      playerName: 'Alice',
    });
    const chart = makeChart('army', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    const entry = result.get('knight');
    assert.ok(entry.stackBase instanceof Float32Array);
    assert.ok(entry.stackTop instanceof Float32Array);
    assert.equal(entry.stackBase.length, 2);
    assert.equal(entry.stackTop.length, 2);
    // stackBase[0]: base=0 => 0+(1-0/100)*100 = 100
    assert.equal(entry.stackBase[0], 100);
    // stackTop[0]: top=20 => 0+(1-20/100)*100 = 80
    assert.equal(entry.stackTop[0], 80);
  });

  it('falls back to values path when _stackBase/_stackTop missing on army series', () => {
    const s = armySeries('archer', { values: [0, 50, 100], playerName: 'Bob' });
    const chart = makeChart('army', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    const ys = result.get('archer');
    assert.ok(ys instanceof Float32Array);
    assert.equal(ys[1], 50); // 0+(1-0.5)*100 = 50
  });
});

describe('ensureChartRenderCache – player aggregate bands', () => {
  it('adds player cache entries for army series with _playerBase/_playerTop', () => {
    const s = armySeries('knight', {
      stackBase: [0], stackTop: [50],
      playerBase: [0], playerTop: [80],
      playerName: 'Alice',
    });
    const chart = makeChart('army', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    const pk = playerCacheKey('Alice');
    assert.ok(result.has(pk));
    const entry = result.get(pk);
    assert.ok(entry.stackBase instanceof Float32Array);
    assert.ok(entry.stackTop instanceof Float32Array);
  });

  it('skips player band when _playerBase missing', () => {
    const s = armySeries('knight', {
      stackBase: [0], stackTop: [50],
      playerName: 'Bob',
    });
    const chart = makeChart('army', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    assert.ok(!result.has(playerCacheKey('Bob')));
  });

  it('only adds player band once per player', () => {
    const s1 = armySeries('knight', {
      stackBase: [0], stackTop: [20],
      playerBase: [0], playerTop: [50],
      playerName: 'Alice',
    });
    const s2 = armySeries('archer', {
      stackBase: [10], stackTop: [30],
      playerBase: [0], playerTop: [50],
      playerName: 'Alice',
    });
    const chart = makeChart('army', [s1, s2], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    assert.ok(result.has(playerCacheKey('Alice')));
  });

  it('skips series without playerName', () => {
    const s = armySeries('total', {
      stackBase: [0], stackTop: [10],
      playerBase: [0], playerTop: [10],
    });
    const chart = makeChart('army', [s], { geometry: { yMin: 0, yMax: 100 } });
    const result = ensureChartRenderCache(chart, makeMargin(0), 100);
    assert.ok(!result.has(playerCacheKey(undefined)));
  });
});

describe('getCollapsedPlayers', () => {
  it('returns empty set when no _legendNodes', () => {
    const chart = makeChart('army', []);
    const result = getCollapsedPlayers(chart);
    assert.ok(result instanceof Set);
    assert.equal(result.size, 0);
  });

  it('returns collapsed players whose units are all visible', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const nodes = new Map([
      ['__summary__Alice', { panelEl: { style: { display: 'none' } } }],
    ]);
    const chart = makeChart('army', [s1], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.ok(result.has('Alice'));
  });

  it('excludes players with hidden units', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice', hidden: true });
    const nodes = new Map([
      ['__summary__Alice', { panelEl: { style: { display: 'none' } } }],
    ]);
    const chart = makeChart('army', [s1], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.equal(result.size, 0);
  });

  it('excludes players whose panel is visible (not collapsed)', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const nodes = new Map([
      ['__summary__Alice', { panelEl: { style: { display: 'block' } } }],
    ]);
    const chart = makeChart('army', [s1], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.equal(result.size, 0);
  });

  it('treats missing panelEl as collapsed', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const nodes = new Map([
      ['__summary__Alice', { panelEl: null }],
    ]);
    const chart = makeChart('army', [s1], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.ok(result.has('Alice'));
  });

  it('ignores non-summary legend keys', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const nodes = new Map([
      ['knight', { panelEl: { style: { display: 'none' } } }],
    ]);
    const chart = makeChart('army', [s1], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.equal(result.size, 0);
  });

  it('ignores summary for players with no units', () => {
    const nodes = new Map([
      ['__summary__Ghost', { panelEl: { style: { display: 'none' } } }],
    ]);
    const chart = makeChart('army', [], { legendNodes: nodes });
    const result = getCollapsedPlayers(chart);
    assert.equal(result.size, 0);
  });
});

describe('isHighlightForPlayer', () => {
  it('returns true when no highlight is set', () => {
    const chart = makeChart('army', []);
    assert.ok(isHighlightForPlayer(chart, 'Alice'));
  });

  it('returns true when highlight matches player cache key', () => {
    const chart = makeChart('army', [], { highlightKey: playerCacheKey('Alice') });
    assert.ok(isHighlightForPlayer(chart, 'Alice'));
  });

  it('returns true when highlight is a unit key belonging to the player', () => {
    const s = armySeries('knight', { values: [1], playerName: 'Alice' });
    const chart = makeChart('army', [s], { highlightKey: 'knight' });
    assert.ok(isHighlightForPlayer(chart, 'Alice'));
  });

  it('returns false when highlight is a unit key belonging to another player', () => {
    const s = armySeries('knight', { values: [1], playerName: 'Bob' });
    const chart = makeChart('army', [s], { highlightKey: 'knight' });
    assert.ok(!isHighlightForPlayer(chart, 'Alice'));
  });

  it('returns false when highlight key not found in series', () => {
    const chart = makeChart('army', [], { highlightKey: 'unknown_key' });
    assert.ok(!isHighlightForPlayer(chart, 'Alice'));
  });
});

describe('renderer highlight condition', () => {
  function isItemHighlighted(chart, item) {
    return !chart.highlightKey
      || chart.highlightKey === item.key
      || (item.playerName && chart.highlightKey.startsWith('__player__:') && isHighlightForPlayer(chart, item.playerName));
  }

  it('highlights all items when no highlightKey is set', () => {
    const s = armySeries('knight', { values: [1], playerName: 'Alice' });
    const chart = makeChart('army', [s]);
    assert.ok(isItemHighlighted(chart, s));
  });

  it('highlights only the matching unit when highlightKey is a unit key', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [1], playerName: 'Alice' });
    const chart = makeChart('army', [s1, s2], { highlightKey: 'knight' });
    assert.ok(isItemHighlighted(chart, s1));
    assert.ok(!isItemHighlighted(chart, s2));
  });

  it('highlights all units of a player when highlightKey is a player cache key', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [1], playerName: 'Alice' });
    const s3 = armySeries('spearman', { values: [1], playerName: 'Bob' });
    const chart = makeChart('army', [s1, s2, s3], { highlightKey: playerCacheKey('Alice') });
    assert.ok(isItemHighlighted(chart, s1));
    assert.ok(isItemHighlighted(chart, s2));
    assert.ok(!isItemHighlighted(chart, s3));
  });

  it('does not use player-level matching for non-player highlight keys', () => {
    const s1 = armySeries('knight', { values: [1], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [1], playerName: 'Alice' });
    const chart = makeChart('army', [s1, s2], { highlightKey: 'knight' });
    assert.ok(isItemHighlighted(chart, s1));
    assert.ok(!isItemHighlighted(chart, s2));
  });
});

describe('playerValueSumAt', () => {
  it('sums absolute values for matching player at index', () => {
    const s1 = armySeries('knight', { values: [10, 20], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [5, -15], playerName: 'Alice' });
    const chart = makeChart('army', [s1, s2]);
    assert.equal(playerValueSumAt(chart, 'Alice', 0), 15);
    assert.equal(playerValueSumAt(chart, 'Alice', 1), 35);
  });

  it('excludes hidden series', () => {
    const s1 = armySeries('knight', { values: [10], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [5], playerName: 'Alice', hidden: true });
    const chart = makeChart('army', [s1, s2]);
    assert.equal(playerValueSumAt(chart, 'Alice', 0), 10);
  });

  it('excludes other players', () => {
    const s1 = armySeries('knight', { values: [10], playerName: 'Alice' });
    const s2 = armySeries('archer', { values: [5], playerName: 'Bob' });
    const chart = makeChart('army', [s1, s2]);
    assert.equal(playerValueSumAt(chart, 'Alice', 0), 10);
  });

  it('treats null/undefined values as 0', () => {
    const s1 = armySeries('knight', { values: [null], playerName: 'Alice' });
    const chart = makeChart('army', [s1]);
    assert.equal(playerValueSumAt(chart, 'Alice', 0), 0);
  });

  it('returns 0 when no series match', () => {
    const chart = makeChart('army', []);
    assert.equal(playerValueSumAt(chart, 'Alice', 0), 0);
  });
});
