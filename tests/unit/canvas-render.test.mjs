import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { devicePixelRatio: 1 };

import { drawTimelineCanvasChart } from '../../src/content/canvas-render.ts';

function makeCtx() {
  const calls = [];
  const ctx = {};
  const props = [
    'font', 'fillStyle', 'strokeStyle', 'textBaseline', 'textAlign',
    'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin', 'miterLimit',
  ];
  props.forEach(p => { ctx[p] = ''; });
  const methods = [
    'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'arc',
    'closePath', 'stroke', 'fill', 'fillRect', 'strokeRect', 'clearRect',
    'fillText', 'strokeText', 'setLineDash', 'rect', 'clip', 'translate',
    'scale', 'rotate', 'setTransform', 'quadraticCurveTo',
    'bezierCurveTo', 'drawImage',
  ];
  methods.forEach(m => { ctx[m] = (...args) => calls.push({ m, args }); });
  ctx.measureText = (s) => ({
    width: (s || '').length * 6,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  });
  ctx.createLinearGradient = () => ({ addColorStop: () => {} });
  ctx.createRadialGradient = () => ({ addColorStop: () => {} });
  ctx._calls = calls;
  return ctx;
}

function makeCanvas(w = 1000, h = 500) {
  const ctx = makeCtx();
  return {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style: {},
    parentElement: null,
    _ctx: ctx,
  };
}

const SAMPLE_COUNT = 10;
const LABELS = Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 60); // 0s..540s

function lineSeriesItem(key, values, opts = {}) {
  return {
    key,
    values,
    color: opts.color || '#ff0000',
    playerName: opts.playerName || 'Player1',
    _hidden: opts.hidden || false,
  };
}

function armySeriesItem(key, opts = {}) {
  const len = opts.len || SAMPLE_COUNT;
  const base = opts.stackBase || new Array(len).fill(0);
  const top = opts.stackTop || Array.from({ length: len }, (_, i) => i * 5);
  return {
    key,
    values: opts.values || top,
    color: opts.color || '#00ff00',
    baseColor: opts.baseColor || '#00dd00',
    playerName: opts.playerName || 'Player1',
    _hidden: opts.hidden || false,
    _stackBase: base,
    _stackTop: top,
    _playerBase: opts.playerBase || base,
    _playerTop: opts.playerTop || top,
    upgrades: opts.upgrades || [],
    _areaIcon: opts.areaIcon || undefined,
  };
}

function makeChart(type, series, opts = {}) {
  return {
    type,
    value: opts.value || type,
    data: { labels: opts.labels || [...LABELS], series },
    _geometry: opts.geometry || { yMin: 0, yMax: 100 },
    _legendNodes: opts.legendNodes || null,
    highlightKey: opts.highlightKey || null,
    ageUps: opts.ageUps || null,
  };
}


