import { findTimelineElements, getGameIdFromUrl } from './dom.ts';
import { niceGeometryForChart } from './canvas-geom.ts';
import { chartsEnabled, recolorEnabled, settingsReady, onSettingsChange } from './settings.ts';
import {
  ensureChartInjector,
  sendChartInjectorControlMessage,
  applyReplayColorsToNativeChart,
  applyReplayPlayersToNativeChart,
  beginReplayColorLoad,
  getReplayPlayers,
  releaseNativeChartColorGate,
  replayColorsWarned,
} from './player-colors.ts';
import type { ReplayColorLoadResult } from './player-colors.ts';
import { ensurePbgidMap } from './pbgid-map.ts';
import { ensureUnitDataForSummary } from './unit-data-cache.ts';
import { clearUnitDisplayNameCaches } from './unit-icons.ts';
import { precomputeStackedValues } from './army-series.ts';
import { buildResourceGatheredCharts } from './chart-resources.ts';
import {
  buildArmyCharts,
  buildArmyValueLeadCharts,
  buildDestroyedValueCharts,
} from './chart-army.ts';
import { extractAgeUps } from './age-up.ts';
import {
  nativeTimelinePlayerColors,
  nativeTimelinePlayerOrder,
  restoreNativeTimeline,
  showNativeAgeUpOverlay,
  hideNativeAgeUpOverlay,
  ensureNativeAgeUpOverlayResizeObserver,
} from './native-timeline.ts';
import { animateTimelineCanvasChart, cancelAreaIconRedraw, cancelTimelineCanvasAnimation } from './canvas-render.ts';
import {
  renderArmyUnitLegend,
  removeArmyUnitLegend,
  refreshArmyLegendNames,
} from './legend.ts';
import { clearRangeState, syncRangeUi } from './range.ts';
import { attachCanvasTooltip, detachCanvasTooltip } from './tooltip.ts';
import {
  attachTimelineHoverGuard,
  attachPlayerToggle,
} from './interactions.ts';
import type {
  AgeUp,
  Chart,
  GameSummary,
  TimelineElements,
  TooltipCacheRow,
} from './types.ts';

type BuildOrderElement = HTMLElement & {
  __aoe4BuildOrderObserver?: MutationObserver;
};

let summaryChartUrl = '';
let summaryChartGameId = '';
let summaryChartRouteToken = 0;

function clearActiveSummaryRoute(): void {
  summaryChartUrl = '';
  summaryChartGameId = '';
  summaryChartRouteToken++;
  sendChartInjectorControlMessage({ source: 'aoe4-color-ext', type: 'clear-colors' });
}

function isCurrentGameRequest(timeline: TimelineElements, gameId: string | undefined, routeToken: number | undefined): boolean {
  return Boolean(
    gameId &&
    routeToken != null &&
    timeline.root.__aoe4GameId === gameId &&
    timeline.root.__aoe4RouteToken === routeToken &&
    summaryChartGameId === gameId &&
    summaryChartRouteToken === routeToken &&
    getGameIdFromUrl(window.location.href) === gameId,
  );
}

