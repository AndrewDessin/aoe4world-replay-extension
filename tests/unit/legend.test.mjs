import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window, HTMLElement } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
globalThis.HTMLElement = HTMLElement;
globalThis.Image = class Image { constructor() { this.onload = null; this.onerror = null; } set src(_) { if (this.onerror) setTimeout(() => this.onerror(), 0); } };
globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
globalThis.getComputedStyle = () => ({
  position: 'static',
  getPropertyValue: () => '',
});
globalThis.performance = globalThis.performance || { now: () => Date.now() };

import {
  renderArmyUnitLegend,
  renderArmyUnitLegendNow,
  armyLegendUnitRow,
  seriesColorChip,
  removeArmyUnitLegend,
  refreshArmyLegendNames,
} from '../../src/content/legend.ts';
import {
  updateLegendLive,
  resetLegendSummary,
  setDeltaCells,
} from '../../src/content/legend-live.ts';

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


function makeDeltaNode(doc) {
  const rowEl = doc.createElement('div');
  const totalEl = doc.createElement('span');
  const deltaTrainedEl = doc.createElement('span');
  const deltaLostEl = doc.createElement('span');
  rowEl.append(totalEl, deltaTrainedEl, deltaLostEl);
  return { rowEl, totalEl, deltaTrainedEl, deltaLostEl, summaryTotal: 100 };
}

function makeLegendNodes(doc, units, playerName) {
  const nodes = new Map();
  for (const u of units) {
    nodes.set(u.key, {
      ...makeDeltaNode(doc),
      summaryTotal: u.createdTotal || 0,
    });
  }
  const summaryEl = doc.createElement('span');
  summaryEl.textContent = units.map(u => u.unitLabel || u.label || '').join(', ');
  const panelEl = doc.createElement('div');
  panelEl.style.display = '';
  const chevronEl = doc.createElement('span');
  nodes.set('__summary__' + playerName, {
    summaryLabelEl: summaryEl,
    chevronEl,
    panelEl,
    units,
    rowEl: doc.createElement('div'),
  });
  return nodes;
}

function makeUnit(key, label, values, createdTotal) {
  return {
    key,
    label,
    unitLabel: label,
    playerName: 'Alice',
    color: '#ff0000',
    values: values || [10, 20, 30],
    createdTotal: createdTotal ?? 30,
    dataset: values || [10, 20, 30],
  };
}

function makeChart(units, type) {
  return {
    type: type || 'army',
    data: {
      labels: ['0:00', '0:30', '1:00'],
      series: units,
    },
    _legendNodes: null,
  };
}

function makeTimeline(doc) {
  const root = doc.createElement('div');
  const canvas = doc.createElement('canvas');
  const ctx = makeCtx();
  canvas.getContext = () => ctx;
  canvas._ctx = ctx;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 });
  canvas.width = 1000;
  canvas.height = 500;
  canvas.clientWidth = 1000;
  canvas.clientHeight = 500;
  const chartBox = doc.createElement('div');
  chartBox.className = 'chart-box';
  root.appendChild(chartBox);
  root.appendChild(canvas);
  return { root, canvas, chartBox };
}

function makePlayerRow(doc, playerName) {
  const row = doc.createElement('div');
  row.className = 'flex items-center cursor-pointer';
  const nameEl = doc.createElement('span');
  nameEl.className = 'font-bold';
  nameEl.textContent = playerName;
  row.appendChild(nameEl);
  const container = doc.createElement('div');
  container.appendChild(row);
  return { row, nameEl, container };
}

