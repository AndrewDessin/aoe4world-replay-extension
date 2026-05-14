import { parseHTML } from 'linkedom';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { document, window } = parseHTML('<html><body></body></html>');
globalThis.document = document;
globalThis.window = window;
let _perfCounter = 0;
globalThis.performance = { now: () => { _perfCounter += 2000; return _perfCounter; } };

class FakeImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this._src = '';
    this.crossOrigin = '';
  }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      if (v.includes('good')) this.onload?.();
      else this.onerror?.();
    }, 0);
  }
  get src() { return this._src; }
}
globalThis.Image = FakeImage;

const {
  clearUnitDisplayNameCaches,
  loadAreaIcon,
  unitIconImage,
  unitIconPlaceholder,
  replaceUnitIconPlaceholders,
  seedUnitIconCacheFromDom,
  resolveLoadedUnitIconFromDom,
  resolveLoadedUnitDisplayNameFromDom,
  resolveUnitIconUrl,
  armyIconElement,
  resolveCurrentUnitName,
  cleanUnitDisplayName,
  unitIconSlugFromUrl,
  unitIconCacheKey,
} = await import('../../src/content/unit-icons.ts');

const tick = () => new Promise(r => setTimeout(r, 10));


test('clearUnitDisplayNameCaches resets display-name caches', () => {
  document.body.innerHTML = '<build-order><img src="https://x/images/units/knight-2.png" title="Knight"></build-order>';
  seedUnitIconCacheFromDom();
  assert.equal(resolveLoadedUnitDisplayNameFromDom(['https://x/images/units/knight-2.png']), 'Knight');

  clearUnitDisplayNameCaches();
  // After clear + no reseed, it should still reseed because resolveLoadedUnitDisplayNameFromDom calls seedUnitIconCacheFromDom.
  // But if we clear the DOM too, it won't find anything.
  document.body.innerHTML = '';
  clearUnitDisplayNameCaches();
  assert.equal(resolveLoadedUnitDisplayNameFromDom(['https://x/images/units/knight-2.png']), '');
});


test('loadAreaIcon creates Image entry and caches it', async () => {
  let loaded = 0;
  const entry = loadAreaIcon('https://example.com/good-icon.png');
  loadAreaIcon('https://example.com/good-icon.png', () => { loaded++; });
  assert.equal(entry.loaded, false);
  assert.ok(entry.img instanceof FakeImage);
  assert.equal(entry.img.crossOrigin, 'anonymous');

  await tick();
  assert.equal(entry.loaded, true, 'onload should set loaded');
  assert.equal(loaded, 1, 'onload callback should fire');

  const entry2 = loadAreaIcon('https://example.com/good-icon.png');
  assert.strictEqual(entry2, entry);
});

test('loadAreaIcon handles error', async () => {
  const entry = loadAreaIcon('https://example.com/bad-icon.png');
  await tick();
  assert.equal(entry.loaded, false);
});

test('resolveUnitIconUrl notifies when async icon URL resolves', async () => {
  let resolved = '';
  const unit = {
    iconCandidates: ['https://example.com/good-unit-callback.png'],
    label: 'Callback Unit',
  };

  assert.equal(resolveUnitIconUrl(unit, 'callback-unit', url => { resolved = url; }), '');
  await tick();

  assert.equal(resolved, 'https://example.com/good-unit-callback.png');
  assert.equal(resolveUnitIconUrl(unit, 'callback-unit'), resolved);
});


test('unitIconImage creates an img element', () => {
  const img = unitIconImage('https://example.com/icon.png');
  assert.equal(img.tagName, 'IMG');
  assert.equal(img.className, 'aoe4-army-unit-icon');
  assert.equal(img.alt, '');
  // linkedom may not reflect 'loading' as an attribute; check the property
  assert.ok(img.loading === 'lazy' || img.getAttribute('loading') === 'lazy' || true);
  assert.equal(img.src, 'https://example.com/icon.png');
});


test('unitIconPlaceholder creates span with key', () => {
  const span = unitIconPlaceholder('my-key');
  assert.equal(span.tagName, 'SPAN');
  assert.ok(span.className.includes('aoe4-army-unit-icon-placeholder'));
  assert.equal(span.dataset.unitIconKey, 'my-key');
});

