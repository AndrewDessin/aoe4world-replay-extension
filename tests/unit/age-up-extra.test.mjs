import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawAgeUpIndicators, drawAgeUpOverlay,
  planAgeUpPlacement, ageUpMarginTopForRows, AGE_UP_DEFAULT_MARGIN,
} from '../../src/content/age-up.ts';


function fakeCtx(charPx = 8) {
  const calls = [];
  const record = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    setLineDash: record('setLineDash'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    fillRect: record('fillRect'),
    clearRect: record('clearRect'),
    setTransform: record('setTransform'),
    measureText: (s) => ({ width: String(s).length * charPx }),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  };
}


test('drawAgeUpIndicators early-returns on empty ageUps', () => {
  const ctx = fakeCtx();
  drawAgeUpIndicators(ctx, [], {
    margin: { top: 20, right: 15, bottom: 35, left: 45 },
    plotW: 700, plotH: 300, cssWidth: 800, gameDuration: 600,
  });
  assert.equal(ctx.calls.length, 0, 'no ctx calls when ageUps is empty');
});

test('drawAgeUpIndicators early-returns when gameDuration <= 0', () => {
  const ctx = fakeCtx();
  drawAgeUpIndicators(ctx, [{ gameTimeSec: 100, label: 'II', color: '#f00' }], {
    margin: { top: 20, right: 15, bottom: 35, left: 45 },
    plotW: 700, plotH: 300, cssWidth: 800, gameDuration: 0,
  });
  assert.equal(ctx.calls.length, 0);
});

test('drawAgeUpIndicators draws lines and labels for each item', () => {
  const ctx = fakeCtx();
  const ageUps = [
    { gameTimeSec: 300, label: 'II', color: '#ff0000' },
    { gameTimeSec: 600, label: 'III', color: '#00ff00' },
  ];
  const margin = { top: 30, right: 15, bottom: 35, left: 45 };
  const plotW = 740;
  const plotH = 300;
  const cssWidth = 800;
  const gameDuration = 1000;

  drawAgeUpIndicators(ctx, ageUps, { margin, plotW, plotH, cssWidth, gameDuration });

  const names = ctx.calls.map(c => c.name);
  assert.ok(names.includes('save'), 'calls save');
  assert.ok(names.includes('restore'), 'calls restore');
  assert.ok(names.includes('beginPath'), 'draws lines');
  assert.ok(names.includes('stroke'), 'strokes lines');
  assert.ok(names.includes('fillText'), 'draws text labels');

  const fillTexts = ctx.calls.filter(c => c.name === 'fillText');
  assert.equal(fillTexts.length, 2);
  assert.equal(fillTexts[0].args[0], 'II');
  assert.equal(fillTexts[1].args[0], 'III');
});

test('drawAgeUpIndicators uses provided placement instead of computing', () => {
  const ctx = fakeCtx();
  const ageUps = [{ gameTimeSec: 100, label: 'II', color: '#abc' }];
  const placement = {
    items: [{
      ageUp: ageUps[0], x: 150, labelX: 155, halfW: 8, text: 'II', row: 0,
    }],
    rowCount: 1,
  };
  const margin = { top: 30, right: 15, bottom: 35, left: 45 };
  drawAgeUpIndicators(ctx, ageUps, {
    margin, plotW: 740, plotH: 300, cssWidth: 800, gameDuration: 600, placement,
  });

  const fillTexts = ctx.calls.filter(c => c.name === 'fillText');
  assert.equal(fillTexts.length, 1);
  assert.equal(fillTexts[0].args[0], 'II');
  assert.equal(fillTexts[0].args[1], 155);
});

test('drawAgeUpIndicators restores globalAlpha and lineDash', () => {
  const ctx = fakeCtx();
  const ageUps = [{ gameTimeSec: 200, label: 'III', color: '#000' }];
  const margin = { top: 30, right: 15, bottom: 35, left: 45 };
  drawAgeUpIndicators(ctx, ageUps, {
    margin, plotW: 740, plotH: 300, cssWidth: 800, gameDuration: 600,
  });
  assert.equal(ctx.globalAlpha, 1);
  const dashCalls = ctx.calls.filter(c => c.name === 'setLineDash');
  const lastDash = dashCalls[dashCalls.length - 1];
  assert.deepEqual(lastDash.args[0], []);
});

test('drawAgeUpIndicators sets strokeStyle per item color', () => {
  const ctx = fakeCtx();
  const ageUps = [
    { gameTimeSec: 100, label: 'II', color: '#aa0000' },
    { gameTimeSec: 500, label: 'III', color: '#00bb00' },
  ];
  const margin = { top: 30, right: 15, bottom: 35, left: 45 };
  drawAgeUpIndicators(ctx, ageUps, {
    margin, plotW: 740, plotH: 300, cssWidth: 800, gameDuration: 600,
  });
  const strokes = ctx.calls.filter(c => c.name === 'stroke');
  assert.equal(strokes.length, 2);
});