describe('setDeltaCells', () => {
  let doc, node;
  beforeEach(() => {
    doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    node = makeDeltaNode(doc);
  });

  test('returns early for null/undefined node', () => {
    setDeltaCells(null, 5, 3);
    setDeltaCells(undefined, 5, 3);
  });

  test('returns early when deltaTrainedEl missing', () => {
    setDeltaCells({ deltaLostEl: doc.createElement('span') }, 5, 3);
  });

  test('returns early when deltaLostEl missing', () => {
    setDeltaCells({ deltaTrainedEl: doc.createElement('span') }, 5, 3);
  });

  test('clears cells when both trained and lost are null', () => {
    node.deltaTrainedEl.textContent = '5';
    node.deltaLostEl.textContent = '3';
    node.deltaTrainedEl.classList.add('is-zero');
    node.deltaLostEl.classList.add('is-zero');

    setDeltaCells(node, null, null);

    assert.equal(node.deltaTrainedEl.textContent, '');
    assert.equal(node.deltaLostEl.textContent, '');
    assert.ok(!node.deltaTrainedEl.classList.contains('is-zero'));
    assert.ok(!node.deltaLostEl.classList.contains('is-zero'));
  });

  test('clears cells when both are undefined', () => {
    node.deltaTrainedEl.textContent = '5';
    node.deltaLostEl.textContent = '3';
    setDeltaCells(node, undefined, undefined);
    assert.equal(node.deltaTrainedEl.textContent, '');
    assert.equal(node.deltaLostEl.textContent, '');
  });

  test('skips write when already empty', () => {
    node.deltaTrainedEl.textContent = '';
    node.deltaLostEl.textContent = '';
    setDeltaCells(node, null, null);
    assert.equal(node.deltaTrainedEl.textContent, '');
  });

  test('sets trained and lost values', () => {
    setDeltaCells(node, 12, 5);
    assert.equal(node.deltaTrainedEl.textContent, '12');
    assert.equal(node.deltaLostEl.textContent, '5');
    assert.ok(!node.deltaTrainedEl.classList.contains('is-zero'));
    assert.ok(!node.deltaLostEl.classList.contains('is-zero'));
  });

  test('marks zero values with is-zero class', () => {
    setDeltaCells(node, 0, 0);
    assert.equal(node.deltaTrainedEl.textContent, '0');
    assert.equal(node.deltaLostEl.textContent, '0');
    assert.ok(node.deltaTrainedEl.classList.contains('is-zero'));
    assert.ok(node.deltaLostEl.classList.contains('is-zero'));
  });

  test('trained > 0, lost = 0', () => {
    setDeltaCells(node, 7, 0);
    assert.equal(node.deltaTrainedEl.textContent, '7');
    assert.equal(node.deltaLostEl.textContent, '0');
    assert.ok(!node.deltaTrainedEl.classList.contains('is-zero'));
    assert.ok(node.deltaLostEl.classList.contains('is-zero'));
  });

  test('trained = 0, lost > 0', () => {
    setDeltaCells(node, 0, 4);
    assert.equal(node.deltaTrainedEl.textContent, '0');
    assert.equal(node.deltaLostEl.textContent, '4');
    assert.ok(node.deltaTrainedEl.classList.contains('is-zero'));
    assert.ok(!node.deltaLostEl.classList.contains('is-zero'));
  });

  test('rounds float values', () => {
    setDeltaCells(node, 5.7, 2.3);
    assert.equal(node.deltaTrainedEl.textContent, '6');
    assert.equal(node.deltaLostEl.textContent, '2');
  });

  test('handles null trained with numeric lost', () => {
    setDeltaCells(node, null, 5);
  });

  test('no-op when text already matches', () => {
    node.deltaTrainedEl.textContent = '10';
    node.deltaLostEl.textContent = '5';
    setDeltaCells(node, 10, 5);
    assert.equal(node.deltaTrainedEl.textContent, '10');
    assert.equal(node.deltaLostEl.textContent, '5');
  });
});

describe('seriesColorChip', () => {
  test('creates span with correct class and color', () => {
    const chip = seriesColorChip('#ff0000');
    assert.equal(chip.tagName, 'SPAN');
    assert.equal(chip.className, 'aoe4-series-color-chip');
    assert.equal(chip.style.backgroundColor, '#ff0000');
  });

  test('uses fallback color when none provided', () => {
    const chip = seriesColorChip(null);
    assert.equal(chip.style.backgroundColor, '#94a3b8');
  });

  test('uses fallback color for empty string', () => {
    const chip = seriesColorChip('');
    assert.equal(chip.style.backgroundColor, '#94a3b8');
  });

  test('uses fallback color for undefined', () => {
    const chip = seriesColorChip(undefined);
    assert.equal(chip.style.backgroundColor, '#94a3b8');
  });
});

