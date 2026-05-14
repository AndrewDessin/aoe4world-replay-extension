import { normalizeName } from './dom.ts';
import type { GameSummary, PlayerSummary } from './types.ts';

export const PLAYER_COLORS = [
  '#0162FF', '#F60000', '#FFEE00', '#4DE94C',
  '#41D8FF', '#8E00FF', '#FF8C00', '#FF3395',
  '#C000C0', '#166534',
];

export const AOE4_PLAYER_COLOR_HEX = [
  '#0162FF', '#F60000', '#FFEE00', '#4DE94C',
  '#41D8FF', '#8E00FF', '#FF8C00', '#FF3395',
  '#C000C0', '#166534',
];

export function validColor(c: unknown): c is number {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 16;
}

function normalizeCivKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function compactCivKey(value: string): string {
  return normalizeCivKey(value).replace(/_/g, '');
}

export function civsOverlap(a: string, b: string): boolean {
  const normA = normalizeCivKey(a);
  const normB = normalizeCivKey(b);
  if (normA.startsWith(normB) || normB.startsWith(normA)) return true;
  const baseA = normA.replace(/_ha_\w+$/, '');
  const baseB = normB.replace(/_ha_\w+$/, '');
  if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) return true;
  const compactA = compactCivKey(baseA);
  const compactB = compactCivKey(baseB);
  if (compactA === compactB) return true;
  return false;
}

export function parseCssColor(color: string): [number, number, number] {
  const rgb = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = String(color).replace('#', '');
  const parts = hex.length === 3 ? hex.split('').map(value => value + value) : (hex.match(/.{2}/g) || []);
  const parsed = parts.slice(0, 3).map(value => parseInt(value, 16)).filter(Number.isFinite);
  return parsed.length === 3 ? [parsed[0], parsed[1], parsed[2]] : [1, 98, 255];
}

export function shadeColor(hex: string, index: number, total: number): string {
  const amount = total <= 1 ? 0 : ((index / Math.max(1, total - 1)) - 0.5) * 70;
  const rgb = parseCssColor(hex);
  const shaded = rgb.map(value => Math.max(24, Math.min(245, Math.round(value + amount))));
  return `#${shaded.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function lookupReplayColorIndex(summary: GameSummary | null | undefined, player: PlayerSummary | null | undefined, fallbackIndex: number): number | null {
  const replayPlayers = summary?._aoe4ReplayPlayers;
  if (!Array.isArray(replayPlayers) || !replayPlayers.length) return null;
  const summaryName = normalizeName(player?.name);
  const summaryCiv = normalizeName(player?.civilizationAttrib || player?.civilization);
  if (summaryName) {
    const byNameCiv = replayPlayers.find(rp => {
      if (normalizeName(rp.name) !== summaryName) return false;
      if (!summaryCiv || !rp.civilization) return true;
      return civsOverlap(summaryCiv, String(rp.civilization).toLowerCase());
    });
    if (byNameCiv && validColor(byNameCiv.color)) return byNameCiv.color;
    const byNameOnly = replayPlayers.filter(rp => normalizeName(rp.name) === summaryName);
    if (byNameOnly.length === 1 && validColor(byNameOnly[0].color)) return byNameOnly[0].color;
  }
  if (summaryCiv) {
    const byCiv = replayPlayers.filter(rp => civsOverlap(summaryCiv, String(rp.civilization || '').toLowerCase()));
    if (byCiv.length === 1 && validColor(byCiv[0].color)) return byCiv[0].color;
  }
  const slotMatch = replayPlayers.find(rp => rp.slot === fallbackIndex);
  if (slotMatch && validColor(slotMatch.color)) return slotMatch.color;
  return null;
}

export function playerColor(summary: GameSummary | null | undefined, player: PlayerSummary, fallbackIndex: number, nativeColors: Map<string, string> = new Map()): string {
  const replayColorIndex = lookupReplayColorIndex(summary, player, fallbackIndex);
  if (replayColorIndex != null) return AOE4_PLAYER_COLOR_HEX[replayColorIndex] ?? PLAYER_COLORS[replayColorIndex % PLAYER_COLORS.length];
  const nativeColor = nativeColors.get(String(player.name || '').toLowerCase());
  if (nativeColor) return nativeColor;
  return PLAYER_COLORS[Math.abs(fallbackIndex) % PLAYER_COLORS.length];
}
