import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  clientXToSampleIndex,
  getActiveRange,
  getActiveDrag,
  clearRangeState,
  ensureResetButton,
  syncRangeUi,
  applyRangeLegend,
  countInRange,
  countAfterStartInRange,
} from '../../src/content/range.ts';

function setupDOM() {
  const { document, HTMLElement } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = document;
  globalThis.HTMLElement = HTMLElement;
  globalThis.getComputedStyle = () => ({
    position: 'static',
    getPropertyValue: () => '',
  });
  return document;
}

function makeCanvas(doc, labels) {
  const canvas = doc.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400,
  });
  return canvas;
}

function makeChart(value, type, labels) {
  return {
    value,
    type: type || 'army',
    data: { labels: labels || [0, 10, 20, 30, 40], series: [] },
    _legendNodes: null,
  };
}

function makeTimeline(doc) {
  const chartBox = doc.createElement('div');
  const canvas = makeCanvas(doc);
  const select = doc.createElement('select');
  chartBox.appendChild(canvas);
  return { chartBox, canvas, select };
}

describe('countAfterStartInRange', () => {
  test('excludes the left boundary and includes the right boundary', () => {
    const times = [10, 10, 20, 30, 30, 40];
    assert.equal(countAfterStartInRange(times, 10, 30), 3);
    assert.equal(countAfterStartInRange(times, 30, 40), 1);
    assert.equal(countAfterStartInRange(times, 40, 50), 0);
  });
});

describe('clientXToSampleIndex', () => {
  let doc, canvas;
  beforeEach(() => {
    doc = setupDOM();
    canvas = makeCanvas(doc);
  });

  test('returns 0 for empty labels', () => {
    const chart = makeChart('a', 'army', []);
    assert.equal(clientXToSampleIndex(canvas, chart, 100), 0);
  });

  test('returns 0 for null labels', () => {
    const chart = { value: 'a', data: { labels: null } };
    assert.equal(clientXToSampleIndex(canvas, chart, 100), 0);
  });

  test('clamps to 0 when clientX far left', () => {
    const chart = makeChart('a', 'army', [0, 10, 20, 30, 40]);
    assert.equal(clientXToSampleIndex(canvas, chart, -9999), 0);
  });

  test('clamps to last index when clientX far right', () => {
    const chart = makeChart('a', 'army', [0, 10, 20, 30, 40]);
    assert.equal(clientXToSampleIndex(canvas, chart, 9999), 4);
  });

  test('returns middle index for center clientX', () => {
    // margin.left=28, margin.right=14, width=800 → plotW=758
    // midX = 28 + 758/2 = 28 + 379 = 407
    // raw = (407 - 0 - 28) / 758 * 4 = 379/758*4 = 2.0
    const chart = makeChart('a', 'army', [0, 10, 20, 30, 40]);
    assert.equal(clientXToSampleIndex(canvas, chart, 407), 2);
  });

  test('returns correct index at left margin edge', () => {
    const chart = makeChart('a', 'army', [0, 10, 20, 30, 40]);
    assert.equal(clientXToSampleIndex(canvas, chart, 28), 0);
  });

  test('single-element labels always returns 0', () => {
    const chart = makeChart('a', 'army', [42]);
    assert.equal(clientXToSampleIndex(canvas, chart, 400), 0);
  });
});

describe('getActiveRange', () => {
  test('returns null for null chartBox', () => {
    const chart = makeChart('a');
    assert.equal(getActiveRange(null, chart), null);
  });

  test('returns null when no __aoe4ActiveRange', () => {
    const chartBox = {};
    const chart = makeChart('a');
    assert.equal(getActiveRange(chartBox, chart), null);
  });

  test('returns null when chartValue mismatch', () => {
    const chartBox = { __aoe4ActiveRange: { chartValue: 'other', startIdx: 0, endIdx: 1 } };
    const chart = makeChart('a');
    assert.equal(getActiveRange(chartBox, chart), null);
  });

  test('returns range when chartValue matches', () => {
    const range = { chartValue: 'a', startIdx: 1, endIdx: 3 };
    const chartBox = { __aoe4ActiveRange: range };
    const chart = makeChart('a');
    assert.strictEqual(getActiveRange(chartBox, chart), range);
  });
});

describe('getActiveDrag', () => {
  test('returns null for null chartBox', () => {
    assert.equal(getActiveDrag(null, makeChart('a')), null);
  });

  test('returns null when no __aoe4ActiveDrag', () => {
    assert.equal(getActiveDrag({}, makeChart('a')), null);
  });

  test('returns null when chartValue mismatch', () => {
    const chartBox = { __aoe4ActiveDrag: { chartValue: 'other' } };
    assert.equal(getActiveDrag(chartBox, makeChart('a')), null);
  });

  test('returns drag when chartValue matches', () => {
    const drag = { chartValue: 'a' };
    const chartBox = { __aoe4ActiveDrag: drag };
    assert.strictEqual(getActiveDrag(chartBox, makeChart('a')), drag);
  });
});

