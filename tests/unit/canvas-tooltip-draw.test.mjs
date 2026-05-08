import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drawCanvasTooltip } from '../../src/content/canvas-tooltip-draw.ts';

function makeCtx() {
  const calls = [];
  const ctx = new Proxy(
    { font: '', fillStyle: '', strokeStyle: '', textBaseline: '', textAlign: '', lineWidth: 1, globalAlpha: 1, _calls: calls },
    {
      get(t, k) {
        if (k in t) return t[k];
        return (...args) => { calls.push({ m: k, args }); };
      },
      set(t, k, v) { calls.push({ s: k, v }); t[k] = v; return true; },
    },
  );
  ctx.measureText = (s) => ({ width: (s || '').length * 6 });
  return ctx;
}

describe('drawCanvasTooltip', () => {
  const margin = { top: 10, left: 20, right: 10, bottom: 10 };
  const plotW = 400;
  const plotH = 200;

  it('draws a vertical crosshair line at the correct x position', () => {
    const ctx = makeCtx();
    const chart = { data: { labels: ['a', 'b', 'c', 'd', 'e'] } };
    drawCanvasTooltip(ctx, chart, 2, margin, plotW, plotH, 0, 100, 500);

    const methods = ctx._calls.filter(c => c.m).map(c => c.m);
    assert.ok(methods.includes('save'), 'should call save');
    assert.ok(methods.includes('beginPath'), 'should call beginPath');
    assert.ok(methods.includes('moveTo'), 'should call moveTo');
    assert.ok(methods.includes('lineTo'), 'should call lineTo');
    assert.ok(methods.includes('stroke'), 'should call stroke');
    assert.ok(methods.includes('restore'), 'should call restore');

    const sets = ctx._calls.filter(c => c.s);
    assert.ok(sets.some(c => c.s === 'strokeStyle' && c.v === 'rgba(255,255,255,0.55)'));
    assert.ok(sets.some(c => c.s === 'lineWidth' && c.v === 1));
  });

  it('computes x via summaryScaleX for index 0', () => {
    const ctx = makeCtx();
    const chart = { data: { labels: ['a', 'b', 'c'] } };
    drawCanvasTooltip(ctx, chart, 0, margin, plotW, plotH, 0, 100, 500);

    const moveTo = ctx._calls.find(c => c.m === 'moveTo');
    // index 0 => margin.left + 0 = 20
    assert.deepStrictEqual(moveTo.args[0], 20);
    assert.deepStrictEqual(moveTo.args[1], margin.top);
  });

  it('computes x via summaryScaleX for last index', () => {
    const ctx = makeCtx();
    const chart = { data: { labels: ['a', 'b', 'c'] } };
    drawCanvasTooltip(ctx, chart, 2, margin, plotW, plotH, 0, 100, 500);

    const moveTo = ctx._calls.find(c => c.m === 'moveTo');
    // index 2, count 3 => margin.left + (2/2)*plotW = 20 + 400 = 420
    assert.deepStrictEqual(moveTo.args[0], 420);
  });

  it('lineTo uses margin.top + plotH as y', () => {
    const ctx = makeCtx();
    const chart = { data: { labels: ['a', 'b'] } };
    drawCanvasTooltip(ctx, chart, 1, margin, plotW, plotH, 0, 100, 500);

    const lineTo = ctx._calls.find(c => c.m === 'lineTo');
    assert.deepStrictEqual(lineTo.args[1], margin.top + plotH);
  });

  it('handles single-label chart (count=1)', () => {
    const ctx = makeCtx();
    const chart = { data: { labels: ['only'] } };
    drawCanvasTooltip(ctx, chart, 0, margin, plotW, plotH, 0, 100, 500);

    const moveTo = ctx._calls.find(c => c.m === 'moveTo');
    // count <= 1 => x = margin.left + 0 = 20
    assert.deepStrictEqual(moveTo.args[0], 20);
  });
});