export function tryAddSummaryCharts(): void {
  const gameId = getGameIdFromUrl(window.location.href);
  if (!chartsEnabled()) {
    if (gameId) releaseNativeChartColorGate();
    if (summaryChartGameId) clearActiveSummaryRoute();
    return;
  }
  if (!gameId) {
    if (summaryChartGameId) clearActiveSummaryRoute();
    return;
  }
  if (summaryChartGameId && summaryChartGameId !== gameId) {
    clearActiveSummaryRoute();
  }
  const timeline = findTimelineElements() as TimelineElements | null;
  if (!timeline) {
    if (document.readyState === 'complete') releaseNativeChartColorGate();
    return;
  }
  const buildOrder = document.querySelector('build-order[url]') as Element | null;
  const url = buildOrder?.getAttribute('url') || buildSummaryUrl();
  if (!url) {
    if (document.readyState === 'complete') releaseNativeChartColorGate();
    return;
  }
  const existingRouteToken = timeline.root.__aoe4RouteToken;
  const hasCurrentRoute = isCurrentGameRequest(timeline, gameId, existingRouteToken);
  if (timeline.root.dataset.aoe4SummaryPlusUrl === url) {
    if (hasCurrentRoute && timeline.select.querySelector('optgroup[data-aoe4-summary-plus]')) return;
    if (hasCurrentRoute && timeline.root.dataset.aoe4SummaryPlusPendingUrl === url) return;
  }
  summaryChartUrl = url;
  summaryChartGameId = gameId;
  const routeToken = ++summaryChartRouteToken;
  if (timeline.root.__aoe4GameId && timeline.root.__aoe4GameId !== gameId) {
    sendChartInjectorControlMessage({ source: 'aoe4-color-ext', type: 'clear-colors' });
  }
  timeline.root.dataset.aoe4SummaryPlusUrl = url;
  timeline.root.dataset.aoe4SummaryPlusPendingUrl = url;
  timeline.root.__aoe4GameId = gameId;
  timeline.root.__aoe4RouteToken = routeToken;
  delete timeline.root.__aoe4ColorsRequestedFor;

  const replayColorsPromise = recolorEnabled()
    ? beginReplayColorLoad(gameId)
    : Promise.resolve({ ok: false, disabled: true, error: 'disabled' } as ReplayColorLoadResult);
  if (!recolorEnabled()) releaseNativeChartColorGate();
  replayColorsPromise.then((result) => {
    if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
    if (result.ok) {
      if (!applyReplayPlayersToNativeChart(result.players)) releaseNativeChartColorGate();
    } else {
      releaseNativeChartColorGate();
    }
  });

  fetch(toAbsoluteUrl(url), { headers: { Accept: 'application/json' } })
    .then((response: Response) => {
      if (!response.ok) throw new Error(`AoE4 World summary returned HTTP ${response.status}`);
      return response.json();
    })
    .then(async (summary: GameSummary) => {
      if (!isCurrentGameRequest(timeline, gameId, routeToken)) {
        if (timeline.root.dataset.aoe4SummaryPlusPendingUrl === url) {
          delete timeline.root.dataset.aoe4SummaryPlusPendingUrl;
        }
        return;
      }
      const replayColors = await replayColorsPromise;
      if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
      applyReplayColorResult(summary, replayColors, gameId);
      if (timeline.root.dataset.aoe4SummaryPlusPendingUrl === url) {
        delete timeline.root.dataset.aoe4SummaryPlusPendingUrl;
      }
      installTimelineMetrics(timeline, summary);
      ensureChartInjector();
      ensureReplayPlayerColors(timeline);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : error;
      if (!isCurrentGameRequest(timeline, gameId, routeToken)) {
        if (timeline.root.dataset.aoe4SummaryPlusPendingUrl === url) {
          delete timeline.root.dataset.aoe4SummaryPlusPendingUrl;
        }
        return;
      }
      releaseNativeChartColorGate();
      console.warn('[replay] Failed to load AoE4 World summary metrics:', message);
      if (timeline.root.dataset.aoe4SummaryPlusUrl === url) {
        delete timeline.root.dataset.aoe4SummaryPlusUrl;
      }
      if (timeline.root.dataset.aoe4SummaryPlusPendingUrl === url) {
        delete timeline.root.dataset.aoe4SummaryPlusPendingUrl;
      }
    });
}

function applyReplayColorResult(
  summary: GameSummary,
  result: ReplayColorLoadResult,
  gameId: string,
): boolean {
  if (result.ok) {
    summary._aoe4ReplayPlayers = result.players;
    if (applyReplayColorsToNativeChart(summary)) return true;
    releaseNativeChartColorGate();
    return false;
  }
  releaseNativeChartColorGate();
  if (!result.disabled && !result.rateLimited && !replayColorsWarned.has(gameId)) {
    replayColorsWarned.add(gameId);
    console.warn(`[replay] Could not get in-game player colors for match ${gameId}: ${result.error || 'unknown'}`);
  }
  return false;
}

function buildSummaryUrl(): string {
  const path = window.location.pathname.match(/^(\/players\/\d+(?:-[^/]*)?\/games\/\d+)/)?.[1];
  if (!path) return '';
  const params = new URLSearchParams(window.location.search);
  params.set('camelize', 'true');
  return `${path}/summary?${params.toString()}`;
}

function toAbsoluteUrl(url: string): string {
  return new URL(url, window.location.origin).toString();
}

