import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { makeChromeMock } from '../helpers/chrome-mock.mjs';
import { SUMMARY_REPLAY_OVERRIDE_KEY } from '../../src/shared/storage-keys.ts';

const saved = {
  document: globalThis.document,
  window: globalThis.window,
  chrome: globalThis.chrome,
  IntersectionObserver: globalThis.IntersectionObserver,
};

afterEach(() => {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
  globalThis.chrome = saved.chrome;
  globalThis.IntersectionObserver = saved.IntersectionObserver;
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await delay(25);
  }
  return fn();
}

function setupDom(rowHtml) {
  const { document, window } = parseHTML(`<html><body>${rowHtml}</body></html>`);
  globalThis.document = document;
  globalThis.window = window;
  return { document, window };
}

function installIntersectionObserverMock() {
  const observers = [];
  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.elements = new Set();
      observers.push(this);
    }
    observe(element) { this.elements.add(element); }
    unobserve(element) { this.elements.delete(element); }
    disconnect() { this.elements.clear(); }
  }
  globalThis.IntersectionObserver = MockIntersectionObserver;
  return () => {
    for (const observer of observers) {
      const entries = [...observer.elements].map(target => ({ target, isIntersecting: true }));
      if (entries.length) observer.callback(entries);
    }
  };
}

function installChromeMock(initial = {}) {
  const messages = [];
  const mock = makeChromeMock({
    initial,
    sendMessageImpl: (msg) => {
      messages.push(msg);
      if (msg.type === 'isFavorite') return { isFavorite: false };
      if (msg.type === 'getCurrentPatch') return { patch: '4.0.0/8719', previousPatch: '4.0.0/8338' };
      if (msg.type === 'checkReplays') {
        const available = {};
        const gamePatches = {};
        for (const id of msg.gameIds || []) {
          available[id] = true;
          gamePatches[id] = '4.0.0/8719';
        }
        return { available, gamePatches, currentPatch: '4.0.0/8719', previousPatch: '4.0.0/8338' };
      }
      return {};
    },
  });
  globalThis.chrome = mock.chrome;
  return { ...mock, messages };
}

function visibleSummaryRow(gameId = '1001') {
  return `
    <div data-game-id="${gameId}" role="rowgroup">
      <a role="cell">
        <div aria-label="Game Date" title="2026-05-13 02:30:01 UTC">1 day ago</div>
        <div><span>View Summary</span></div>
      </a>
    </div>
  `;
}

function hiddenSummaryRow(gameId = '1002') {
  return `
    <div data-game-id="${gameId}" role="rowgroup">
      <a role="cell">
        <div aria-label="Game Date" title="2026-05-13 02:30:01 UTC">1 day ago</div>
      </a>
    </div>
  `;
}

async function loadReplayButtonModule() {
  return import(`../../src/content/replay-button.ts?t=${Math.random()}`);
}

describe('replay button summary gating', () => {
  it('renders Watch Replay when View Summary is present', async () => {
    const { document } = setupDom(visibleSummaryRow('2001'));
    const trigger = installIntersectionObserverMock();
    installChromeMock();
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();

    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'));
    assert.ok(button, 'expected replay button');
    assert.match(button.textContent || '', /Watch Replay/);
  });

  it('keeps Watch Replay on later scans after appending its own text', async () => {
    const { document } = setupDom(visibleSummaryRow('2007'));
    const trigger = installIntersectionObserverMock();
    installChromeMock();
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();
    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'));
    assert.ok(button, 'expected replay button');

    mod.scanGameRows();
    await delay(100);

    assert.equal(document.querySelectorAll('.aoe4-replay-btn').length, 1);
    assert.equal(document.querySelectorAll('.aoe4-replay-loading').length, 0);
  });

  it('skips replay controls when View Summary is absent', async () => {
    const { document } = setupDom(hiddenSummaryRow('2002'));
    const trigger = installIntersectionObserverMock();
    const { messages } = installChromeMock();
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();
    await delay(700);

    assert.equal(document.querySelector('.aoe4-replay-btn, .aoe4-replay-loading, .aoe4-replay-unavailable'), null);
    assert.equal(messages.some(msg => msg.type === 'checkReplays'), false);
  });

  it('renders hidden-summary rows when the stored override is enabled', async () => {
    const { document } = setupDom(hiddenSummaryRow('2003'));
    const trigger = installIntersectionObserverMock();
    installChromeMock({ [SUMMARY_REPLAY_OVERRIDE_KEY]: true });
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();

    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'));
    assert.ok(button, 'expected replay button with stored override');
  });

  it('rescans hidden-summary rows when the stored override loads after the first scan', async () => {
    const { document } = setupDom(hiddenSummaryRow('2006'));
    const trigger = installIntersectionObserverMock();
    installChromeMock({ [SUMMARY_REPLAY_OVERRIDE_KEY]: true });
    const mod = await loadReplayButtonModule();

    mod.scanGameRows();
    trigger();

    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'));
    assert.ok(button, 'expected replay button after initial override load');
  });

  it('starts rendering skipped hidden-summary rows after the override is stored', async () => {
    const { document } = setupDom(hiddenSummaryRow('2004'));
    const trigger = installIntersectionObserverMock();
    const mock = installChromeMock();
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();
    await delay(100);
    assert.equal(document.querySelector('.aoe4-replay-btn'), null);

    await mock.chrome.storage.local.set({ [SUMMARY_REPLAY_OVERRIDE_KEY]: true });
    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'));
    assert.ok(button, 'expected replay button after override change');
  });

  it('rescans when aoe4world replaces a row before replay availability resolves', async () => {
    const { document } = setupDom(visibleSummaryRow('2005'));
    const trigger = installIntersectionObserverMock();
    installChromeMock();
    const mod = await loadReplayButtonModule();
    await delay(0);

    mod.scanGameRows();
    trigger();
    await delay(100);
    document.body.innerHTML = visibleSummaryRow('2005');

    const button = await waitFor(() => document.querySelector('.aoe4-replay-btn'), 2500);
    assert.ok(button, 'expected replay button on replacement row');
    assert.equal(document.querySelectorAll('.aoe4-replay-loading').length, 0);
  });
});
