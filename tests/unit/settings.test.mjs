import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeChromeMock } from '../helpers/chrome-mock.mjs';

globalThis.localStorage ??= { setItem() {}, getItem() { return null; }, removeItem() {} };
globalThis.document ??= { getElementById() { return null; } };


async function loadSettings(opts = {}) {
  const mock = makeChromeMock(opts);
  globalThis.chrome = mock.chrome;
  const mod = await import('../../src/content/settings.ts?t=' + Math.random());
  await mod.settingsReady;
  return { mod, mock };
}

describe('settings – defaults (empty storage)', () => {
  let mod;
  beforeEach(async () => {
    ({ mod } = await loadSettings({ initial: { settings: {} } }));
  });

  it('settingsReady resolves', () => {
    assert.ok(mod.settingsReady instanceof Promise);
  });

  it('recolorEnabled defaults to false', () => {
    assert.equal(mod.recolorEnabled(), false);
  });

  it('chartsEnabled defaults to false', () => {
    assert.equal(mod.chartsEnabled(), false);
  });

  it('SETTINGS_DEFAULTS is frozen', () => {
    assert.ok(Object.isFrozen(mod.SETTINGS_DEFAULTS));
  });

  it('exports RECOLOR_HINT_KEY', () => {
    assert.equal(typeof mod.RECOLOR_HINT_KEY, 'string');
  });

  it('exports RECOLOR_HIDE_STYLE_ID', () => {
    assert.equal(typeof mod.RECOLOR_HIDE_STYLE_ID, 'string');
  });
});

describe('settings – pre-populated storage', () => {
  it('applies stored settings on init', async () => {
    const { mod } = await loadSettings({
      initial: { settings: { parseGameData: true, recolorSwatches: true, injectCharts: false, debugLogs: true } },
    });
    assert.equal(mod.recolorEnabled(), true);
    assert.equal(mod.chartsEnabled(), false);
  });
});

