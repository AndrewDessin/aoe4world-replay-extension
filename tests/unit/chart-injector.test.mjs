import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Replicate chart-injector's applyColorsToChart logic for testing
function applyColorsToChart(chart, colorByName, borderOnly = false) {
  if (!chart?.data?.datasets || !colorByName.size) return false;
  let changed = false;
  for (const ds of chart.data.datasets) {
    const key = String(ds.label || '').trim().toLowerCase();
    if (!key) continue;
    const hex = colorByName.get(key);
    if (!hex) continue;
    if (ds.borderColor !== hex) { ds.borderColor = hex; changed = true; }
    if (!borderOnly) {
      if (ds.backgroundColor !== hex && typeof ds.backgroundColor !== 'function') {
        ds.backgroundColor = hex; changed = true;
      }
      if (ds.pointBorderColor !== undefined && ds.pointBorderColor !== hex) {
        ds.pointBorderColor = hex; changed = true;
      }
      if (ds.pointBackgroundColor !== undefined && ds.pointBackgroundColor !== hex) {
        ds.pointBackgroundColor = hex; changed = true;
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
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#ff0000');
    assert.equal(chart.data.datasets[0].pointBorderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].pointBackgroundColor, '#ff0000');
  });

  test('borderOnly=true only modifies borderColor', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000', backgroundColor: '#000', pointBorderColor: '#000', pointBackgroundColor: '#000' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    const changed = applyColorsToChart(chart, colors, true);
    assert.ok(changed);
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#000');
    assert.equal(chart.data.datasets[0].pointBorderColor, '#000');
    assert.equal(chart.data.datasets[0].pointBackgroundColor, '#000');
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
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[1].borderColor, '#000');
  });

  test('preserves function backgroundColor', () => {
    const bgFn = () => '#dynamic';
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000', backgroundColor: bgFn },
    ]);
    const colors = new Map([['alice', '#ff0000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].backgroundColor, bgFn);
  });

  test('case-insensitive label matching', () => {
    const chart = makeChart([{ label: 'ALICE', borderColor: '#000' }]);
    const colors = new Map([['alice', '#ff0000']]);
    applyColorsToChart(chart, colors);
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
  });
});

describe('patchedUpdate hover simulation', () => {
  test('hover update (borderOnly) preserves non-border colors', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#ff0000', backgroundColor: '#ff000080', pointBorderColor: '#ff0000', pointBackgroundColor: '#ffffff' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);

    // Simulate Chart.js hover: it might change backgroundColor temporarily
    chart.data.datasets[0].backgroundColor = '#ff000040';

    // Our patched update runs borderOnly after Chart.js update
    applyColorsToChart(chart, colors, true);

    // borderColor should be correct
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    // backgroundColor should NOT be overwritten (hover state preserved)
    assert.equal(chart.data.datasets[0].backgroundColor, '#ff000040');
  });

  test('initial apply (full) sets all colors', () => {
    const chart = makeChart([
      { label: 'Alice', borderColor: '#000', backgroundColor: '#000', pointBorderColor: '#000', pointBackgroundColor: '#000' },
    ]);
    const colors = new Map([['alice', '#ff0000']]);

    // Initial apply — full colors
    applyColorsToChart(chart, colors, false);
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#ff0000');
    assert.equal(chart.data.datasets[0].pointBorderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].pointBackgroundColor, '#ff0000');

    // Subsequent hover update — borderOnly
    chart.data.datasets[0].backgroundColor = '#ff000040'; // Chart.js hover
    applyColorsToChart(chart, colors, true);
    assert.equal(chart.data.datasets[0].borderColor, '#ff0000');
    assert.equal(chart.data.datasets[0].backgroundColor, '#ff000040'); // preserved
  });
});