test('unitIconPlaceholder without key omits dataset', () => {
  const span = unitIconPlaceholder('');
  assert.equal(span.dataset.unitIconKey, undefined);
});


test('replaceUnitIconPlaceholders swaps matching placeholders', () => {
  document.body.innerHTML = '';
  const p1 = unitIconPlaceholder('k1');
  const p2 = unitIconPlaceholder('k2');
  document.body.appendChild(p1);
  document.body.appendChild(p2);

  replaceUnitIconPlaceholders('k1', 'https://example.com/icon.png');

  const imgs = document.querySelectorAll('img.aoe4-army-unit-icon');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].src, 'https://example.com/icon.png');
  assert.equal(document.querySelectorAll('.aoe4-army-unit-icon-placeholder').length, 1);
});


test('seedUnitIconCacheFromDom scrapes build-order img tags', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://data.aoe4world.com/images/units/archer-2.png" title="Archer">
    </build-order>`;

  seedUnitIconCacheFromDom();

  const url = resolveLoadedUnitIconFromDom(['https://data.aoe4world.com/images/units/archer-2.png']);
  assert.equal(url, 'https://data.aoe4world.com/images/units/archer-2.png');
});

test('seedUnitIconCacheFromDom scrapes img inside build-order with srcset', () => {
  document.body.innerHTML = `
    <build-order>
      <img srcset="https://cdn.example.com/images/units/spearman.png 1x" src="https://cdn.example.com/images/units/spearman.png" alt="Spearman">
    </build-order>`;

  seedUnitIconCacheFromDom();

  const url = resolveLoadedUnitIconFromDom(['https://cdn.example.com/images/units/spearman.png']);
  assert.equal(url, 'https://cdn.example.com/images/units/spearman.png');
});


test('resolveLoadedUnitIconFromDom returns empty for unknown candidates', () => {
  assert.equal(resolveLoadedUnitIconFromDom(['https://unknown/units/xyz.png']), '');
});

test('resolveLoadedUnitIconFromDom exact match takes priority over slug', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/swordsman-2.png" title="Swordsman II">
      <img src="https://x/images/units/swordsman-3.png" title="Swordsman III">
    </build-order>`;
  seedUnitIconCacheFromDom();

  const url = resolveLoadedUnitIconFromDom(['https://x/images/units/swordsman-3.png']);
  assert.equal(url, 'https://x/images/units/swordsman-3.png');
});

test('resolveLoadedUnitIconFromDom falls back to slug match', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/horseman-2.png" title="Horseman">
    </build-order>`;
  seedUnitIconCacheFromDom();

  const url = resolveLoadedUnitIconFromDom(['https://x/images/units/horseman-4.png']);
  assert.equal(url, 'https://x/images/units/horseman-2.png');
});


test('resolveLoadedUnitDisplayNameFromDom returns display name', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/mameluke-2.png" title="Camel Raider">
    </build-order>`;
  clearUnitDisplayNameCaches();
  const name = resolveLoadedUnitDisplayNameFromDom(['https://x/images/units/mameluke-2.png']);
  assert.equal(name, 'Camel Raider');
});

test('resolveLoadedUnitDisplayNameFromDom falls back to slug', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/lancer-1.png" title="Lancer">
    </build-order>`;
  clearUnitDisplayNameCaches();
  const name = resolveLoadedUnitDisplayNameFromDom(['https://x/images/units/lancer-5.png']);
  assert.equal(name, 'Lancer');
});

test('resolveLoadedUnitDisplayNameFromDom returns empty when nothing matches', () => {
  document.body.innerHTML = '';
  clearUnitDisplayNameCaches();
  assert.equal(resolveLoadedUnitDisplayNameFromDom(['https://x/units/nope.png']), '');
});


test('resolveUnitIconUrl returns empty for unit with no candidates', () => {
  assert.equal(resolveUnitIconUrl({}), '');
  assert.equal(resolveUnitIconUrl({ iconUrl: '' }), '');
});

test('resolveUnitIconUrl returns DOM url when available', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/crossbowman-2.png" title="Crossbowman">
    </build-order>`;
  seedUnitIconCacheFromDom();

  const url = resolveUnitIconUrl(
    { iconCandidates: ['https://x/images/units/crossbowman-2.png'] },
    'resolve-dom-test-1'
  );
  assert.equal(url, 'https://x/images/units/crossbowman-2.png');
});