describe('clearRangeState', () => {
  test('no-op for null chartBox', () => {
    clearRangeState(null); // should not throw
  });

  test('clears range and drag', () => {
    const chartBox = {
      __aoe4ActiveRange: { startIdx: 0, endIdx: 5 },
      __aoe4ActiveDrag: { x: 10 },
    };
    clearRangeState(chartBox);
    assert.equal(chartBox.__aoe4ActiveRange, null);
    assert.equal(chartBox.__aoe4ActiveDrag, null);
  });

  test('aborts __aoe4DragAbort and clears it', () => {
    let aborted = false;
    const chartBox = {
      __aoe4DragAbort: { abort() { aborted = true; } },
    };
    clearRangeState(chartBox);
    assert.ok(aborted, 'abort() should have been called');
    assert.equal(chartBox.__aoe4DragAbort, null);
  });

  test('handles no __aoe4DragAbort gracefully', () => {
    const chartBox = {};
    clearRangeState(chartBox); // no throw
    assert.equal(chartBox.__aoe4ActiveRange, null);
  });
});

describe('ensureResetButton', () => {
  let doc;
  beforeEach(() => { doc = setupDOM(); });

  test('returns null when timeline has no chartBox', () => {
    assert.equal(ensureResetButton({}), null);
    assert.equal(ensureResetButton(null), null);
  });

  test('creates button on first call and returns it', () => {
    const timeline = makeTimeline(doc);
    const btn = ensureResetButton(timeline);
    assert.ok(btn, 'button should be created');
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.className, 'aoe4-range-reset');
    assert.equal(btn.textContent, 'Reset');
    assert.equal(btn.style.display, 'none');
    assert.equal(btn.type, 'button');
  });

  test('sets position:relative on static chartBox', () => {
    const timeline = makeTimeline(doc);
    ensureResetButton(timeline);
    assert.equal(timeline.chartBox.style.position, 'relative');
  });

  test('is idempotent — second call returns same button', () => {
    const timeline = makeTimeline(doc);
    const btn1 = ensureResetButton(timeline);
    const btn2 = ensureResetButton(timeline);
    assert.strictEqual(btn1, btn2);
  });

  test('does not duplicate buttons on repeated calls', () => {
    const timeline = makeTimeline(doc);
    ensureResetButton(timeline);
    ensureResetButton(timeline);
    const buttons = timeline.chartBox.querySelectorAll('.aoe4-range-reset');
    assert.equal(buttons.length, 1);
  });

  test('does not override non-static position', () => {
    const timeline = makeTimeline(doc);
    globalThis.getComputedStyle = () => ({
      position: 'absolute',
      getPropertyValue: () => '',
    });
    ensureResetButton(timeline);
    assert.notEqual(timeline.chartBox.style.position, 'relative');
  });
});

describe('syncRangeUi', () => {
  let doc;
  beforeEach(() => { doc = setupDOM(); });

  test('no-op when chartBox is null', () => {
    syncRangeUi({}, makeChart('a')); // no throw
  });

  test('no-op when chart is null', () => {
    const timeline = makeTimeline(doc);
    syncRangeUi(timeline, null); // no throw
  });

  test('non-army chart — button hidden, no legend changes', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('resources', 'resources');
    syncRangeUi(timeline, chart);
    const btn = timeline.chartBox.querySelector('.aoe4-range-reset');
    assert.equal(btn.style.display, 'none');
  });

  test('army chart without range — button hidden', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    syncRangeUi(timeline, chart);
    const btn = timeline.chartBox.querySelector('.aoe4-range-reset');
    assert.equal(btn.style.display, 'none');
  });

  test('army chart with range — button visible', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 1, endIdx: 3 };
    syncRangeUi(timeline, chart);
    const btn = timeline.chartBox.querySelector('.aoe4-range-reset');
    assert.equal(btn.style.display, '');
  });

  test('army with range clears hover state', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };
    timeline.chartBox.__aoe4HoverActive = true;
    timeline.canvas.__aoe4HoverActive = true;
    syncRangeUi(timeline, chart);
    assert.equal(timeline.chartBox.__aoe4HoverActive, false);
    assert.equal(timeline.canvas.__aoe4HoverActive, false);
  });

  test('army with range hides mini tooltip if present', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };
    const mini = doc.createElement('div');
    mini.style.display = 'block';
    mini.__lastIndex = 5;
    mini.__lastClosest = 'foo';
    timeline.canvas.__aoe4SummaryHandlers = { armyMiniTooltip: mini };
    syncRangeUi(timeline, chart);
    assert.equal(mini.style.display, 'none');
    assert.equal(mini.__lastIndex, undefined);
    assert.equal(mini.__lastClosest, undefined);
  });

  test('army no range, hover not active → calls resetLegendSummary path', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    chart._legendNodes = null; // resetLegendSummary returns early on null
    timeline.chartBox.__aoe4HoverActive = false;
    syncRangeUi(timeline, chart);
    const btn = timeline.chartBox.querySelector('.aoe4-range-reset');
    assert.equal(btn.style.display, 'none');
  });

  test('army no range, hover active → leaves legend alone', () => {
    const timeline = makeTimeline(doc);
    const chart = makeChart('army', 'army');
    timeline.chartBox.__aoe4HoverActive = true;
    syncRangeUi(timeline, chart);
    const btn = timeline.chartBox.querySelector('.aoe4-range-reset');
    assert.equal(btn.style.display, 'none');
  });
});

