import { onSettingsChange, recolorEnabled, removeEarlyHideStyle } from './settings.ts';
import { AOE4_PLAYER_COLOR_HEX, PLAYER_COLORS, lookupReplayColorIndex, validColor } from './colors.ts';
import type { GameSummary, ReplayPlayer, Settings } from './types.ts';

interface ChartInjectorMessage {
  source: 'aoe4-color-ext';
  type: 'apply-colors' | 'clear-colors' | 'disable-colors' | 'colors-loading' | 'colors-unavailable' | 'ping';
  colorByName?: Record<string, string>;
}

export interface GetPlayerColorsResponse {
  success?: boolean;
  rateLimited?: boolean;
  disabled?: boolean;
  cached?: boolean;
  error?: string;
  players?: ReplayPlayer[];
}

export type ReplayColorLoadResult =
  | { ok: true; players: ReplayPlayer[]; cached?: boolean }
  | { ok: false; error?: string; rateLimited?: boolean; disabled?: boolean; cached?: boolean };

interface ChartInjectorEvent {
  source?: string;
  type?: 'ready' | 'error';
  error?: unknown;
}

export const replayColorsWarned = new Set<string>();

const REPLAY_COLORS_MEMO_LIMIT = 100;
const replayColorsMemo = new Map<string, ReplayPlayer[]>();
const replayColorsInFlight = new Map<string, Promise<ReplayColorLoadResult>>();

export function rememberReplayPlayers(matchId: string, players: ReplayPlayer[]): void {
  if (!matchId || !Array.isArray(players)) return;
  if (replayColorsMemo.has(matchId)) replayColorsMemo.delete(matchId);
  replayColorsMemo.set(matchId, players);
  while (replayColorsMemo.size > REPLAY_COLORS_MEMO_LIMIT) {
    const oldestKey = replayColorsMemo.keys().next().value;
    if (!oldestKey) break;
    replayColorsMemo.delete(oldestKey);
  }
}

export function recallReplayPlayers(matchId: string): ReplayPlayer[] | null {
  if (!matchId || !replayColorsMemo.has(matchId)) return null;
  const players = replayColorsMemo.get(matchId);
  if (!players) return null;
  replayColorsMemo.delete(matchId);
  replayColorsMemo.set(matchId, players);
  return players;
}

let chartInjectorReady = false;
let chartInjectorListenerInstalled = false;
const pendingColorMessages: ChartInjectorMessage[] = [];

function canPostWindowMessage(): boolean {
  return typeof window.postMessage === 'function';
}

export function ensureChartInjector(force = false): void {
  if (!force && !recolorEnabled()) return;
  if (!canPostWindowMessage()) return;
  if (!chartInjectorListenerInstalled) {
    chartInjectorListenerInstalled = true;
    window.addEventListener('message', (event: MessageEvent<ChartInjectorEvent>) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'aoe4-color-ext') return;
      if (data.type === 'ready') {
        chartInjectorReady = true;
        for (const msg of pendingColorMessages) window.postMessage(msg, '*');
        pendingColorMessages.length = 0;
      } else if (data.type === 'error') {
        console.warn('[replay] chart injector error:', data.error);
      }
    });
  }
  if (!chartInjectorReady) {
    window.postMessage({ source: 'aoe4-color-ext', type: 'ping' }, '*');
  }
}

export function getReplayPlayers(matchId: string): Promise<ReplayColorLoadResult> {
  if (!matchId) return Promise.resolve({ ok: false, error: 'missing_match_id' });
  if (!recolorEnabled()) return Promise.resolve({ ok: false, error: 'disabled', disabled: true });
  const memoized = recallReplayPlayers(matchId);
  if (memoized) return Promise.resolve({ ok: true, players: memoized, cached: true });
  const existing = replayColorsInFlight.get(matchId);
  if (existing) return existing;

  const request = new Promise<ReplayColorLoadResult>((resolve) => {
    chrome.runtime.sendMessage({ type: 'getPlayerColors', matchId }, (response: GetPlayerColorsResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime_error' });
        return;
      }
      if (response?.success && Array.isArray(response.players)) {
        rememberReplayPlayers(matchId, response.players);
        resolve({ ok: true, players: response.players, cached: response.cached });
        return;
      }
      resolve({
        ok: false,
        error: response?.error || 'unknown',
        rateLimited: response?.rateLimited,
        disabled: response?.disabled || response?.error === 'disabled',
        cached: response?.cached,
      });
    });
  }).finally(() => {
    replayColorsInFlight.delete(matchId);
  });

  replayColorsInFlight.set(matchId, request);
  return request;
}