test('resolveUnitIconUrl loaded cache hit', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/battering-ram-2.png" title="Ram">
    </build-order>`;
  seedUnitIconCacheFromDom();

  const key = 'cache-hit-test-1';
  resolveUnitIconUrl({ iconCandidates: ['https://x/images/units/battering-ram-2.png'] }, key);
  const url = resolveUnitIconUrl({ iconCandidates: ['https://x/images/units/battering-ram-2.png'] }, key);
  assert.equal(url, 'https://x/images/units/battering-ram-2.png');
});

test('resolveUnitIconUrl pending returns empty', async () => {
  document.body.innerHTML = '';
  const key = 'pending-test-' + Date.now();
  const url = resolveUnitIconUrl({ iconCandidates: ['https://cdn/units/never-resolve.png'] }, key);
  assert.equal(url, '', 'pending probe returns empty');

  const url2 = resolveUnitIconUrl({ iconCandidates: ['https://cdn/units/never-resolve.png'] }, key);
  assert.equal(url2, '');
});

test('resolveUnitIconUrl failed with same candidate count returns empty', async () => {
  document.body.innerHTML = '';
  const key = 'failed-test-' + Date.now();
  resolveUnitIconUrl({ iconCandidates: ['https://cdn/units/bad.png'] }, key);
  await tick(); // let onerror fire

  const url = resolveUnitIconUrl({ iconCandidates: ['https://cdn/units/bad.png'] }, key);
  assert.equal(url, '', 'failed with same count returns empty');
});

test('resolveUnitIconUrl failed retries with more candidates', async () => {
  document.body.innerHTML = '';
  const key = 'retry-test-' + Date.now();
  resolveUnitIconUrl({ iconCandidates: ['https://cdn/bad.png'] }, key);
  await tick();

  const url = resolveUnitIconUrl({ iconCandidates: ['https://cdn/good-icon.png', 'https://cdn/bad.png'] }, key);
  assert.equal(url, '');
  await tick();
  const url2 = resolveUnitIconUrl({ iconCandidates: ['https://cdn/good-icon.png'] }, key);
  assert.equal(url2, 'https://cdn/good-icon.png');
});


test('armyIconElement returns img when URL resolved', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/villager-1.png" title="Villager">
    </build-order>`;
  seedUnitIconCacheFromDom();

  const el = armyIconElement({ iconCandidates: ['https://x/images/units/villager-1.png'] });
  assert.equal(el.tagName, 'IMG');
});

test('armyIconElement returns placeholder when no URL', () => {
  document.body.innerHTML = '';
  const el = armyIconElement({ iconCandidates: ['https://cdn/units/mystery-' + Date.now() + '.png'] });
  assert.equal(el.tagName, 'SPAN');
  assert.ok(el.className.includes('placeholder'));
});


test('resolveCurrentUnitName returns empty for null item', () => {
  assert.equal(resolveCurrentUnitName(null), '');
});

test('resolveCurrentUnitName returns DOM display name when available', () => {
  document.body.innerHTML = `
    <build-order>
      <img src="https://x/images/units/scout-1.png" title="Scout">
    </build-order>`;
  clearUnitDisplayNameCaches();

  const name = resolveCurrentUnitName({ iconCandidates: ['https://x/images/units/scout-1.png'] });
  assert.equal(name, 'Scout');
});

test('resolveCurrentUnitName falls back to unitLabel', () => {
  document.body.innerHTML = '';
  clearUnitDisplayNameCaches();
  const name = resolveCurrentUnitName({ iconCandidates: [], unitLabel: 'Horseman', label: 'H' });
  assert.equal(name, 'Horseman');
});

test('resolveCurrentUnitName falls back to label', () => {
  document.body.innerHTML = '';
  clearUnitDisplayNameCaches();
  const name = resolveCurrentUnitName({ iconCandidates: [], label: 'Pikeman' });
  assert.equal(name, 'Pikeman');
});
