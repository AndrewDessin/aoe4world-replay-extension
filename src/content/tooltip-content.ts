import { formatGameTime, summaryScaleX } from './canvas-geom.ts';
import {
  getCollapsedPlayers,
  playerCacheKey,
  PLAYER_CACHE_PREFIX,
} from './canvas-cache.ts';
import {
  appendArmyTooltipRows,
  appendTooltipRow,
} from './tooltip-rows.ts';
import type {
  Chart,
  ChartSeries,
  ClosestSeriesKey,
  StackedYCache,
  TooltipElement,
  TooltipRow,
  UnitUpgrade,
} from './types.ts';

function isStackedYCache(value: Float32Array | StackedYCache | undefined): value is StackedYCache {
  return Boolean(value) && !(value instanceof Float32Array);
}

type RgbColor = { r: number; g: number; b: number };

const TOOLTIP_BG: RgbColor = { r: 7, g: 12, b: 23 };
const TOOLTIP_ACCENT_FALLBACK = '#86EFAC';
const TOOLTIP_ACCENT_MIN_CONTRAST = 4.5;

function parseHexRgb(value: string | null | undefined): RgbColor | null {
  if (!value) return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: RgbColor, b: RgbColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixRgb(a: RgbColor, b: RgbColor, amount: number): RgbColor {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

export function readableTooltipAccentColor(color: string | null | undefined): string {
  const parsed = parseHexRgb(color) || parseHexRgb(TOOLTIP_ACCENT_FALLBACK);
  if (!parsed) return TOOLTIP_ACCENT_FALLBACK;
  if (contrastRatio(parsed, TOOLTIP_BG) >= TOOLTIP_ACCENT_MIN_CONTRAST) return rgbToHex(parsed);
  for (let amount = 0.15; amount <= 0.85; amount += 0.1) {
    const mixed = mixRgb(parsed, { r: 255, g: 255, b: 255 }, amount);
    if (contrastRatio(mixed, TOOLTIP_BG) >= TOOLTIP_ACCENT_MIN_CONTRAST) return rgbToHex(mixed);
  }
  return '#E2E8F0';
}

export function appendUpgradeTooltipLabel(
  tooltip: HTMLElement,
  playerName: string | null | undefined,
  upgradeName: string,
  color: string | null | undefined,
  includePlayer: boolean,
): HTMLElement {
  const upgLabel = document.createElement('div');
  upgLabel.className = 'aoe4-summary-tooltip-upgrade';
  upgLabel.style.setProperty('--aoe4-upgrade-accent', readableTooltipAccentColor(color));

  const marker = document.createElement('span');
  marker.className = 'aoe4-summary-tooltip-upgrade-marker';
  marker.textContent = '⬆';
  upgLabel.appendChild(marker);

  const text = document.createElement('span');
  text.className = 'aoe4-summary-tooltip-upgrade-text';
  if (includePlayer && playerName) {
    const player = document.createElement('span');
    player.className = 'aoe4-summary-tooltip-upgrade-player';
    player.textContent = playerName;
    text.append(player, document.createTextNode(': '));
  }
  const name = document.createElement('span');
  name.className = 'aoe4-summary-tooltip-upgrade-name';
  name.textContent = upgradeName;
  text.appendChild(name);
  upgLabel.appendChild(text);
  tooltip.appendChild(upgLabel);
  return upgLabel;
}

export function updateCanvasTooltip(
  tooltip: TooltipElement,
  canvas: HTMLCanvasElement,
  chart: Chart,
  index: number,
  event: MouseEvent,
  closestKey: ClosestSeriesKey,
): void {
  const lastIdx = tooltip.__lastIndex;
  const lastClosest = tooltip.__lastClosest;

  if (lastIdx !== index || lastClosest !== closestKey) {
    tooltip.__lastIndex = index;
    tooltip.__lastClosest = closestKey;
    tooltip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'aoe4-summary-tooltip-title';
    title.textContent = formatGameTime(chart.data.labels[index]);
    tooltip.appendChild(title);

    const precomputed = chart._tooltipRows?.[index];
    const series = chart.data.series;
    const rows: TooltipRow[] = precomputed
      ? precomputed
        .map((r): TooltipRow | null => {
          const item = series[r.seriesIdx];
          if (!item) return null;
          return {
            item,
            value: r.value,
            previous: r.previous,
            next: r.next,
            delta: r.delta,
            isLeader: r.isLeader,
            isClosest: Boolean(closestKey) && item.key === closestKey,
          };
        })
        .filter((row): row is TooltipRow => row !== null)
      : [];

    if (chart.type === 'army') {
      appendArmyTooltipRows(tooltip, rows, chart);
    } else if (chart.type === 'lead') {
      const allSeries = chart.data.series;
      const rawRows: TooltipRow[] = allSeries.map((s): TooltipRow => {
        const rawVal = s._rawValues?.[index] ?? Math.abs(s.values[index] || 0);
        return { item: s, value: rawVal };
      }).sort((a, b) => b.value - a.value);
      const maxVal = rawRows[0]?.value || 0;
      for (const r of rawRows) {
        const diff = r.value - maxVal;
        appendTooltipRow(tooltip, { ...r, delta: diff, isLeader: diff === 0 }, chart);
      }
    } else {
      for (const row of rows) appendTooltipRow(tooltip, row, chart);
    }
  }

  const parentRect = tooltip.parentElement!.getBoundingClientRect();
  tooltip.style.display = 'block';
  const tooltipWidth = tooltip.getBoundingClientRect().width;
  tooltip.style.left = `${Math.min(parentRect.width - tooltipWidth - 8, Math.max(0, event.clientX - parentRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(0, event.clientY - parentRect.top + 14)}px`;
}

export function updateArmyMiniTooltip(
  tooltip: TooltipElement,
  canvas: HTMLCanvasElement,
  chart: Chart,
  index: number,
  event: MouseEvent,
  closestKey: ClosestSeriesKey,
): void {
  const lastIdx = tooltip.__lastIndex;
  const lastClosest = tooltip.__lastClosest;
  if (lastIdx !== index || lastClosest !== closestKey) {
    tooltip.__lastIndex = index;
    tooltip.__lastClosest = closestKey;
    tooltip.replaceChildren();

    const title = document.createElement('div');
    title.className = 'aoe4-summary-tooltip-title';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';
    const timeText = formatGameTime(chart.data.labels[index]);

    let collapsedPlayerName: string | null = null;
    if (closestKey && typeof closestKey === 'string' && closestKey.startsWith(PLAYER_CACHE_PREFIX)) {
      collapsedPlayerName = closestKey.slice(PLAYER_CACHE_PREFIX.length);
    }

    if (collapsedPlayerName) {
      title.textContent = `${timeText}  ·  ${collapsedPlayerName}`;
      tooltip.appendChild(title);
      const playerUnits: TooltipRow[] = chart.data.series
        .filter(s => !s._hidden && s.playerName === collapsedPlayerName)
        .map((s): TooltipRow => {
          const value = Math.abs(s.values[index] || 0);
          const previous = index > 0 ? Math.abs(s.values[index - 1] || 0) : value;
          return { item: s, value, delta: value - previous, previous, next: value };
        })
        .filter(row => row.value > 0)
        .sort((a, b) => b.value - a.value);
      if (playerUnits.length) playerUnits[0].isClosest = true;
      for (const row of playerUnits) {
        appendTooltipRow(tooltip, row, { type: 'army' }, collapsedPlayerName);
      }
    } else if (closestKey) {
      const series = chart.data.series;
      const item = series.find(s => s.key === closestKey);
      if (item) {
        title.textContent = item.playerName
          ? `${timeText}  ·  ${item.playerName}`
          : timeText;
        tooltip.appendChild(title);
        const value = Math.abs(item.values[index] || 0);
        const previous = index > 0 ? Math.abs(item.values[index - 1] || 0) : value;
        const delta = value - previous;
        const row = {
          item, value, delta,
          isClosest: true,
          previous, next: value
        };
        appendTooltipRow(tooltip, row, { type: 'army' }, item.playerName || '');
      } else {
        title.textContent = timeText;
        tooltip.appendChild(title);
      }
    } else {
      title.textContent = timeText;
      tooltip.appendChild(title);
    }

    const collapsedPlayers = getCollapsedPlayers(chart);
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const margin = { top: 18, right: 14, bottom: 32, left: 28 };
    const plotW = Math.max(1, cssWidth - margin.left - margin.right);
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const UPGRADE_PROX_PX = 14;
    const closestPlayer = collapsedPlayerName
      || (closestKey ? chart.data.series.find(s => s.key === closestKey)?.playerName || null : null);
    const seenUpgrades = new Set<string>();
    const candidates: Array<{ s: ChartSeries; u: UnitUpgrade; dist: number }> = [];
    for (const s of chart.data.series) {
      if (s._hidden || !s.upgrades?.length) continue;
      const playerName = s.playerName || '';
      const ysKey = playerName && collapsedPlayers.has(playerName) ? playerCacheKey(playerName) : s.key;
      if (!ysKey) continue;
      const ys = chart._renderedY?.get(ysKey);
      if (!isStackedYCache(ys) || !ys.stackTop.length) continue;
      const maxTimeSec = chart.data.labels[chart.data.labels.length - 1] || 1;
      for (const u of s.upgrades) {
        const fracIdx = (u.time / maxTimeSec) * (ys.stackTop.length - 1);
        const i = Math.round(fracIdx);
        if (i < 0 || i >= ys.stackTop.length) continue;
        const dotX = summaryScaleX(i, ys.stackTop.length, margin, plotW);
        const dotY = ys.stackTop[i];
        const dx = dotX - cursorX;
        const dy = dotY - cursorY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > UPGRADE_PROX_PX) continue;
        const dedupeKey = `${s.playerName || ''}|${u.name}|${Math.round(u.time)}`;
        if (seenUpgrades.has(dedupeKey)) continue;
        seenUpgrades.add(dedupeKey);
        candidates.push({ s, u, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const { s, u } of candidates) {
      const needPlayerPrefix = s.playerName && s.playerName !== closestPlayer;
      appendUpgradeTooltipLabel(tooltip, s.playerName, u.name, s.color, Boolean(needPlayerPrefix));
    }
  }

  const parentRect = tooltip.parentElement!.getBoundingClientRect();
  tooltip.style.maxWidth = '220px';
  tooltip.style.display = 'block';
  const tooltipWidth = tooltip.getBoundingClientRect().width;
  tooltip.style.left = `${Math.min(parentRect.width - tooltipWidth - 8, Math.max(0, event.clientX - parentRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(0, event.clientY - parentRect.top + 14)}px`;
}