describe('removeArmyUnitLegend', () => {
  test('handles null/undefined timeline gracefully', () => {
    removeArmyUnitLegend(null);
    removeArmyUnitLegend(undefined);
    removeArmyUnitLegend({});
  });

  test('removes injected legend elements', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const root = doc.createElement('div');
    const summaryEl = doc.createElement('span');
    summaryEl.className = 'aoe4-inline-legend-summary';
    const chevronEl = doc.createElement('span');
    chevronEl.className = 'aoe4-inline-legend-chevron';
    const breakdownEl = doc.createElement('div');
    breakdownEl.className = 'aoe4-legend-breakdown';
    const legendEl = doc.createElement('div');
    legendEl.className = 'aoe4-army-unit-legend';
    root.append(summaryEl, chevronEl, breakdownEl, legendEl);
    assert.equal(root.children.length, 4);

    removeArmyUnitLegend({ root });
    assert.equal(root.children.length, 0);
  });

  test('cleans up data-aoe4-legend-injected rows', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const root = doc.createElement('div');
    const basisDiv = doc.createElement('div');
    basisDiv.className = 'basis-1/2';
    const row = doc.createElement('div');
    row.dataset.aoe4LegendInjected = '1';
    const nameEl = doc.createElement('span');
    nameEl.className = 'font-bold';
    nameEl.style.maxWidth = '8rem';
    nameEl.style.overflow = 'hidden';
    nameEl.style.textOverflow = 'ellipsis';
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.flexShrink = '0';
    row.appendChild(nameEl);
    basisDiv.appendChild(row);
    root.appendChild(basisDiv);

    removeArmyUnitLegend({ root });

    assert.equal(row.dataset.aoe4LegendInjected, undefined);
    assert.equal(nameEl.style.maxWidth, '');
    assert.equal(nameEl.style.overflow, '');
    assert.equal(nameEl.style.textOverflow, '');
    assert.equal(nameEl.style.whiteSpace, '');
    assert.equal(nameEl.style.flexShrink, '');
    assert.equal(basisDiv.style.maxHeight, '');
    assert.equal(basisDiv.style.overflowY, '');
    assert.equal(basisDiv.style.overflow, '');
    assert.equal(basisDiv.style.minWidth, '');
  });

  test('cleans up row without basis container', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const root = doc.createElement('div');
    const row = doc.createElement('div');
    row.dataset.aoe4LegendInjected = '1';
    root.appendChild(row);

    removeArmyUnitLegend({ root });
    assert.equal(row.dataset.aoe4LegendInjected, undefined);
  });

  test('cleans up row without font-bold name element', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const root = doc.createElement('div');
    const row = doc.createElement('div');
    row.dataset.aoe4LegendInjected = '1';
    root.appendChild(row);

    removeArmyUnitLegend({ root });
  });
});

describe('resetLegendSummary', () => {
  test('returns early when _legendNodes is null', () => {
    resetLegendSummary({ _legendNodes: null });
    resetLegendSummary({});
  });

  test('resets unit rows to summary totals', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');

    const node = chart._legendNodes.get('u1');
    node.totalEl.textContent = '20';
    node.rowEl.style.display = 'none';
    node.rowEl.classList.add('is-closest');
    node.deltaTrainedEl.textContent = '5';
    node.deltaLostEl.textContent = '3';

    resetLegendSummary(chart);

    assert.equal(node.rowEl.style.display, '');
    assert.equal(node.totalEl.textContent, '30');
    assert.equal(node.deltaTrainedEl.textContent, '');
    assert.equal(node.deltaLostEl.textContent, '');
    assert.ok(!node.rowEl.classList.contains('is-closest'));
  });

  test('restores summary label text', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [
      makeUnit('u1', 'Spear', [10, 20, 30], 30),
      makeUnit('u2', 'Archer', [5, 10, 15], 15),
    ];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');

    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    summaryMeta.summaryLabelEl.textContent = 'hover text';

    resetLegendSummary(chart);

    assert.equal(summaryMeta.summaryLabelEl.textContent, 'Spear, Archer');
  });

  test('no-op when total already matches', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const node = chart._legendNodes.get('u1');
    node.totalEl.textContent = '30';
    resetLegendSummary(chart);
    assert.equal(node.totalEl.textContent, '30');
  });

  test('uses label fallback when unitLabel missing', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const unit = { key: 'u1', label: 'Fallback', unitLabel: '', playerName: 'Alice', values: [10], createdTotal: 10 };
    const chart = makeChart([unit]);
    chart._legendNodes = makeLegendNodes(doc, [unit], 'Alice');

    resetLegendSummary(chart);
    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    assert.equal(summaryMeta.summaryLabelEl.textContent, 'Fallback');
  });
});