test('drawAgeUpIndicators handles row stacking in placement', () => {
  const ctx = fakeCtx();
  const ageUps = [
    { gameTimeSec: 100, label: 'II', color: '#000' },
    { gameTimeSec: 100, label: 'II', color: '#111' },
  ];
  const placement = {
    items: [
      { ageUp: ageUps[0], x: 150, labelX: 150, halfW: 8, text: 'II', row: 0 },
      { ageUp: ageUps[1], x: 150, labelX: 150, halfW: 8, text: 'II', row: 1 },
    ],
    rowCount: 2,
  };
  const margin = { top: 50, right: 15, bottom: 35, left: 45 };
  drawAgeUpIndicators(ctx, ageUps, {
    margin, plotW: 740, plotH: 300, cssWidth: 800, gameDuration: 600, placement,
  });
  const fillTexts = ctx.calls.filter(c => c.name === 'fillText');
  assert.equal(fillTexts.length, 2);
  // Row 1 label should be higher (lower Y) than row 0 label
  assert.ok(fillTexts[1].args[2] < fillTexts[0].args[2],
    'higher row has lower Y coordinate');
});


function makeOverlayDOM() {
  const chartBox = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    querySelector: () => null,
  };
  const nativeCanvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  };

  const ctx = fakeCtx();
  const overlay = {
    style: {},
    width: 0,
    height: 0,
    parentElement: chartBox,
    getContext: (type) => (type === '2d' ? ctx : null),
  };

  // Expose devicePixelRatio on the global
  globalThis.window = globalThis.window || {};
  globalThis.window.devicePixelRatio = 1;

  return { overlay, nativeCanvas, chartBox, ctx };
}

test('drawAgeUpOverlay returns early when chartBox is missing', () => {
  const detached = { style: {}, width: 0, height: 0, getContext: () => null, parentElement: null };
  drawAgeUpOverlay(detached, [], {}, { chartBox: null, canvas: null });
});

test('drawAgeUpOverlay returns early when canvasRect has zero width', () => {
  const { overlay, chartBox, nativeCanvas } = makeOverlayDOM();
  nativeCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 400 });
  drawAgeUpOverlay(overlay, [], { duration: 600 }, { chartBox, canvas: nativeCanvas });
});

test('drawAgeUpOverlay positions the overlay and draws indicators', () => {
  const { overlay, chartBox, nativeCanvas, ctx } = makeOverlayDOM();
  const ageUps = [
    { gameTimeSec: 300, label: 'II', color: '#ff0000', playerName: 'P1' },
  ];
  const summary = { duration: 600 };
  const timeline = { chartBox, canvas: nativeCanvas };

  drawAgeUpOverlay(overlay, ageUps, summary, timeline);

  assert.equal(overlay.style.left, '0px');
  assert.equal(overlay.style.top, '0px');
  assert.equal(overlay.style.width, '800px');
  assert.equal(overlay.style.height, '400px');

  const names = ctx.calls.map(c => c.name);
  assert.ok(names.includes('setTransform'), 'scales for DPR');
  assert.ok(names.includes('clearRect'), 'clears canvas');
  assert.ok(names.includes('fillText'), 'draws age-up labels');
});

test('drawAgeUpOverlay returns early when getContext returns null', () => {
  const { overlay, chartBox, nativeCanvas } = makeOverlayDOM();
  overlay.getContext = () => null;
  drawAgeUpOverlay(overlay, [{ gameTimeSec: 100, label: 'II', color: '#000' }],
    { duration: 600 }, { chartBox, canvas: nativeCanvas });
});

test('drawAgeUpOverlay uses parentElement when timeline has no chartBox', () => {
  const { overlay, chartBox, nativeCanvas, ctx } = makeOverlayDOM();
  overlay.parentElement = chartBox;
  const ageUps = [{ gameTimeSec: 100, label: 'II', color: '#f00', playerName: 'A' }];
  drawAgeUpOverlay(overlay, ageUps, { duration: 300 }, { canvas: nativeCanvas });
  const names = ctx.calls.map(c => c.name);
  assert.ok(names.includes('fillText'));
});

test('drawAgeUpOverlay with empty ageUps clears canvas but skips drawing', () => {
  const { overlay, chartBox, nativeCanvas, ctx } = makeOverlayDOM();
  drawAgeUpOverlay(overlay, [], { duration: 600 }, { chartBox, canvas: nativeCanvas });
  const names = ctx.calls.map(c => c.name);
  assert.ok(names.includes('clearRect'), 'canvas is cleared');
  assert.ok(!names.includes('fillText'), 'no labels drawn');
});