describe('drawTimelineCanvasChart', () => {
  it('returns early when ctx is null', () => {
    const canvas = {
      getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
      width: 1000, height: 500, clientWidth: 1000, clientHeight: 500,
      style: {},
    };
    drawTimelineCanvasChart(canvas, makeChart('workers', []), null);
  });

  describe('line-type charts (workers, population, apm)', () => {
    for (const chartType of ['workers', 'population', 'apm']) {
      it(`renders ${chartType} chart without error`, () => {
        const canvas = makeCanvas();
        const s1 = lineSeriesItem('p1', Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 3), { playerName: 'Alice' });
        const s2 = lineSeriesItem('p2', Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 2 + 1), { playerName: 'Bob', color: '#0000ff' });
        const chart = makeChart(chartType, [s1, s2]);
        drawTimelineCanvasChart(canvas, chart);
        assert.ok(canvas._ctx._calls.length > 0, 'expected ctx calls');
        const strokes = canvas._ctx._calls.filter(c => c.m === 'stroke');
        assert.ok(strokes.length >= 2, 'expected at least 2 stroke calls for gridlines + series');
      });

      it(`skips hidden series in ${chartType}`, () => {
        const canvas = makeCanvas();
        const s1 = lineSeriesItem('p1', [10, 20, 30], { hidden: true });
        const chart = makeChart(chartType, [s1], { labels: [0, 60, 120] });
        drawTimelineCanvasChart(canvas, chart);
        assert.ok(canvas._ctx._calls.length > 0);
      });

      it(`applies highlight styling when highlightKey is set`, () => {
        const canvas = makeCanvas();
        const s1 = lineSeriesItem('p1', [10, 20, 30], { playerName: 'Alice' });
        const s2 = lineSeriesItem('p2', [5, 10, 15], { playerName: 'Bob', color: '#00f' });
        const chart = makeChart(chartType, [s1, s2], { labels: [0, 60, 120], highlightKey: 'p1' });
        drawTimelineCanvasChart(canvas, chart);
        assert.ok(canvas._ctx._calls.length > 0);
      });
    }
  });

  describe('army chart', () => {
    it('renders stacked area bands for expanded players', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const s2 = armySeriesItem('unit-spear', { playerName: 'Bob', color: '#0000ff', baseColor: '#0000dd' });
      const chart = makeChart('army', [s1, s2]);
      drawTimelineCanvasChart(canvas, chart);
      const fills = canvas._ctx._calls.filter(c => c.m === 'fill');
      assert.ok(fills.length >= 2, 'expected fill calls for each series band');
    });

    it('renders collapsed player bands', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const legendNodes = new Map();
      legendNodes.set('__summary__Alice', { panelEl: { style: { display: 'none' } } });
      const chart = makeChart('army', [s1], { legendNodes });
      drawTimelineCanvasChart(canvas, chart);
      const fills = canvas._ctx._calls.filter(c => c.m === 'fill');
      assert.ok(fills.length >= 1, 'expected fill for collapsed band');
    });

    it('renders collapsed player with highlight', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const legendNodes = new Map();
      legendNodes.set('__summary__Alice', { panelEl: { style: { display: 'none' } } });
      const chart = makeChart('army', [s1], {
        legendNodes,
        highlightKey: '__player__:Alice',
      });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('skips hidden series', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { hidden: true });
      const chart = makeChart('army', [s1]);
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('handles series with highlightKey set', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const s2 = armySeriesItem('unit-spear', { playerName: 'Alice', color: '#ff0' });
      const chart = makeChart('army', [s1, s2], { highlightKey: 'unit-archer' });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('draws upgrade dots', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', {
        playerName: 'Alice',
        upgrades: [{ time: 120, name: 'Upgrade1' }, { time: 300, name: 'Upgrade2' }],
      });
      const chart = makeChart('army', [s1]);
      drawTimelineCanvasChart(canvas, chart);
      const arcs = canvas._ctx._calls.filter(c => c.m === 'arc');
      assert.ok(arcs.length >= 2, 'expected arc calls for upgrade dots');
    });

    it('draws upgrade dots for collapsed players', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', {
        playerName: 'Alice',
        upgrades: [{ time: 120, name: 'Upg1' }],
      });
      const legendNodes = new Map();
      legendNodes.set('__summary__Alice', { panelEl: { style: { display: 'none' } } });
      const chart = makeChart('army', [s1], { legendNodes });
      drawTimelineCanvasChart(canvas, chart);
      const arcs = canvas._ctx._calls.filter(c => c.m === 'arc');
      assert.ok(arcs.length >= 1);
    });

    it('renders unit icons when _areaIcon is pre-loaded', () => {
      const canvas = makeCanvas();
      const fakeImg = { width: 32, height: 32 };
      const s1 = armySeriesItem('unit-archer', {
        playerName: 'Alice',
        stackBase: new Array(SAMPLE_COUNT).fill(0),
        stackTop: Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 10),
        areaIcon: { url: 'http://example.com/icon.png', entry: { loaded: true, img: fakeImg } },
      });
      const chart = makeChart('army', [s1]);
      drawTimelineCanvasChart(canvas, chart);
      const draws = canvas._ctx._calls.filter(c => c.m === 'drawImage');
      assert.ok(draws.length >= 1, 'expected drawImage call for unit icon');
    });

    it('skips unit icons for collapsed players', () => {
      const canvas = makeCanvas();
      const fakeImg = { width: 32, height: 32 };
      const s1 = armySeriesItem('unit-archer', {
        playerName: 'Alice',
        areaIcon: { url: 'http://example.com/icon.png', entry: { loaded: true, img: fakeImg } },
      });
      const legendNodes = new Map();
      legendNodes.set('__summary__Alice', { panelEl: { style: { display: 'none' } } });
      const chart = makeChart('army', [s1], { legendNodes });
      drawTimelineCanvasChart(canvas, chart);
      const draws = canvas._ctx._calls.filter(c => c.m === 'drawImage');
      assert.equal(draws.length, 0);
    });
  });

  describe('lead chart', () => {
    it('renders lead chart with positive/negative fills', () => {
      const canvas = makeCanvas();
      const vals = [-10, -5, 0, 5, 10, 15, 10, 5, 0, -5];
      const s1 = lineSeriesItem('lead1', vals, { playerName: 'Alice' });
      const chart = makeChart('lead', [s1], { geometry: { yMin: -20, yMax: 20 } });
      drawTimelineCanvasChart(canvas, chart);
      const fills = canvas._ctx._calls.filter(c => c.m === 'fill');
      assert.ok(fills.length >= 1, 'expected fill for lead area');
    });

    it('draws zero line for negative yMin', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('lead1', [-10, -5, 0, 5, 10], { playerName: 'Alice' });
      const chart = makeChart('lead', [s1], {
        labels: [0, 60, 120, 180, 240],
        geometry: { yMin: -20, yMax: 20 },
      });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('skips hidden lead series', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('lead1', [10, 20], { hidden: true });
      const chart = makeChart('lead', [s1], {
        labels: [0, 60],
        geometry: { yMin: -20, yMax: 20 },
      });
      drawTimelineCanvasChart(canvas, chart);
      const fills = canvas._ctx._calls.filter(c => c.m === 'fill');
      assert.equal(fills.length, 0, 'no fill for hidden series');
    });

    it('applies highlight styling in lead chart', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('lead1', [10, 20, 30], { playerName: 'Alice' });
      const s2 = lineSeriesItem('lead2', [-10, -20, -30], { playerName: 'Bob', color: '#00f' });
      const chart = makeChart('lead', [s1, s2], {
        labels: [0, 60, 120],
        geometry: { yMin: -30, yMax: 30 },
        highlightKey: 'lead1',
      });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });
  });

  describe('canvas resizing', () => {
    it('resizes backing store when dimensions differ', () => {
      const canvas = makeCanvas(1000, 500);
      canvas.width = 0;
      canvas.height = 0;
      const chart = makeChart('workers', [lineSeriesItem('p1', [1, 2, 3])], { labels: [0, 60, 120] });
      drawTimelineCanvasChart(canvas, chart);
      assert.equal(canvas.width, 1000);
      assert.equal(canvas.height, 500);
    });

    it('does not resize when dimensions match', () => {
      const canvas = makeCanvas(1000, 500);
      const chart = makeChart('workers', [lineSeriesItem('p1', [1, 2, 3])], { labels: [0, 60, 120] });
      canvas.width = 1000;
      canvas.height = 500;
      drawTimelineCanvasChart(canvas, chart);
      assert.equal(canvas.width, 1000);
    });
  });

  describe('age-up indicators', () => {
    it('renders age-up indicators when ageUps are provided', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 3));
      const ageUps = [
        { player: 'Alice', age: 2, time: 180, color: '#ff0' },
        { player: 'Bob', age: 3, time: 300, color: '#0ff' },
      ];
      const chart = makeChart('workers', [s1], { ageUps });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });
  });

  describe('hover / tooltip', () => {
    it('draws tooltip crosshair when hoverIndex is provided', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', Array.from({ length: SAMPLE_COUNT }, (_, i) => i * 3));
      const chart = makeChart('workers', [s1]);
      drawTimelineCanvasChart(canvas, chart, 5);
      const saves = canvas._ctx._calls.filter(c => c.m === 'save');
      assert.ok(saves.length >= 2, 'tooltip should call save');
    });

    it('skips tooltip when hoverIndex is out of range', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', [1, 2, 3]);
      const chart = makeChart('workers', [s1], { labels: [0, 60, 120] });
      // hoverIndex 99 — labels[99] is undefined → skip
      const callsBefore = canvas._ctx._calls.length;
      drawTimelineCanvasChart(canvas, chart, 99);
      assert.ok(canvas._ctx._calls.length > callsBefore || canvas._ctx._calls.length > 0);
    });
  });

  describe('range selection overlay (army)', () => {
    it('draws drag preview overlay', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const chart = makeChart('army', [s1]);
      canvas.parentElement = {
        __aoe4ActiveDrag: { chartValue: 'army', anchorIdx: 2, currentIdx: 7 },
        __aoe4ActiveRange: null,
      };
      drawTimelineCanvasChart(canvas, chart);
      const fillRects = canvas._ctx._calls.filter(c => c.m === 'fillRect');
      assert.ok(fillRects.length >= 1, 'expected fillRect for range overlay');
    });

    it('draws committed range overlay', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer', { playerName: 'Alice' });
      const chart = makeChart('army', [s1]);
      canvas.parentElement = {
        __aoe4ActiveDrag: null,
        __aoe4ActiveRange: { chartValue: 'army', startIdx: 1, endIdx: 5 },
      };
      drawTimelineCanvasChart(canvas, chart);
      const fillRects = canvas._ctx._calls.filter(c => c.m === 'fillRect');
      assert.ok(fillRects.length >= 1, 'expected fillRect for committed range');
    });

    it('skips range overlay for non-army charts', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', [1, 2, 3]);
      const chart = makeChart('workers', [s1], { labels: [0, 60, 120] });
      canvas.parentElement = {
        __aoe4ActiveRange: { chartValue: 'workers', startIdx: 0, endIdx: 2 },
      };
      drawTimelineCanvasChart(canvas, chart);
      // Range overlay only runs for army charts, so no extra fillRect beyond clearRect
      const fillRects = canvas._ctx._calls.filter(c => c.m === 'fillRect');
      assert.equal(fillRects.length, 0);
    });

    it('skips range overlay when chartValue does not match', () => {
      const canvas = makeCanvas();
      const s1 = armySeriesItem('unit-archer');
      const chart = makeChart('army', [s1]);
      canvas.parentElement = {
        __aoe4ActiveDrag: null,
        __aoe4ActiveRange: { chartValue: 'other', startIdx: 0, endIdx: 2 },
      };
      drawTimelineCanvasChart(canvas, chart);
      const fillRects = canvas._ctx._calls.filter(c => c.m === 'fillRect');
      assert.equal(fillRects.length, 0, 'no overlay when chartValue mismatches');
    });
  });

  describe('zero line', () => {
    it('draws zero line when yMin < 0 for non-lead charts', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', [-5, 0, 5]);
      const chart = makeChart('workers', [s1], {
        labels: [0, 60, 120],
        geometry: { yMin: -10, yMax: 10 },
      });
      drawTimelineCanvasChart(canvas, chart);
      const saves = canvas._ctx._calls.filter(c => c.m === 'save');
      assert.ok(saves.length >= 2);
    });

    it('draws thicker zero line for lead chart', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('lead1', [-5, 0, 5]);
      const chart = makeChart('lead', [s1], {
        labels: [0, 60, 120],
        geometry: { yMin: -10, yMax: 10 },
      });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });
  });

  describe('edge cases', () => {
    it('handles empty series array', () => {
      const canvas = makeCanvas();
      const chart = makeChart('workers', []);
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0, 'should still draw gridlines');
    });

    it('handles single data point', () => {
      const canvas = makeCanvas();
      const s1 = lineSeriesItem('p1', [42]);
      const chart = makeChart('workers', [s1], { labels: [0] });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('handles army series missing _stackBase/_stackTop', () => {
      const canvas = makeCanvas();
      const s1 = { key: 'bad', values: [1, 2, 3], color: '#f00', playerName: 'X', _hidden: false };
      const chart = makeChart('army', [s1], { labels: [0, 60, 120] });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });

    it('handles default hoverIndex parameter', () => {
      const canvas = makeCanvas();
      const chart = makeChart('workers', [lineSeriesItem('p1', [1, 2])], { labels: [0, 60] });
      drawTimelineCanvasChart(canvas, chart);
      assert.ok(canvas._ctx._calls.length > 0);
    });
  });
});