describe('updateLegendLive', () => {
  test('returns early when _legendNodes is null', () => {
    updateLegendLive({ _legendNodes: null }, 0, null);
    updateLegendLive({}, 0, null);
  });

  test('returns early when _legendNodes is empty map', () => {
    updateLegendLive({ _legendNodes: new Map() }, 0, null);
  });

  test('updates unit values at given index', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    // Expand the panel so the player is in expandedPlayers
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, 'u1');

    const node = chart._legendNodes.get('u1');
    assert.equal(node.totalEl.textContent, '20');
    assert.ok(node.rowEl.classList.contains('is-closest'));
  });

  test('hides zero-value rows', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 0, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    // value=0, prev=10 → transition, so should still show
    assert.equal(node.rowEl.style.display, '');
  });

  test('hides true-zero rows (zero with zero neighbors)', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [0, 0, 0], 0)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    assert.equal(node.rowEl.style.display, 'none');
  });

  test('sets delta trained when value increases', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 15, 20], 20)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    assert.equal(node.deltaTrainedEl.textContent, '5');
    assert.equal(node.deltaLostEl.textContent, '0');
  });

  test('sets delta lost when value decreases', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [20, 15, 10], 20)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    assert.equal(node.deltaTrainedEl.textContent, '0');
    assert.equal(node.deltaLostEl.textContent, '5');
  });

  test('clears delta when no change', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 10, 10], 10)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    assert.equal(node.deltaTrainedEl.textContent, '');
    assert.equal(node.deltaLostEl.textContent, '');
  });

  test('does not mark non-closest as is-closest', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, 'other-key');

    const node = chart._legendNodes.get('u1');
    assert.ok(!node.rowEl.classList.contains('is-closest'));
  });

  test('updates summary label with live values', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [
      makeUnit('u1', 'Spear', [10, 20, 30], 30),
      makeUnit('u2', 'Archer', [5, 0, 15], 15),
    ];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 0, null);

    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    assert.equal(summaryMeta.summaryLabelEl.textContent, 'Spear: 10, Archer: 5');
  });

  test('shows dash when all units are zero', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [0, 0, 0], 0)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 0, null);

    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    assert.equal(summaryMeta.summaryLabelEl.textContent, '—');
  });

  test('skips unit without key', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const unit = { key: '', label: 'NoKey', playerName: 'Alice', values: [10], createdTotal: 10 };
    const chart = makeChart([unit]);
    chart._legendNodes = makeLegendNodes(doc, [unit], 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 0, null);
  });

  test('skips collapsed player panels', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = 'none';

    const node = chart._legendNodes.get('u1');
    node.totalEl.textContent = 'unchanged';

    updateLegendLive(chart, 1, null);

    assert.equal(node.totalEl.textContent, 'unchanged');
  });

  test('handles index at boundaries', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 0, null);
    const node = chart._legendNodes.get('u1');
    assert.equal(node.totalEl.textContent, '10');

    updateLegendLive(chart, 2, null);
    assert.equal(node.totalEl.textContent, '30');
  });

  test('handles negative values (uses Math.abs)', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [-10, -20, -30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';

    updateLegendLive(chart, 1, null);

    const node = chart._legendNodes.get('u1');
    assert.equal(node.totalEl.textContent, '20');
  });

  test('skips unit when node not in legendNodes', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10, 20, 30], 30)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.get('__summary__Alice').panelEl.style.display = '';
    chart._legendNodes.delete('u1'); // remove the node

    updateLegendLive(chart, 1, null);
  });
});

