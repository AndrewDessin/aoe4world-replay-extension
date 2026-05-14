import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Replicate chart-injector's source-color translation logic for testing.
const COLOR_PROPS = ['borderColor', 'backgroundColor', 'pointBorderColor', 'pointBackgroundColor'];

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map(ch => ch + ch).join('');
  }
  return {
    base: `#${hex.slice(0, 6).toUpperCase()}`,
    alpha: hex.length === 8 ? hex.slice(6, 8).toUpperCase() : '',
  };
}

function recoloredHex(replacement, alpha) {
  const parsed = parseHexColor(replacement);
  if (!parsed) return null;
  return `${parsed.base}${alpha}`;
}

function recolorDatasetColor(dataset, prop, replacement, replacementBase) {
  const parsedCurrent = parseHexColor(dataset[prop]);
  if (!parsedCurrent) return false;
  if (parsedCurrent.base === replacementBase) return false;
  const sourceColors = dataset.__aoe4SourceColors ?? (dataset.__aoe4SourceColors = {});
  const appliedColors = dataset.__aoe4AppliedColors ?? (dataset.__aoe4AppliedColors = {});
  const sourceBase = sourceColors[prop];
  const appliedBase = appliedColors[prop];
  if (!sourceBase) {
    sourceColors[prop] = parsedCurrent.base;
  }
  if (sourceBase && parsedCurrent.base !== sourceBase && parsedCurrent.base !== appliedBase) return false;
  const next = recoloredHex(replacement, parsedCurrent.alpha);
  if (!next || dataset[prop] === next) return false;
  dataset[prop] = next;
  appliedColors[prop] = replacementBase;
  return true;
}

function restoreDatasetColors(dataset) {
  const sourceColors = dataset.__aoe4SourceColors;
  if (!sourceColors) return false;
  let changed = false;
  for (const prop of COLOR_PROPS) {
    const source = sourceColors[prop];
    if (!source) continue;
    const current = parseHexColor(dataset[prop]);
    const next = current ? `${source}${current.alpha}` : source;
    if (dataset[prop] !== next) {
      dataset[prop] = next;
      changed = true;
    }
  }
  delete dataset.__aoe4SourceColors;
  delete dataset.__aoe4AppliedColors;
  return changed;
}

function updateChartAfterColorChange(chart, animate) {
  if (typeof chart.stop === 'function') chart.stop();
  if (animate) {
    if (typeof chart.reset === 'function') chart.reset();
    chart.update();
  } else {
    chart.update('none');
  }
}

function applyColorsToChart(chart, colorByName) {
  if (!chart?.data?.datasets || !colorByName.size) return false;
  let changed = false;
  for (const ds of chart.data.datasets) {
    const key = String(ds.label || '').trim().toLowerCase();
    if (!key) continue;
    const hex = colorByName.get(key);
    if (!hex) continue;
    const replacement = parseHexColor(hex);
    if (!replacement) continue;
    for (const prop of COLOR_PROPS) {
      if (recolorDatasetColor(ds, prop, hex, replacement.base)) {
        changed = true;
      }
    }
  }
  return changed;
}

function makeChart(datasets) {
  return { data: { datasets } };
}

