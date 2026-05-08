import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const FAKE_JSON = {
  units:        { '100': { name: 'Archer' },  '101': { name: 'Spearman' } },
  technologies: { '200': { name: 'Wheelbarrow' } },
  upgrades:     { '300': { name: 'Veteran Archer' } },
};

function mockFetchOk(data = FAKE_JSON) {
  globalThis.fetch = async (_url) => ({
    ok: true,
    json: async () => structuredClone(data),
  });
}

function mockFetchFail(status = 500) {
  globalThis.fetch = async (_url) => ({ ok: false, status });
}


async function freshImport() {
  const mod = await import(
    `../../src/content/pbgid-map.ts?cachebust=${Date.now()}${Math.random()}`
  );
  return mod;
}


describe('pbgid-map: chrome.runtime.getURL present', () => {
  let savedChrome, savedFetch;

  before(() => {
    savedChrome = globalThis.chrome;
    savedFetch  = globalThis.fetch;
    globalThis.chrome = { runtime: { getURL: (p) => 'fake://' + p } };
  });

  after(() => {
    globalThis.chrome = savedChrome;
    globalThis.fetch  = savedFetch;
  });

  it('ensurePbgidMap success: populates maps and resolves', async () => {
    mockFetchOk();
    const mod = await freshImport();

    await mod.ensurePbgidMap();

    assert.ok(mod.isPbgidMapLoaded(), 'map should be loaded');
    assert.deepStrictEqual(mod.pbgidUnitsMap.get(100), { name: 'Archer' });
    assert.deepStrictEqual(mod.pbgidUnitsMap.get(101), { name: 'Spearman' });
    assert.deepStrictEqual(mod.pbgidTechsMap.get(200), { name: 'Wheelbarrow' });
    assert.deepStrictEqual(mod.pbgidUpgradesMap.get(300), { name: 'Veteran Archer' });
  });

  it('ensurePbgidMap calls onLoaded callback once on first load', async () => {
    mockFetchOk();
    const mod = await freshImport();
    let called = 0;
    await mod.ensurePbgidMap(() => { called++; });
    assert.strictEqual(called, 1);
  });

  it('ensurePbgidMap second call when already loaded returns resolved promise without onLoaded', async () => {
    mockFetchOk();
    const mod = await freshImport();
    await mod.ensurePbgidMap();
    let called = false;
    const p = mod.ensurePbgidMap(() => { called = true; });
    await p;
    assert.strictEqual(called, false, 'onLoaded must NOT fire when already loaded');
  });

  it('ensurePbgidMap retry on failure resets _loadPromise', async () => {
    mockFetchFail(503);
    const mod = await freshImport();

    // First attempt — should fail silently (catch branch).
    await mod.ensurePbgidMap();
    // Allow microtask/catch to settle
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(mod.isPbgidMapLoaded(), false, 'should NOT be loaded after failure');

    // Now fix fetch and retry — should succeed.
    mockFetchOk();
    await mod.ensurePbgidMap();
    assert.ok(mod.isPbgidMapLoaded(), 'should be loaded after retry');
    assert.deepStrictEqual(mod.pbgidUnitsMap.get(100), { name: 'Archer' });
  });

  it('PBGID_MAP_URL uses chrome.runtime.getURL', async () => {
    const mod = await freshImport();
    assert.strictEqual(mod.PBGID_MAP_URL, 'fake://data/pbgid-map.json');
  });
});

describe('pbgid-map: no chrome runtime (fallback path)', () => {
  let savedChrome, savedFetch;

  before(() => {
    savedChrome = globalThis.chrome;
    savedFetch  = globalThis.fetch;
    delete globalThis.chrome;
  });

  after(() => {
    globalThis.chrome = savedChrome;
    globalThis.fetch  = savedFetch;
  });

  it('PBGID_MAP_URL is empty string when chrome is absent', async () => {
    const mod = await freshImport();
    assert.strictEqual(mod.PBGID_MAP_URL, '');
  });

  it('ensurePbgidMap rejects gracefully when no runtime URL', async () => {
    const mod = await freshImport();
    await mod.ensurePbgidMap();
    // catch branch runs → promise nulled, not loaded
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(mod.isPbgidMapLoaded(), false);
  });
});

describe('pbgid-map: resolver helpers', () => {
  let mod, savedChrome, savedFetch;

  before(async () => {
    savedChrome = globalThis.chrome;
    savedFetch  = globalThis.fetch;
    globalThis.chrome = { runtime: { getURL: (p) => 'fake://' + p } };
    mockFetchOk();
    mod = await freshImport();
    await mod.ensurePbgidMap();
  });

  after(() => {
    globalThis.chrome = savedChrome;
    globalThis.fetch  = savedFetch;
  });

  it('resolveUnitByPbgid returns entry for known pbgid', () => {
    assert.deepStrictEqual(mod.resolveUnitByPbgid(100), { name: 'Archer' });
  });

  it('resolveUnitByPbgid returns null for unknown pbgid', () => {
    assert.strictEqual(mod.resolveUnitByPbgid(999), null);
  });

  it('resolveUnitByPbgid returns null for falsy input', () => {
    assert.strictEqual(mod.resolveUnitByPbgid(0), null);
    assert.strictEqual(mod.resolveUnitByPbgid(null), null);
    assert.strictEqual(mod.resolveUnitByPbgid(undefined), null);
  });

  it('resolveTechByPbgid returns entry for known pbgid', () => {
    assert.deepStrictEqual(mod.resolveTechByPbgid(200), { name: 'Wheelbarrow' });
  });

  it('resolveTechByPbgid returns null for unknown', () => {
    assert.strictEqual(mod.resolveTechByPbgid(999), null);
  });

  it('resolveTechByPbgid returns null for falsy input', () => {
    assert.strictEqual(mod.resolveTechByPbgid(0), null);
  });

  it('resolveUpgradeByPbgid returns entry for known pbgid', () => {
    assert.deepStrictEqual(mod.resolveUpgradeByPbgid(300), { name: 'Veteran Archer' });
  });

  it('resolveUpgradeByPbgid returns null for unknown', () => {
    assert.strictEqual(mod.resolveUpgradeByPbgid(999), null);
  });

  it('resolveUpgradeByPbgid returns null for falsy input', () => {
    assert.strictEqual(mod.resolveUpgradeByPbgid(0), null);
  });
});