describe('applyRangeLegend', () => {
  let doc;
  beforeEach(() => { doc = setupDOM(); });

  test('returns early when _legendNodes is null', () => {
    const chart = makeChart('army', 'army');
    chart._legendNodes = null;
    const timeline = makeTimeline(doc);
    applyRangeLegend(chart, timeline); // no throw
  });

  test('returns early when _legendNodes is empty map', () => {
    const chart = makeChart('army', 'army');
    chart._legendNodes = new Map();
    const timeline = makeTimeline(doc);
    applyRangeLegend(chart, timeline); // no throw
  });

  test('calls resetLegendSummary path when no active range', () => {
    const chart = makeChart('army', 'army');
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl, summaryTotal: 5 };
    chart._legendNodes = new Map([['unit1', node]]);
    const timeline = makeTimeline(doc);
    applyRangeLegend(chart, timeline); // no throw
    assert.equal(totalEl.textContent, '5');
  });

  test('calls resetLegendSummary when labels at range indices are undefined', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl, summaryTotal: 3 };
    chart._legendNodes = new Map([['unit1', node]]);
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 10, endIdx: 20 };
    applyRangeLegend(chart, timeline); // no throw
    assert.equal(totalEl.textContent, '3');
  });

  test('processes series items with valid range', () => {
    const chart = makeChart('army', 'army', [0, 10, 20, 30, 40]);
    const rowEl = doc.createElement('tr');
    rowEl.style.display = '';
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    const summaryLabelEl = doc.createElement('td');

    chart._legendNodes = new Map([
      ['unit1', node],
      ['__summary__Player1', {
        panelEl: { style: { display: '' } }, // expanded
        summaryLabelEl,
        units: [{
          _finishedTimes: [5, 15, 25],
          _destroyedTimes: [10],
          unitLabel: 'Spearman',
        }],
      }],
    ]);

    chart.data.series = [
      {
        key: 'unit1',
        playerName: 'Player1',
        _hidden: false,
        _finishedTimes: [5, 15, 25],
        _destroyedTimes: [10],
        values: [0, 1, 2, 3, 4],
      },
    ];

    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 1, endIdx: 3 };

    applyRangeLegend(chart, timeline);

    assert.equal(rowEl.style.display, '');
    assert.equal(totalEl.textContent, '1');
    assert.ok(summaryLabelEl.innerHTML.length > 0);
  });

  test('hides row when item is hidden', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    rowEl.style.display = '';
    const node = { rowEl };
    chart._legendNodes = new Map([['unit1', node]]);
    chart.data.series = [{ key: 'unit1', _hidden: true }];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };

    applyRangeLegend(chart, timeline);
    assert.equal(rowEl.style.display, 'none');
  });

  test('hides row when trained=0, lost=0, and unit is absent throughout the range', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    const summaryLabelEl = doc.createElement('td');
    chart._legendNodes = new Map([
      ['unit1', node],
      ['__summary__P1', {
        panelEl: { style: { display: '' } },
        summaryLabelEl,
        units: [{ _finishedTimes: [], _destroyedTimes: [], unitLabel: 'X' }],
      }],
    ]);
    chart.data.series = [{
      key: 'unit1',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [],
      _destroyedTimes: [],
      values: [0, 0, 0],
    }];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };

    applyRangeLegend(chart, timeline);
    assert.equal(rowEl.style.display, 'none');
    assert.ok(summaryLabelEl.innerHTML.includes('—'));
  });

  test('keeps unit rows that existed during the range even without train/loss events', () => {
    const chart = makeChart('army', 'army', [0, 10, 20, 30]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    const unit = {
      key: 'unit-existing',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [],
      _destroyedTimes: [],
      values: [0, 4, 4, 4],
      unitLabel: 'Existing Unit',
      label: 'Existing Unit',
    };
    const summaryLabelEl = doc.createElement('td');
    chart._legendNodes = new Map([
      ['unit-existing', node],
      ['__summary__P1', {
        panelEl: { style: { display: '' } },
        summaryLabelEl,
        units: [unit],
      }],
    ]);
    chart.data.series = [unit];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 1, endIdx: 3 };

    applyRangeLegend(chart, timeline);

    assert.equal(rowEl.style.display, '');
    assert.equal(totalEl.textContent, '4');
    assert.equal(deltaTrainedEl.textContent, '0');
    assert.equal(deltaLostEl.textContent, '0');
    assert.ok(summaryLabelEl.innerHTML.includes('Existing Unit'));
  });

  test('keeps units produced and lost entirely inside the range', () => {
    const chart = makeChart('army', 'army', [0, 10, 20, 30]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    const unit = {
      key: 'unit-produced-lost',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [15],
      _destroyedTimes: [25],
      values: [0, 0, 1, 0],
      unitLabel: 'Burst Unit',
      label: 'Burst Unit',
    };
    chart._legendNodes = new Map([
      ['unit-produced-lost', node],
      ['__summary__P1', {
        panelEl: { style: { display: '' } },
        summaryLabelEl: doc.createElement('td'),
        units: [unit],
      }],
    ]);
    chart.data.series = [unit];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 1, endIdx: 3 };

    applyRangeLegend(chart, timeline);

    assert.equal(rowEl.style.display, '');
    assert.equal(totalEl.textContent, '0');
    assert.equal(deltaTrainedEl.textContent, '1');
    assert.equal(deltaLostEl.textContent, '1');
  });

  test('excludes left-boundary events from deltas and prevents impossible negative range totals', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    const unit = {
      key: 'iron-pagoda',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [10, 15],
      _destroyedTimes: [10, 12, 14, 16, 18, 20, 20, 20],
      values: [7, 6, 0],
      unitLabel: 'Iron Pagoda',
      label: 'Iron Pagoda',
    };
    chart._legendNodes = new Map([
      ['iron-pagoda', node],
      ['__summary__P1', {
        panelEl: { style: { display: '' } },
        summaryLabelEl: doc.createElement('td'),
        units: [unit],
      }],
    ]);
    chart.data.series = [unit];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 1, endIdx: 2 };

    applyRangeLegend(chart, timeline);

    assert.equal(totalEl.textContent, '6');
    assert.equal(deltaTrainedEl.textContent, '1');
    assert.equal(deltaLostEl.textContent, '7');
    assert.ok(Number(totalEl.textContent) + Number(deltaTrainedEl.textContent) - Number(deltaLostEl.textContent) >= 0);
  });

  test('skips series item with no key', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    chart._legendNodes = new Map([['unit1', {}]]);
    chart.data.series = [{ _hidden: false }]; // no key
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };
    applyRangeLegend(chart, timeline); // no throw
  });

  test('skips series item not in legendNodes', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    chart._legendNodes = new Map([['other', {}]]);
    chart.data.series = [{ key: 'unit1' }];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };
    applyRangeLegend(chart, timeline); // no throw
  });

  test('skips player not expanded in summary loop', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    chart._legendNodes = new Map([
      ['unit1', node],
      ['__summary__P1', {
        panelEl: { style: { display: 'none' } }, // collapsed
        summaryLabelEl: doc.createElement('td'),
        units: [],
      }],
    ]);
    chart.data.series = [{
      key: 'unit1',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [5],
      _destroyedTimes: [],
      values: [1, 2, 3],
    }];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };

    applyRangeLegend(chart, timeline);
  });

  test('handles missing values array gracefully', () => {
    const chart = makeChart('army', 'army', [0, 10, 20]);
    const rowEl = doc.createElement('tr');
    const totalEl = doc.createElement('td');
    const deltaTrainedEl = doc.createElement('td');
    const deltaLostEl = doc.createElement('td');
    const node = { rowEl, totalEl, deltaTrainedEl, deltaLostEl };
    chart._legendNodes = new Map([
      ['unit1', node],
      ['__summary__P1', {
        panelEl: { style: { display: '' } },
        summaryLabelEl: doc.createElement('td'),
        units: [],
      }],
    ]);
    chart.data.series = [{
      key: 'unit1',
      playerName: 'P1',
      _hidden: false,
      _finishedTimes: [5],
      _destroyedTimes: [],
    }];
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };

    applyRangeLegend(chart, timeline);
    assert.equal(rowEl.style.display, '');
    assert.equal(totalEl.textContent, '0'); // Math.abs(undefined || 0) = 0
  });
});