function installTimelineMetrics(timeline: TimelineElements, summary: GameSummary): void {
  const gameId = timeline.root.__aoe4GameId;
  const routeToken = timeline.root.__aoe4RouteToken;
  if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
  timeline.__aoe4Summary = summary;
  const nativeColors = nativeTimelinePlayerColors(timeline) as Map<string, string>;
  const nativePlayerOrder = nativeTimelinePlayerOrder(timeline, summary) as string[];
  const charts = buildTimelineChartCatalog(summary, nativeColors, nativePlayerOrder);
  const chartByValue = new Map<string, Chart>(charts.map(chart => [chart.value, chart]));
  timeline.select.__aoe4SummaryCharts = chartByValue;

  let optgroup = timeline.select.querySelector('optgroup[data-aoe4-summary-plus]') as HTMLOptGroupElement | null;
  if (!optgroup) {
    optgroup = document.createElement('optgroup');
    optgroup.dataset.aoe4SummaryPlus = 'true';
    optgroup.label = 'Summary+';
    timeline.select.appendChild(optgroup);
  }
  optgroup.replaceChildren();
  for (const chart of charts) {
    const option = document.createElement('option');
    option.value = chart.value;
    option.textContent = chart.title;
    optgroup.appendChild(option);
  }

  if (!timeline.select.__aoe4SummaryListenerInstalled) {
    timeline.select.__aoe4SummaryListenerInstalled = true;
    const handler = (event: Event): void => handleTimelineMetricEvent(event, timeline);
    timeline.select.addEventListener('input', handler, true);
    timeline.select.addEventListener('change', handler, true);
  }

  ensureBuildOrderObserver(timeline);
  if (!timeline.select.__aoe4SummaryCharts?.has(timeline.select.value)) {
    showNativeAgeUpOverlay(timeline);
  } else {
    hideNativeAgeUpOverlay(timeline);
  }

  ensureUnitDataForSummary(summary, () => {
    if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
    if (!timeline.__aoe4Summary) return;
    if (timeline.chartBox?.__aoe4HoverActive) return;
    installTimelineMetrics(timeline, timeline.__aoe4Summary);
    const active = timeline.select.__aoe4SummaryActiveValue;
    if (active) {
      const chart = timeline.select.__aoe4SummaryCharts?.get(active);
      if (chart) renderTimelineMetric(timeline, chart);
    }
  });

  ensurePbgidMap(() => {
    if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
    if (!timeline.__aoe4Summary) return;
    if (timeline.chartBox?.__aoe4HoverActive) return;
    installTimelineMetrics(timeline, timeline.__aoe4Summary);
    const active = timeline.select.__aoe4SummaryActiveValue;
    if (active) {
      const chart = timeline.select.__aoe4SummaryCharts?.get(active);
      if (chart) renderTimelineMetric(timeline, chart);
    }
  });
}

function ensureBuildOrderObserver(timeline: TimelineElements): void {
  const gameId = timeline.root.__aoe4GameId;
  const routeToken = timeline.root.__aoe4RouteToken;
  if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
  const target = document.querySelector('build-order') as BuildOrderElement | null;
  if (!target) {
    if (!timeline.__aoe4BuildOrderRetryScheduled) {
      timeline.__aoe4BuildOrderRetryScheduled = true;
      setTimeout(() => {
        timeline.__aoe4BuildOrderRetryScheduled = false;
        ensureBuildOrderObserver(timeline);
      }, 500);
    }
    return;
  }
  if (target.__aoe4BuildOrderObserver) {
    target.__aoe4BuildOrderObserver.disconnect();
  }
  let pending: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
      clearUnitDisplayNameCaches();
      if (timeline.chartBox?.__aoe4HoverActive) return;
      const activeValue = timeline.select.__aoe4SummaryActiveValue;
      const chart = activeValue ? timeline.select.__aoe4SummaryCharts?.get(activeValue) : undefined;
      if (chart?.type === 'army') refreshArmyLegendNames(timeline, chart);
    }, 500);
  };
  const observer = new MutationObserver(debounced);
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title', 'alt', 'src', 'srcset']
  });
  target.__aoe4BuildOrderObserver = observer;
  timeline.__aoe4BuildOrderObserver = observer;
}