describe('refreshArmyLegendNames', () => {

  test('returns early when _legendNodes is null', () => {
    refreshArmyLegendNames({}, { _legendNodes: null });
  });

  test('returns early when _legendNodes is empty', () => {
    refreshArmyLegendNames({}, { _legendNodes: new Map() });
  });

  test('returns early when hover is active via chartBox', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);
    timeline.chartBox.__aoe4HoverActive = true;

    const node = chart._legendNodes.get('u1');
    const nameEl = doc.createElement('span');
    nameEl.className = 'aoe4-army-unit-name';
    nameEl.textContent = 'Spear';
    node.rowEl.appendChild(nameEl);

    refreshArmyLegendNames(timeline, chart);
    assert.equal(nameEl.textContent, 'Spear');
  });

  test('returns early when hover is active via canvas', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);
    timeline.canvas.__aoe4HoverActive = true;

    const node = chart._legendNodes.get('u1');
    const nameEl = doc.createElement('span');
    nameEl.className = 'aoe4-army-unit-name';
    nameEl.textContent = 'Spear';
    node.rowEl.appendChild(nameEl);

    refreshArmyLegendNames(timeline, chart);
    assert.equal(nameEl.textContent, 'Spear');
  });

  test('updates unit names from resolveCurrentUnitName', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    units[0].unitLabel = 'Spearman';
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);

    const node = chart._legendNodes.get('u1');
    const nameEl = doc.createElement('span');
    nameEl.className = 'aoe4-army-unit-name';
    nameEl.textContent = 'Spear';
    node.rowEl.appendChild(nameEl);

    refreshArmyLegendNames(timeline, chart);

    assert.equal(nameEl.textContent, 'Spearman');
    assert.equal(chart.data.series[0].unitLabel, 'Spearman');
  });

  test('updates summary label text when not in range mode', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    units[0].unitLabel = 'Spearman';
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);

    refreshArmyLegendNames(timeline, chart);

    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    assert.equal(summaryMeta.summaryLabelEl.textContent, 'Spearman');
  });

  test('skips summary label update when range is active', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    units[0].unitLabel = 'Spearman';
    const chart = makeChart(units);
    chart.value = 'army';
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);

    const summaryMeta = chart._legendNodes.get('__summary__Alice');
    summaryMeta.summaryLabelEl.textContent = 'range text';

    timeline.chartBox.__aoe4ActiveRange = { chartValue: 'army', startIdx: 0, endIdx: 2 };

    refreshArmyLegendNames(timeline, chart);

    assert.equal(summaryMeta.summaryLabelEl.textContent, 'range text');
  });

  test('skips unit without key', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const unit = { key: '', label: 'NoKey', playerName: 'Alice', values: [10], createdTotal: 10 };
    const chart = makeChart([unit]);
    chart._legendNodes = makeLegendNodes(doc, [unit], 'Alice');
    const timeline = makeTimeline(doc);

    refreshArmyLegendNames(timeline, chart);
  });

  test('skips unit when node not found in legendNodes', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    chart._legendNodes.delete('u1');
    const timeline = makeTimeline(doc);

    refreshArmyLegendNames(timeline, chart);
  });

  test('does not update name when resolveCurrentUnitName returns empty', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    units[0].unitLabel = '';
    units[0].label = '';
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);

    const node = chart._legendNodes.get('u1');
    const nameEl = doc.createElement('span');
    nameEl.className = 'aoe4-army-unit-name';
    nameEl.textContent = 'Spear';
    node.rowEl.appendChild(nameEl);

    refreshArmyLegendNames(timeline, chart);
    assert.equal(nameEl.textContent, 'Spear');
  });

  test('does not update name when text already matches', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    const chart = makeChart(units);
    chart._legendNodes = makeLegendNodes(doc, units, 'Alice');
    const timeline = makeTimeline(doc);

    const node = chart._legendNodes.get('u1');
    const nameEl = doc.createElement('span');
    nameEl.className = 'aoe4-army-unit-name';
    nameEl.textContent = 'Spear';
    node.rowEl.appendChild(nameEl);

    refreshArmyLegendNames(timeline, chart);
    assert.equal(nameEl.textContent, 'Spear');
  });
});

