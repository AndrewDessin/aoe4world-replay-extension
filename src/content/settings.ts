import type { Settings } from './types.ts';

type SettingsChangeSubscriber = (prev: Settings, next: Settings) => void;

export const SETTINGS_DEFAULTS: Readonly<Settings> = Object.freeze({
  parseGameData: false,
  recolorSwatches: false,
  injectCharts: false,
  debugLogs: false,
});

export const RECOLOR_HINT_KEY = '__aoe4-color-ext-recolor-v1';
export const RECOLOR_HIDE_STYLE_ID = '__aoe4-color-ext-hide';

let SETTINGS: Settings = { ...SETTINGS_DEFAULTS };
let __settingsReadyResolve: (() => void) | null = null;
export const settingsReady: Promise<void> = new Promise(resolve => { __settingsReadyResolve = resolve; });

const subscribers = new Set<SettingsChangeSubscriber>();
export function onSettingsChange(cb: SettingsChangeSubscriber): () => boolean {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function writeRecolorHint(enabled: boolean): void {
  try { localStorage.setItem(RECOLOR_HINT_KEY, enabled ? '1' : '0'); }
  catch (_) { }
}

export function removeEarlyHideStyle(): void {
  const el = document.getElementById(RECOLOR_HIDE_STYLE_ID);
  if (el) el.remove();
}

export function applySettings(stored?: Partial<Settings> | null): void {
  const prev = SETTINGS;
  SETTINGS = { ...SETTINGS_DEFAULTS, ...(stored || {}) };
  writeRecolorHint(SETTINGS.parseGameData && SETTINGS.recolorSwatches);
  for (const cb of subscribers) {
    try { cb(prev, SETTINGS); } catch (e) { console.warn('[settings] subscriber error', e); }
  }
}

export function parseGameDataEnabled(): boolean { return SETTINGS.parseGameData === true; }
export function recolorEnabled(): boolean { return parseGameDataEnabled() && SETTINGS.recolorSwatches === true; }
export function chartsEnabled(): boolean { return parseGameDataEnabled() && SETTINGS.injectCharts === true; }

export const dbg = (...args: unknown[]): void => { if (SETTINGS.debugLogs) console.log(...args); };
export const dbgWarn = (...args: unknown[]): void => { if (SETTINGS.debugLogs) console.warn(...args); };

chrome.storage.local.get('settings', ({ settings }: { settings?: Partial<Settings> }) => {
  applySettings(settings);
  __settingsReadyResolve?.();
  if (!SETTINGS.recolorSwatches) {
    removeEarlyHideStyle();
  }
});

chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area !== 'local' || !changes.settings) return;
  applySettings(changes.settings.newValue as Partial<Settings> | null | undefined);
});