function buildTimelineChartCatalog(summary: GameSummary, nativeColors: Map<string, string>, nativePlayerOrder: string[] = []): Chart[] {
  const charts = ([] as Chart[])
    .concat(buildResourceGatheredCharts(summary, nativeColors) as Chart[])
    .concat(buildArmyCharts(summary, nativeColors, nativePlayerOrder) as Chart[])
    .concat(buildArmyValueLeadCharts(summary, nativeColors, nativePlayerOrder) as Chart[])
    .concat(buildDestroyedValueCharts(summary, nativeColors, nativePlayerOrder) as Chart[]);
  const ageUps = extractAgeUps(summary, nativeColors) as AgeUp[];
  for (const chart of charts) {
    if (chart.type === 'army') precomputeStackedValues(chart.data.series);
    precomputeChartGeometry(chart);
    chart.ageUps = ageUps;
  }
  return charts;
}

function precomputeChartGeometry(chart: Chart): void {
  let yMin = 0;
  let yMax = 1;
  for (const series of chart.data.series) {
    const vals = (chart.type === 'army' && series._stackTop) ? series._stackTop : series.values;
    for (const value of vals) {
      if (value < yMin) yMin = value;
      if (value > yMax) yMax = value;
    }
  }
  chart._geometry = niceGeometryForChart(chart.type, yMin, yMax);

  const series = chart.data.series;
  const numSamples = chart.data.labels.length;
  const tooltipRows: TooltipCacheRow[][] = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const rows: TooltipCacheRow[] = [];
    for (let s = 0; s < series.length; s++) {
      const item = series[s];
      if (item._hidden) continue;
      const value = item.values[i] || 0;
      const previous = i > 0 ? (item.values[i - 1] || 0) : value;
      const next = i < numSamples - 1 ? (item.values[i + 1] || 0) : value;
      const delta = chart.type === 'army'
        ? Math.abs(value) - Math.abs(previous)
        : 0;
      if (chart.type === 'army' && Math.abs(value) === 0 &&
          Math.abs(previous) === 0 && Math.abs(next) === 0) continue;
      rows.push({ seriesIdx: s, value, previous, next, delta });
    }
    if (chart.type !== 'army' && rows.length) {
      const maxValue = rows.reduce((max: number, row: TooltipCacheRow) => Math.max(max, row.value), -Infinity);
      for (const row of rows) {
        row.delta = row.value - maxValue;
        row.isLeader = row.delta === 0;
      }
    }
    rows.sort((a: TooltipCacheRow, b: TooltipCacheRow) => Math.abs(b.value) - Math.abs(a.value));
    tooltipRows[i] = rows;
  }
  chart._tooltipRows = tooltipRows;
}

function handleTimelineMetricEvent(event: Event, timeline: TimelineElements): void {
  const value = timeline.select.value;
  const chart = timeline.select.__aoe4SummaryCharts?.get(value);
  const previousValue = timeline.select.__aoe4SummaryActiveValue;
  if (previousValue !== value) {
    clearRangeState(timeline.chartBox);
  }
  if (!chart) {
    delete timeline.select.__aoe4SummaryActiveValue;
    restoreNativeTimeline(timeline);
    showNativeAgeUpOverlay(timeline);
    const btn = timeline.chartBox?.querySelector(':scope > .aoe4-range-reset') as HTMLElement | null;
    if (btn) btn.style.display = 'none';
    return;
  }
  hideNativeAgeUpOverlay(timeline);
  event.preventDefault();
  event.stopImmediatePropagation();
  timeline.select.__aoe4SummaryActiveValue = chart.value;
  renderTimelineMetric(timeline, chart);
  syncSelectValue(timeline.select, chart.value, () => !!timeline.select.__aoe4SummaryCharts?.has(chart.value));
  ensureReplayPlayerColors(timeline);
}

