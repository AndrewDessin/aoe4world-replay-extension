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

    // Upgrade dots: only show for dots near the cursor in PIXEL space — time-only
    // matching would hit every player's upgrade in the snapped sample.
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
      const upgLabel = document.createElement('div');
      upgLabel.style.cssText = `font-size:0.68rem;color:${s.color || '#86efac'};margin-top:0.15rem;`;
      const needPlayerPrefix = s.playerName && s.playerName !== closestPlayer;
      upgLabel.textContent = needPlayerPrefix
        ? `⬆ ${s.playerName}: ${u.name}`
        : `⬆ ${u.name}`;
      tooltip.appendChild(upgLabel);
    }
  }

  const parentRect = tooltip.parentElement!.getBoundingClientRect();
  tooltip.style.maxWidth = '220px';
  tooltip.style.display = 'block';
  const tooltipWidth = tooltip.getBoundingClientRect().width;
  tooltip.style.left = `${Math.min(parentRect.width - tooltipWidth - 8, Math.max(0, event.clientX - parentRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(0, event.clientY - parentRect.top + 14)}px`;
}