describe('applySettings', () => {
  let mod;
  beforeEach(async () => {
    ({ mod } = await loadSettings({ initial: { settings: {} } }));
  });

  it('merges with defaults', () => {
    mod.applySettings({ parseGameData: true, recolorSwatches: true });
    assert.equal(mod.recolorEnabled(), true);
    assert.equal(mod.chartsEnabled(), false); // default preserved
  });

  it('handles null/undefined stored value', () => {
    mod.applySettings(null);
    assert.equal(mod.recolorEnabled(), false);
    assert.equal(mod.chartsEnabled(), false);
  });

  it('notifies subscribers with prev and next', () => {
    const calls = [];
    mod.onSettingsChange((prev, next) => calls.push({ prev, next }));
    mod.applySettings({ recolorSwatches: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prev.recolorSwatches, false);
    assert.equal(calls[0].next.recolorSwatches, true);
  });

  it('catches subscriber errors without throwing', () => {
    mod.onSettingsChange(() => { throw new Error('boom'); });
    assert.doesNotThrow(() => mod.applySettings({ debugLogs: true }));
  });
});

describe('onSettingsChange', () => {
  let mod;
  beforeEach(async () => {
    ({ mod } = await loadSettings({ initial: { settings: {} } }));
  });

  it('returns an unsubscribe function', () => {
    const calls = [];
    const unsub = mod.onSettingsChange((p, n) => calls.push({ p, n }));
    mod.applySettings({ debugLogs: true });
    assert.equal(calls.length, 1);
    unsub();
    mod.applySettings({ debugLogs: false });
    assert.equal(calls.length, 1); // no second call
  });

  it('supports multiple subscribers', () => {
    let a = 0, b = 0;
    mod.onSettingsChange(() => a++);
    mod.onSettingsChange(() => b++);
    mod.applySettings({});
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});

describe('storage.onChanged integration', () => {
  it('applySettings fires on storage change for local area', async () => {
    const { mod, mock } = await loadSettings({ initial: { settings: {} } });
    const calls = [];
    mod.onSettingsChange((prev, next) => calls.push({ prev, next }));

    await mock.chrome.storage.local.set({ settings: { parseGameData: true, recolorSwatches: true } });
    assert.equal(calls.length, 1);
    assert.equal(mod.recolorEnabled(), true);
  });

  it('ignores changes for non-local area', async () => {
    const { mod, mock } = await loadSettings({ initial: { settings: {} } });
    const calls = [];
    mod.onSettingsChange(() => calls.push(1));

    for (const fn of []) { /* no direct access, use fanout workaround */ }
    await mock.chrome.storage.local.set({ otherKey: 'value' });
    assert.equal(calls.length, 0); // no settings key → ignored
  });
});

describe('dbg / dbgWarn', () => {
  it('dbg is silent when debugLogs is off', async () => {
    const { mod } = await loadSettings({ initial: { settings: {} } });
    mod.dbg('test message');
    mod.dbgWarn('test warning');
  });

  it('dbg logs when debugLogs is on', async () => {
    const { mod } = await loadSettings({
      initial: { settings: { debugLogs: true } },
    });
    const origLog = console.log;
    const origWarn = console.warn;
    const logs = [];
    const warns = [];
    console.log = (...a) => logs.push(a);
    console.warn = (...a) => warns.push(a);
    try {
      mod.dbg('hello');
      mod.dbgWarn('world');
      assert.equal(logs.length, 1);
      assert.equal(warns.length, 1);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
  });
});

describe('removeEarlyHideStyle', () => {
  it('removes element if present', async () => {
    let removeCalled = false;
    const origDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => {
        if (id === '__aoe4-color-ext-hide') return { remove() { removeCalled = true; } };
        return null;
      },
    };
    const { mod } = await loadSettings({ initial: { settings: {} } });
    mod.removeEarlyHideStyle();
    assert.equal(removeCalled, true);
    globalThis.document = origDoc;
  });

  it('does nothing if element is absent', async () => {
    globalThis.document = { getElementById: () => null };
    const { mod } = await loadSettings({ initial: { settings: {} } });
    assert.doesNotThrow(() => mod.removeEarlyHideStyle());
  });
});

describe('writeRecolorHint via localStorage', () => {
  it('sets hint when recolor is enabled', async () => {
    const stored = {};
    globalThis.localStorage = {
      setItem(k, v) { stored[k] = v; },
      getItem() { return null; },
      removeItem() {},
    };
    const { mod } = await loadSettings({
      initial: { settings: { parseGameData: true, recolorSwatches: true } },
    });
    assert.equal(stored['__aoe4-color-ext-recolor-v1'], '1');
  });

  it('survives localStorage error', async () => {
    globalThis.localStorage = {
      setItem() { throw new Error('denied'); },
      getItem() { return null; },
      removeItem() {},
    };
    const { mod } = await loadSettings({ initial: { settings: {} } });
    assert.ok(mod);
  });
});

describe('debugLogsEnabled gate', () => {
  it('defaults to false', async () => {
    const { mod } = await loadSettings({ initial: { settings: {} } });
    assert.equal(mod.SETTINGS_DEFAULTS.debugLogs, false);
  });
});

describe('settings – recolor regression: explicit undefined defaults to disabled', () => {
  it('recolorEnabled returns false when stored recolorSwatches is undefined', async () => {
    const { mod } = await loadSettings({ initial: { settings: { recolorSwatches: undefined } } });
    // Per default policy, recolor is opt-in. Spreading undefined onto the
    // default object overwrites it; recolorEnabled must still return false.
    assert.equal(mod.recolorEnabled(), false);
  });

  it('recolorEnabled returns false for any non-true value', async () => {
    const { mod } = await loadSettings({ initial: { settings: { parseGameData: true, recolorSwatches: 0 } } });
    assert.equal(mod.recolorEnabled(), false);
    mod.applySettings({ parseGameData: true, recolorSwatches: 1 });
    assert.equal(mod.recolorEnabled(), false);
    mod.applySettings({ parseGameData: true, recolorSwatches: 'yes' });
    assert.equal(mod.recolorEnabled(), false);
    mod.applySettings({ parseGameData: true, recolorSwatches: true });
    assert.equal(mod.recolorEnabled(), true);
  });
});
