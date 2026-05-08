// Boots the bundled IIFE content.js inside a vm context with linkedom DOM
// and a minimal browser shim. Returns helpers to inspect state.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { makeChromeMock } from './chrome-mock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export function loadFixture(name) {
  return readFileSync(path.join(ROOT, 'tests', 'fixtures', 'pages', name), 'utf8');
}

// Matches what the spa-watcher does at boot-time. We bump time forward
// after boot so that scanForRows() actually fires.
export function bootBundle({ html, url, sendMessageImpl, initial = {} } = {}) {
  const { window, document } = parseHTML(html);
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });

  const { chrome, messages, fanout, storageData } = makeChromeMock({ initial, sendMessageImpl });

  const observers = { mutation: [], intersection: [], resize: [] };
  class MutationObserver { constructor(cb){ this.cb=cb; observers.mutation.push(this); } observe(){} disconnect(){} takeRecords(){return [];} }
  class IntersectionObserver { constructor(cb){ this.cb=cb; observers.intersection.push(this); } observe(){} unobserve(){} disconnect(){} }
  class ResizeObserver { constructor(cb){ this.cb=cb; observers.resize.push(this); } observe(){} disconnect(){} }

  const ctx = {
    window,
    document,
    chrome,
    location: window.location,
    navigator: { userAgent: 'test' },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Promise,
    URL,
    Map,
    Set,
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    RegExp,
    Date,
    Error,
    Symbol,
    Reflect,
    Proxy,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' }),
    MutationObserver,
    IntersectionObserver,
    ResizeObserver,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    MouseEvent: window.MouseEvent || window.Event,
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    DOMParser: window.DOMParser,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  const code = readFileSync(path.join(ROOT, 'chrome-extension', 'content.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'content.js' });

  return {
    ctx, window, document, chrome, messages, observers, storageData, fanout,
    eval: (expr) => vm.runInContext(expr, ctx),
    waitForScan: () => new Promise(r => setTimeout(r, 850)),
    tick: (ms = 20) => new Promise(r => setTimeout(r, ms)),
  };
}