describe('armyLegendUnitRow', () => {

  test('creates row with correct structure', () => {
    const unit = makeUnit('u1', 'Spear', [10, 20, 30], 30);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);

    assert.equal(row.tagName, 'DIV');
    assert.equal(row.className, 'aoe4-army-unit-row');
    assert.equal(row.dataset.seriesKey, 'u1');
    const iconEl = row.querySelector('.aoe4-army-unit-icon');
    assert.ok(iconEl, 'expected an icon element in the row');
  });

  test('sets unit name and total text', () => {
    const unit = makeUnit('u1', 'Spearman', [10, 20, 30], 42);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);

    const nameEl = row.querySelector('.aoe4-army-unit-name');
    assert.equal(nameEl.textContent, 'Spearman');
    const totalEl = row.querySelector('.aoe4-army-unit-total');
    assert.equal(totalEl.textContent, '42');
  });

  test('registers node in legendNodes map', () => {
    const unit = makeUnit('u1', 'Spear', [10, 20, 30], 30);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);

    assert.ok(legendNodes.has('u1'));
    const node = legendNodes.get('u1');
    assert.ok(node.totalEl);
    assert.ok(node.deltaTrainedEl);
    assert.ok(node.deltaLostEl);
    assert.ok(node.rowEl);
    assert.equal(node.summaryTotal, 30);
  });

  test('does not register when legendNodes is null', () => {
    const unit = makeUnit('u1', 'Spear', [10, 20, 30], 30);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', null);
    assert.ok(row); // no throw
  });

  test('does not register when unit has no key', () => {
    const unit = makeUnit('', 'NoKey', [10], 10);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);
    assert.equal(legendNodes.size, 0);
  });

  test('uses label fallback when unitLabel is empty', () => {
    const unit = { key: 'u1', label: 'Fallback', unitLabel: '', playerName: 'Alice', values: [10], createdTotal: 10 };
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);
    const nameEl = row.querySelector('.aoe4-army-unit-name');
    assert.equal(nameEl.textContent, 'Fallback');
  });

  test('handles missing createdTotal', () => {
    const unit = { key: 'u1', label: 'Spear', playerName: 'Alice', values: [10] };
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);
    const totalEl = row.querySelector('.aoe4-army-unit-total');
    assert.equal(totalEl.textContent, '0');
  });

  test('creates delta cells', () => {
    const unit = makeUnit('u1', 'Spear', [10], 10);
    const chart = makeChart([unit]);
    const timeline = makeTimeline(document);
    const legendNodes = new Map();

    const row = armyLegendUnitRow(timeline, chart, unit, 'Alice', legendNodes);

    assert.ok(row.querySelector('.aoe4-army-unit-delta-trained'));
    assert.ok(row.querySelector('.aoe4-army-unit-delta-lost'));
  });
});

describe('renderArmyUnitLegend', () => {

  test('debounces via __aoe4LegendPending flag', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const units = [makeUnit('u1', 'Spear', [10], 10)];
    const chart = makeChart(units);

    renderArmyUnitLegend(timeline, chart);

    assert.equal(timeline.__aoe4LegendPending, false);
  });

  test('skips when already pending', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    timeline.__aoe4LegendPending = true;
    const chart = makeChart([]);

    renderArmyUnitLegend(timeline, chart);
  });
});

