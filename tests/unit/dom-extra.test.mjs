import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { closestWith, findTimelineElements, findCivIconPosition, findAnchor } from '../../src/content/dom.ts';

let savedDocument;

beforeEach(() => { savedDocument = globalThis.document; });
afterEach(() => { globalThis.document = savedDocument; });

function setup(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  globalThis.document = document;
  return document;
}

describe('closestWith', () => {
  test('returns the element itself when it matches the predicate', () => {
    const doc = setup('<div class="target"><span id="start"></span></div>');
    const start = doc.querySelector('.target');
    const result = closestWith(start, el => el.classList.contains('target'));
    assert.equal(result, start);
  });

  test('walks up to a matching ancestor', () => {
    const doc = setup('<div class="ancestor"><p><span id="start"></span></p></div>');
    const start = doc.getElementById('start');
    const result = closestWith(start, el => el.classList.contains('ancestor'));
    assert.equal(result.className, 'ancestor');
  });

  test('returns null when no ancestor matches', () => {
    const doc = setup('<div><span id="start"></span></div>');
    const start = doc.getElementById('start');
    const result = closestWith(start, () => false);
    assert.equal(result, null);
  });

  test('returns null for null start', () => {
    setup('');
    assert.equal(closestWith(null, () => true), null);
  });
});

describe('findAnchor', () => {
  test('returns the date-cell anchor', () => {
    const doc = setup('<div id="row"><a role="cell" href="/g/1">Jan 1</a></div>');
    const row = doc.getElementById('row');
    assert.ok(findAnchor(row));
    assert.equal(findAnchor(row).textContent, 'Jan 1');
  });

  test('returns null when no matching anchor exists', () => {
    const doc = setup('<div id="row"><span>no anchor</span></div>');
    assert.equal(findAnchor(doc.getElementById('row')), null);
  });
});

describe('findCivIconPosition', () => {
  test('returns child with IMG tag', () => {
    const doc = setup('<div id="row"><span>a</span><img src="icon.png"/></div>');
    const row = doc.getElementById('row');
    const result = findCivIconPosition(row);
    assert.equal(result.tagName, 'IMG');
  });

  test('returns child with ml-auto class', () => {
    const doc = setup('<div id="row"><span>a</span><span class="ml-auto">b</span></div>');
    const result = findCivIconPosition(doc.getElementById('row'));
    assert.ok(result.classList.contains('ml-auto'));
  });

  test('returns child containing img with assets src', () => {
    const doc = setup('<div id="row"><span>a</span><div><img src="https://cdn/assets/civ.png"/></div></div>');
    const result = findCivIconPosition(doc.getElementById('row'));
    assert.ok(result.querySelector('img[src*="assets/"]'));
  });

  test('returns null when no children match', () => {
    const doc = setup('<div id="row"><span>a</span><span>b</span></div>');
    assert.equal(findCivIconPosition(doc.getElementById('row')), null);
  });

  test('returns last matching child (scans from end)', () => {
    const doc = setup('<div id="row"><img src="first.png"/><span>mid</span><img src="last.png"/></div>');
    const result = findCivIconPosition(doc.getElementById('row'));
    assert.equal(result.getAttribute('src'), 'last.png');
  });
});

describe('findTimelineElements', () => {
  const timelineHTML = `
    <div id="root">
      <div id="chartBox">
        <h3>Timeline</h3>
        <canvas id="c"></canvas>
      </div>
      <select id="sel">
        <option value="army">Army</option>
        <option value="workers">Workers</option>
      </select>
    </div>`;

  test('returns all five elements from a valid timeline', () => {
    const doc = setup(timelineHTML);
    const result = findTimelineElements();
    assert.ok(result);
    assert.equal(result.root.id, 'root');
    assert.equal(result.select.id, 'sel');
    assert.equal(result.chartBox.id, 'chartBox');
    assert.equal(result.canvas.id, 'c');
    assert.equal(result.heading.tagName, 'H3');
  });

  test('returns null when no matching select exists', () => {
    setup('<div><select><option value="other">X</option></select></div>');
    assert.equal(findTimelineElements(), null);
  });

  test('returns null when canvas is missing from root', () => {
    setup(`
      <div>
        <div><h3>Timeline</h3></div>
        <select><option value="army">A</option><option value="workers">W</option></select>
      </div>`);
    assert.equal(findTimelineElements(), null);
  });

  test('returns null when heading is missing from chartBox', () => {
    setup(`
      <div>
        <div><canvas></canvas></div>
        <select><option value="army">A</option><option value="workers">W</option></select>
      </div>`);
    assert.equal(findTimelineElements(), null);
  });
});