function ensureReplayPlayerColors(timeline: TimelineElements): void {
  if (!recolorEnabled()) {
    const unsub = onSettingsChange(() => {
      if (recolorEnabled()) {
        unsub();
        ensureReplayPlayerColors(timeline);
      }
    });
    return;
  }
  const summary = timeline.__aoe4Summary;
  const gameId = timeline.root.__aoe4GameId;
  const routeToken = timeline.root.__aoe4RouteToken;
  if (!summary || !gameId || !isCurrentGameRequest(timeline, gameId, routeToken)) return;
  if (summary._aoe4ReplayPlayers) return;
  if (timeline.root.__aoe4ColorsRequestedFor === gameId) return;
  timeline.root.__aoe4ColorsRequestedFor = gameId;
  getReplayPlayers(gameId).then((result) => {
    if (timeline.root.__aoe4ColorsRequestedFor === gameId) {
      delete timeline.root.__aoe4ColorsRequestedFor;
    }
    if (!isCurrentGameRequest(timeline, gameId, routeToken)) return;
    if (!result.ok) {
      if (!result.disabled && !result.rateLimited && !replayColorsWarned.has(gameId)) {
        replayColorsWarned.add(gameId);
        console.warn(`[replay] Could not get in-game player colors for match ${gameId}: ${result.error || 'unknown'}`);
      }
      return;
    }
    const replayPlayers = result.players;
    if (timeline.chartBox?.__aoe4HoverActive) {
      applyReplayColorsToNativeChart({ ...summary, _aoe4ReplayPlayers: replayPlayers });
      return;
    }
    summary._aoe4ReplayPlayers = replayPlayers;
    applyReplayColorsToNativeChart(summary);
    installTimelineMetrics(timeline, summary);
    const activeValue = timeline.select.__aoe4SummaryActiveValue;
    if (activeValue) {
      const chart = timeline.select.__aoe4SummaryCharts?.get(activeValue);
      if (chart) renderTimelineMetric(timeline, chart);
    }
  });
}

function syncSelectValue(select: TimelineElements['select'], value: string, isValid: () => boolean): void {
  const apply = (): void => {
    if (isValid()) select.value = value;
  };
  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 0);
  setTimeout(apply, 150);
  setTimeout(apply, 500);
}

function ensureSummaryCanvas(timeline: TimelineElements): TimelineElements['canvas'] {
  const oldCanvas = timeline.canvas;
  if (!oldCanvas?.parentElement) return oldCanvas;
  cancelTimelineCanvasAnimation(oldCanvas);
  cancelAreaIconRedraw(oldCanvas);
  oldCanvas.__aoe4ActiveChart = null;
  detachCanvasTooltip(oldCanvas);
  if (timeline.chartBox?.__aoe4DragAbort) {
    timeline.chartBox.__aoe4DragAbort.abort();
    timeline.chartBox.__aoe4DragAbort = null;
    timeline.chartBox.__aoe4ActiveDrag = null;
  }
  if (timeline.chartBox) timeline.chartBox.__aoe4HoverActive = false;
  oldCanvas.__aoe4HoverActive = false;
  if (!timeline.__aoe4NativeCanvas) timeline.__aoe4NativeCanvas = oldCanvas;
  const newCanvas = document.createElement('canvas') as TimelineElements['canvas'];
  for (const name of oldCanvas.getAttributeNames()) {
    newCanvas.setAttribute(name, oldCanvas.getAttribute(name) as string);
  }
  newCanvas.className = oldCanvas.className;
  newCanvas.style.cssText = oldCanvas.style.cssText;
  newCanvas.dataset.aoe4SummaryCanvas = 'true';
  newCanvas.style.opacity = '';
  oldCanvas.parentElement.replaceChild(newCanvas, oldCanvas);
  timeline.canvas = newCanvas;
  return newCanvas;
}

function renderTimelineMetric(timeline: TimelineElements, chart: Chart): void {
  if (!timeline.heading.dataset.aoe4NativeTitle) {
    timeline.heading.dataset.aoe4NativeTitle = timeline.heading.textContent || '';
  }
  timeline.heading.textContent = chart.title;
  const canvas = ensureSummaryCanvas(timeline);
  canvas.style.display = '';
  if (chart.type === 'army') renderArmyUnitLegend(timeline, chart);
  else removeArmyUnitLegend(timeline);
  animateTimelineCanvasChart(canvas, chart);
  attachTimelineHoverGuard(timeline, chart);
  attachCanvasTooltip(canvas, chart, timeline);
  attachPlayerToggle(timeline, chart);
  syncRangeUi(timeline, chart);
}