describe('renderArmyUnitLegendNow', () => {

  test('clears highlightKey and redraws', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const chart = makeChart([]);
    chart.highlightKey = 'old-key';

    renderArmyUnitLegendNow(timeline, chart);

    assert.equal(chart.highlightKey, undefined);
    assert.ok(timeline.canvas._ctx._calls.length > 0, 'expected canvas drawing calls');
  });

  test('creates _legendNodes Map', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const chart = makeChart([]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.ok(chart._legendNodes instanceof Map);
  });

  test('skips series items without playerName', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const unit = { key: 'u1', label: 'Spear', values: [10], createdTotal: 10 };
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.equal(chart._legendNodes.size, 0);
  });

  test('builds legend for matched player row (1v1 auto-expand)', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);

    const { row, container } = makePlayerRow(doc, 'Alice');
    timeline.root.appendChild(container);

    const unit = makeUnit('u1', 'Spear', [10, 20, 30], 30);
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.ok(chart._legendNodes.size > 0);
    assert.ok(chart._legendNodes.has('u1'));
    assert.ok(chart._legendNodes.has('__summary__Alice'));

    const summary = chart._legendNodes.get('__summary__Alice');
    assert.equal(summary.panelEl.style.display, '');
    assert.equal(summary.summaryLabelEl.style.display, 'none');
  });

  test('matches player by case-insensitive name', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { container } = makePlayerRow(doc, 'ALICE');
    timeline.root.appendChild(container);

    const unit = makeUnit('u1', 'Spear', [10], 10);
    unit.playerName = 'alice';
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.ok(chart._legendNodes.has('u1'));
  });

  test('matches player by prefix fallback', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { container } = makePlayerRow(doc, 'Alice [TAG]');
    timeline.root.appendChild(container);

    const unit = makeUnit('u1', 'Spear', [10], 10);
    unit.playerName = 'Alice';
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.ok(chart._legendNodes.has('u1'));
  });

  test('sorts units by createdTotal descending', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { container } = makePlayerRow(doc, 'Alice');
    timeline.root.appendChild(container);

    const u1 = makeUnit('u1', 'Spear', [10], 10);
    const u2 = makeUnit('u2', 'Archer', [30], 30);
    const chart = makeChart([u1, u2]);

    renderArmyUnitLegendNow(timeline, chart);

    const summary = chart._legendNodes.get('__summary__Alice');
    assert.ok(summary.summaryLabelEl.title.startsWith('Archer'));
  });

  test('does not auto-expand for team games (>2 players)', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { container: c1 } = makePlayerRow(doc, 'Alice');
    const { container: c2 } = makePlayerRow(doc, 'Bob');
    const { container: c3 } = makePlayerRow(doc, 'Charlie');
    timeline.root.append(c1, c2, c3);

    const u1 = makeUnit('u1', 'Spear', [10], 10);
    u1.playerName = 'Alice';
    const u2 = makeUnit('u2', 'Archer', [10], 10);
    u2.playerName = 'Bob';
    const u3 = makeUnit('u3', 'Knight', [10], 10);
    u3.playerName = 'Charlie';
    const chart = makeChart([u1, u2, u3]);

    renderArmyUnitLegendNow(timeline, chart);

    const summary = chart._legendNodes.get('__summary__Alice');
    assert.equal(summary.panelEl.style.display, 'none');
  });

  test('restores open state from dataset', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { row, container: c1 } = makePlayerRow(doc, 'Alice');
    const { container: c2 } = makePlayerRow(doc, 'Bob');
    const { container: c3 } = makePlayerRow(doc, 'Charlie');
    row.dataset.aoe4LegendOpen = '1';
    timeline.root.append(c1, c2, c3);

    const u1 = makeUnit('u1', 'Spear', [10], 10);
    u1.playerName = 'Alice';
    const u2 = makeUnit('u2', 'Archer', [10], 10);
    u2.playerName = 'Bob';
    const u3 = makeUnit('u3', 'Knight', [10], 10);
    u3.playerName = 'Charlie';
    const chart = makeChart([u1, u2, u3]);

    renderArmyUnitLegendNow(timeline, chart);

    const summary = chart._legendNodes.get('__summary__Alice');
    assert.equal(summary.panelEl.style.display, '');
  });

  test('sets styling on basis container', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);

    const basisDiv = doc.createElement('div');
    basisDiv.className = 'basis-1/2';
    const { row, container } = makePlayerRow(doc, 'Alice');
    basisDiv.appendChild(container);
    timeline.root.appendChild(basisDiv);

    const unit = makeUnit('u1', 'Spear', [10], 10);
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.equal(basisDiv.style.minWidth, '0');
  });

  test('applies findCivIconPosition for insert placement', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { row, container } = makePlayerRow(doc, 'Alice');
    timeline.root.appendChild(container);

    const marker = doc.createElement('img');
    marker.src = 'assets/civ.png';
    row.appendChild(marker);

    const unit = makeUnit('u1', 'Spear', [10], 10);
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    const children = [...row.children];
    const summaryIdx = children.findIndex(c => c.classList.contains('aoe4-inline-legend-summary'));
    const markerIdx = children.indexOf(marker);
    assert.ok(summaryIdx >= 0, 'expected summary element');
    assert.ok(summaryIdx < markerIdx, 'summary should be before marker');
  });

  test('redraws canvas for army charts after building legend', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const chart = makeChart([], 'army');

    timeline.canvas._ctx._calls.length = 0;
    renderArmyUnitLegendNow(timeline, chart);

    assert.ok(timeline.canvas._ctx._calls.length > 0, 'expected canvas drawing calls');
  });

  test('does not redraw for non-army charts', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const chart = makeChart([], 'workers');

    timeline.canvas._ctx._calls.length = 0;
    renderArmyUnitLegendNow(timeline, chart);

    assert.equal(timeline.canvas._ctx._calls.length, 0, 'expected no canvas drawing calls for non-army');
  });

  test('sets name element max-width styling', () => {
    const doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const timeline = makeTimeline(doc);
    const { row, nameEl, container } = makePlayerRow(doc, 'Alice');
    timeline.root.appendChild(container);

    const unit = makeUnit('u1', 'Spear', [10], 10);
    const chart = makeChart([unit]);

    renderArmyUnitLegendNow(timeline, chart);

    assert.equal(nameEl.style.maxWidth, '8rem');
    assert.equal(nameEl.style.overflow, 'hidden');
    assert.equal(nameEl.style.textOverflow, 'ellipsis');
    assert.equal(nameEl.style.whiteSpace, 'nowrap');
    assert.equal(nameEl.style.flexShrink, '0');
  });
});
