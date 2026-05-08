import { onSettingsChange, recolorEnabled, removeEarlyHideStyle } from './settings.ts';
import { AOE4_PLAYER_COLOR_HEX, lookupReplayColorIndex } from './colors.ts';
import type { GameSummary, ReplayPlayer, Settings } from './types.ts';

interface ChartInjectorMessage {
  source: 'aoe4-color-ext';
  type: 'apply-colors' | 'clear-colors' | 'disable-colors';
  colorByName?: Record<string, string>;
}

interface ChartInjectorEvent {
  source?: string;
  type?: 'ready' | 'error';
  error?: unknown;
}

export const replayColorsWarned = new Set<string>();

const REPLAY_COLORS_MEMO_LIMIT = 100;
const replayColorsMemo = new Map<string, ReplayPlayer[]>();

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
let chartInjectorLoading = false;
const pendingColorMessages: ChartInjectorMessage[] = [];

export function ensureChartInjector(): void {
  if (!recolorEnabled()) return;
  if (chartInjectorReady || chartInjectorLoading) return;
  chartInjectorLoading = true;
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
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('chart-injector.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

export function applyReplayColorsToNativeChart(summary: GameSummary | null | undefined): void {
  if (!recolorEnabled()) return;
  const replayPlayers = summary?._aoe4ReplayPlayers;
  if (!Array.isArray(replayPlayers) || !replayPlayers.length) return;
  const colorByName: Record<string, string> = {};
  const summaryPlayers = Array.isArray(summary?.players) ? summary.players : [];
  summaryPlayers.forEach((sp, index: number) => {
    const idx = lookupReplayColorIndex(summary, sp, index);
    if (idx == null) return;
    const hex = AOE4_PLAYER_COLOR_HEX[idx];
    if (sp.name) colorByName[String(sp.name)] = hex;
  });
  for (const rp of replayPlayers) {
    if (!rp.name || colorByName[rp.name] != null) continue;
    if (Number.isInteger(rp.color) && rp.color >= 0 && rp.color < 8) {
      colorByName[rp.name] = AOE4_PLAYER_COLOR_HEX[rp.color];
    }
  }
  if (!Object.keys(colorByName).length) return;
  sendChartInjectorMessage({ source: 'aoe4-color-ext', type: 'apply-colors', colorByName });
}

export function sendChartInjectorMessage(message: ChartInjectorMessage): void {
  if (!recolorEnabled()) return;
  ensureChartInjector();
  if (chartInjectorReady) window.postMessage(message, '*');
  else pendingColorMessages.push(message);
}

// Disable: clear pending queue and tell injector to drop its color map.
function onRecolorDisabled(): void {
  pendingColorMessages.length = 0;
  removeEarlyHideStyle();
  if (chartInjectorReady) {
    try { window.postMessage({ source: 'aoe4-color-ext', type: 'disable-colors' }, '*'); }
    catch (_) { /* ignore */ }
  }
}

onSettingsChange((prev: Settings, next: Settings) => {
  if (prev.recolorSwatches && !next.recolorSwatches) onRecolorDisabled();
});