describe('applyColorsToChart', () => {
  test('applies all color properties by default', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000', backgroundColor: '#000', pointBorderColor: '#000', pointBackgroundColor: '#000' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    const changed = applyColorsToChart(chart, colors);
    assert.ok(changed);
    assert.equal(chart.data.datasets[0].borderColor, '#FF0000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#FF0000');
    assert.equal(chart.data.datasets[0].pointBorderColor, '#FF0000');
    assert.equal(chart.data.datasets[0].pointBackgroundColor, '#FF0000');
  });

  test('returns false when colors already match', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#ff0000', backgroundColor: '#ff0000' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    assert.equal(applyColorsToChart(chart, colors), false);
  });

  test('returns false for empty color map', () => {
    const chart = makeChart([{ label: 'Alice', borderColor: '#000' }]);
    assert.equal(applyColorsToChart(chart, new Map()), false);
  });

  test('returns false for null/missing chart', () => {
    assert.equal(applyColorsToChart(null, new Map([['a', '#f00']])), false);
    assert.equal(applyColorsToChart({}, new Map([['a', '#f00']])), false);
  });

  test('skips datasets with no matching color', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000' },
      { label: 'Bob', borderColor: '#000' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#FF0000');
    assert.equal(chart.data.datasets[1].borderColor, '#000');
  });

  test('preserves function backgroundColor', () => {
    const bgFn = () => '#dynamic';
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000', backgroundColor: bgFn },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#FF0000');
    assert.equal(chart.data.datasets[0].backgroundColor, bgFn);
  });

  test('case-insensitive label matching', () => {
    const chart = makeChart([{ label: 'ALICE', borderColor: '#000' }]);
    const colors = new Map([['alice', '#ff0000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#FF0000');
  });

  test('does not overwrite non-source active colors after source is known', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#0162FF' },
    ]);
    const colors = new Map([['alice', '#F60000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#F60000');

    chart.data.datasets[0].borderColor = '#99CCFF';
    assert.equal(applyColorsToChart(chart, colors), false);
    assert.equal(chart.data.datasets[0].borderColor, '#99CCFF');
  });

  test('normalizes shorthand replacement colors when preserving alpha', () => {
    const chart = makeChart([{ label: 'Alice', borderColor: '#0162FF4D' }]);
    const colors = new Map([['alice', '#f00']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#FF00004D');
  });

  test('updates a previously applied replay color when mapping changes', () => {
    const chart = makeChart([{ label: 'Alice', borderColor: '#0162FF' }]);

    applyColorsToChart(chart, new Map([['alice', '#F60000']]));
    assert.equal(chart.data.datasets[0].borderColor, '#F60000');

    applyColorsToChart(chart, new Map([['alice', '#41D8FF']]));
    assert.equal(chart.data.datasets[0].borderColor, '#41D8FF');
    assert.equal(chart.data.datasets[0].__aoe4SourceColors.borderColor, '#0162FF');
  });
});

describe('patchedUpdate hover simulation', () => {
  test('hover update preserves native alpha while translating source colors', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#0162FF', backgroundColor: '#0162FF' },
    ]);
    const colors = new Map([['alice', '#F60000']]);

    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#F60000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#F60000');

    // aoe4world's legend hover writes the original source color plus alpha.
    chart.data.datasets[0].borderColor = '#0162FF4D';
    applyColorsToChart(chart, colors);

    assert.equal(chart.data.datasets[0].borderColor, '#F600004D');
    assert.equal(chart.data.datasets[0].backgroundColor, '#F60000');
  });

  test('hover leave returns to replay color instead of source color', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#0162FF', backgroundColor: '#0162FF' },
    ]);
    const colors = new Map([['alice', '#F60000']]);

    applyColorsToChart(chart, colors);
    chart.data.datasets[0].borderColor = '#0162FF4D';
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#F600004D');

    chart.data.datasets[0].borderColor = '#0162FF';
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#F60000');
  });
});

describe('restoreDatasetColors', () => {
  test('restores source colors and preserves active alpha', () => {
    const ds = { label: 'Alice', borderColor: '#0162FF', backgroundColor: '#0162FF' };
    const chart = makeChart([ds]);
    applyColorsToChart(chart, new Map([['alice', '#F60000']]));
    ds.borderColor = '#F600004D';

    assert.equal(restoreDatasetColors(ds), true);
    assert.equal(ds.borderColor, '#0162FF4D');
    assert.equal(ds.backgroundColor, '#0162FF');
    assert.equal(ds.__aoe4SourceColors, undefined);
    assert.equal(ds.__aoe4AppliedColors, undefined);
  });
});

describe('updateChartAfterColorChange', () => {
  test('restarts normal Chart.js animation after applying replay colors', () => {
    const calls = [];
    const chart = {
      stop: () => calls.push(['stop']),
      reset: () => calls.push(['reset']),
      update: (...args) => calls.push(['update', ...args]),
    };

    updateChartAfterColorChange(chart, true);

    assert.deepEqual(calls, [['stop'], ['reset'], ['update']]);
  });

  test('still skips animation when restoring source colors', () => {
    const calls = [];
    const chart = {
      stop: () => calls.push(['stop']),
      reset: () => calls.push(['reset']),
      update: (...args) => calls.push(['update', ...args]),
    };

    updateChartAfterColorChange(chart, false);

    assert.deepEqual(calls, [['stop'], ['update', 'none']]);
  });
});