export function beginReplayColorLoad(matchId: string): Promise<ReplayColorLoadResult> {
  if (recolorEnabled()) {
    sendChartInjectorControlMessage({ source: 'aoe4-color-ext', type: 'colors-loading' });
  } else {
    releaseNativeChartColorGate();
  }
  return getReplayPlayers(matchId);
}

export function replayColorMapForSummary(summary: GameSummary | null | undefined): Record<string, string> {
  const replayPlayers = summary?._aoe4ReplayPlayers;
  if (!Array.isArray(replayPlayers) || !replayPlayers.length) return {};
  const colorByName: Record<string, string> = {};
  const summaryPlayers = Array.isArray(summary?.players) ? summary.players : [];
  summaryPlayers.forEach((sp, index: number) => {
    const idx = lookupReplayColorIndex(summary, sp, index);
    if (idx == null) return;
    const hex = AOE4_PLAYER_COLOR_HEX[idx] ?? PLAYER_COLORS[idx % PLAYER_COLORS.length];
    if (sp.name) colorByName[String(sp.name)] = hex;
  });
  for (const rp of replayPlayers) {
    if (!rp.name || colorByName[rp.name] != null) continue;
    if (validColor(rp.color)) {
      colorByName[rp.name] = AOE4_PLAYER_COLOR_HEX[rp.color] ?? PLAYER_COLORS[rp.color % PLAYER_COLORS.length];
    }
  }
  return colorByName;
}

export function replayColorMapForPlayers(replayPlayers: ReplayPlayer[] | null | undefined): Record<string, string> {
  const colorByName: Record<string, string> = {};
  if (!Array.isArray(replayPlayers)) return colorByName;
  for (const rp of replayPlayers) {
    if (!rp.name || !validColor(rp.color)) continue;
    colorByName[rp.name] = AOE4_PLAYER_COLOR_HEX[rp.color] ?? PLAYER_COLORS[rp.color % PLAYER_COLORS.length];
  }
  return colorByName;
}

export function applyReplayPlayersToNativeChart(replayPlayers: ReplayPlayer[] | null | undefined): boolean {
  if (!recolorEnabled()) return false;
  const colorByName = replayColorMapForPlayers(replayPlayers);
  if (!Object.keys(colorByName).length) return false;
  sendChartInjectorMessage({ source: 'aoe4-color-ext', type: 'apply-colors', colorByName });
  return true;
}

export function applyReplayColorsToNativeChart(summary: GameSummary | null | undefined): boolean {
  if (!recolorEnabled()) return false;
  const colorByName = replayColorMapForSummary(summary);
  if (!Object.keys(colorByName).length) return false;
  sendChartInjectorMessage({ source: 'aoe4-color-ext', type: 'apply-colors', colorByName });
  return true;
}

export function sendChartInjectorMessage(message: ChartInjectorMessage): void {
  if (!recolorEnabled()) return;
  if (!canPostWindowMessage()) return;
  ensureChartInjector();
  if (chartInjectorReady) window.postMessage(message, '*');
  else pendingColorMessages.push(message);
}

export function sendChartInjectorControlMessage(message: ChartInjectorMessage): void {
  if (!canPostWindowMessage()) return;
  ensureChartInjector(true);
  if (chartInjectorReady) window.postMessage(message, '*');
  else pendingColorMessages.push(message);
}

export function releaseNativeChartColorGate(): void {
  sendChartInjectorControlMessage({ source: 'aoe4-color-ext', type: 'colors-unavailable' });
}

function onRecolorDisabled(): void {
  pendingColorMessages.length = 0;
  removeEarlyHideStyle();
  try { sendChartInjectorControlMessage({ source: 'aoe4-color-ext', type: 'disable-colors' }); }
  catch (_) { }
}

onSettingsChange((prev: Settings, next: Settings) => {
  const wasEnabled = prev.parseGameData === true && prev.recolorSwatches === true;
  const isEnabled = next.parseGameData === true && next.recolorSwatches === true;
  if (wasEnabled && !isEnabled) onRecolorDisabled();
});
