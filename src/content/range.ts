import { escapeHtml } from './dom.ts';
import { drawTimelineCanvasChart } from './canvas-render.ts';
import { resetLegendSummary, setDeltaCells } from './legend-live.ts';
import type {
  Chart,
  ChartBoxExtensions,
  DragState,
  LegendNodeMeta,
  LegendSummaryNode,
  LegendUnitNode,
  RangeState,
  TimelineElements,
} from './types.ts';

type ChartBoxElement = HTMLElement & ChartBoxExtensions;

export const RANGE_DRAG_THRESHOLD_PX = 4;

function isSummaryNode(key: string, _meta: LegendNodeMeta): _meta is LegendSummaryNode {
  return key.startsWith('__summary__');
}

function isUnitNode(key: string, _meta: LegendNodeMeta): _meta is LegendUnitNode {
  return !key.startsWith('__summary__');
}

export function clientXToSampleIndex(canvas: HTMLCanvasElement, chart: Chart, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  const margin = { top: 18, right: 14, bottom: 32, left: 28 };
  const plotW = Math.max(1, rect.width - margin.left - margin.right);
  const labels = chart.data.labels;
  if (!labels?.length) return 0;
  const raw = ((clientX - rect.left - margin.left) / plotW) * (labels.length - 1);
  return Math.max(0, Math.min(labels.length - 1, Math.round(raw)));
}

export function getActiveRange(chartBox: ChartBoxElement | null | undefined, chart: Chart): RangeState | null {
  const range = chartBox?.__aoe4ActiveRange;
  if (!range || range.chartValue !== chart.value) return null;
  return range;
}

export function getActiveDrag(chartBox: ChartBoxElement | null | undefined, chart: Chart): DragState | null {
  const drag = chartBox?.__aoe4ActiveDrag;
  if (!drag || drag.chartValue !== chart.value) return null;
  return drag;
}

export function clearRangeState(chartBox: ChartBoxElement | null | undefined): void {
  if (!chartBox) return;
  chartBox.__aoe4ActiveRange = null;
  chartBox.__aoe4ActiveDrag = null;
  if (chartBox.__aoe4DragAbort) {
    chartBox.__aoe4DragAbort.abort();
    chartBox.__aoe4DragAbort = null;
  }
}

export function countInRange(sortedTimes: number[] | undefined, t0: number, t1: number): number {
  if (!sortedTimes?.length) return 0;
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedTimes[mid] < t0) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedTimes[mid] <= t1) lo = mid + 1;
    else hi = mid;
  }
  return lo - start;
}

export function countAfterStartInRange(sortedTimes: number[] | undefined, t0: number, t1: number): number {
  if (!sortedTimes?.length) return 0;
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedTimes[mid] <= t0) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedTimes[mid] <= t1) lo = mid + 1;
    else hi = mid;
  }
  return lo - start;
}

function activeValueAt(item: { values?: number[] }, index: number): number {
  return Math.max(0, Math.round(Math.abs(item.values?.[index] || 0)));
}

function rangeUnitStats(
  item: { values?: number[]; _finishedTimes?: number[]; _destroyedTimes?: number[] },
  startIdx: number,
  endIdx: number,
  t0: number,
  t1: number,
): { initial: number; end: number; trained: number; lost: number; relevant: boolean } {
  const initial = activeValueAt(item, startIdx);
  const end = activeValueAt(item, endIdx);
  const trained = countAfterStartInRange(item._finishedTimes, t0, t1);
  const rawLost = countAfterStartInRange(item._destroyedTimes, t0, t1);
  const inferredLost = Math.max(0, initial + trained - end);
  const maxPossibleLost = initial + trained;
  const lost = Math.min(maxPossibleLost, Math.max(rawLost, inferredLost));
  return {
    initial,
    end,
    trained,
    lost,
    relevant: initial > 0 || end > 0 || trained > 0 || lost > 0,
  };
}

export function ensureResetButton(timeline: TimelineElements | null): HTMLButtonElement | null {
  const chartBox = timeline?.chartBox;
  if (!chartBox) return null;
  let btn = chartBox.querySelector<HTMLButtonElement>(':scope > .aoe4-range-reset');
  if (btn) return btn;
  const position = getComputedStyle(chartBox).position;
  if (!position || position === 'static') chartBox.style.position = 'relative';
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'aoe4-range-reset';
  btn.textContent = 'Reset';
  btn.style.display = 'none';
  btn.addEventListener('click', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!timeline) return;
    const activeValue = timeline.select.__aoe4SummaryActiveValue;
    const chart = activeValue ? timeline.select.__aoe4SummaryCharts?.get(activeValue) : null;
    clearRangeState(chartBox);
    if (chart) {
      syncRangeUi(timeline, chart);
      drawTimelineCanvasChart(timeline.canvas, chart);
    } else {
      btn.style.display = 'none';
    }
  });
  chartBox.appendChild(btn);
  return btn;
}

export function syncRangeUi(timeline: TimelineElements | null, chart: Chart | null): void {
  const chartBox = timeline?.chartBox;
  if (!timeline || !chartBox || !chart) return;
  const btn = ensureResetButton(timeline);
  const range = getActiveRange(chartBox, chart);
  const isArmy = chart.type === 'army';
  if (btn) btn.style.display = isArmy && range ? '' : 'none';

  if (isArmy && range) {
    applyRangeLegend(chart, timeline);
    const mini = timeline.canvas.__aoe4SummaryHandlers?.armyMiniTooltip;
    if (mini) {
      mini.style.display = 'none';
      mini.__lastIndex = undefined;
      mini.__lastClosest = undefined;
    }
    chartBox.__aoe4HoverActive = false;
    timeline.canvas.__aoe4HoverActive = false;
  } else if (isArmy && !chartBox.__aoe4HoverActive) {
    resetLegendSummary(chart);
  }
}

export function applyRangeLegend(chart: Chart, timeline: TimelineElements | null): void {
  const nodes = chart._legendNodes;
  if (!nodes?.size) return;
  const range = getActiveRange(timeline?.chartBox, chart);
  if (!range) {
    resetLegendSummary(chart);
    return;
  }

  const labels = chart.data.labels;
  const t0 = labels[range.startIdx];
  const t1 = labels[range.endIdx];
  if (t0 === undefined || t1 === undefined) {
    resetLegendSummary(chart);
    return;
  }

  const expandedPlayers = new Set<string>();
  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    if (meta.panelEl.style.display !== 'none') expandedPlayers.add(key.slice(11));
  }

  for (const item of chart.data.series) {
    if (!item.key) continue;
    const node = nodes.get(item.key);
    if (!node || !isUnitNode(item.key, node)) continue;
    if (item._hidden) {
      node.rowEl.style.display = 'none';
      continue;
    }
    if (!item.playerName || !expandedPlayers.has(item.playerName)) continue;
    const stats = rangeUnitStats(item, range.startIdx, range.endIdx, t0, t1);
    if (!stats.relevant) {
      node.rowEl.style.display = 'none';
      continue;
    }
    node.rowEl.style.display = '';
    node.rowEl.classList.remove('is-closest');
    const totalText = String(stats.initial);
    if (node.totalEl.textContent !== totalText) node.totalEl.textContent = totalText;
    setDeltaCells(node, stats.trained, stats.lost);
  }

  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    const parts: string[] = [];
    for (const unit of meta.units) {
      const stats = rangeUnitStats(unit, range.startIdx, range.endIdx, t0, t1);
      if (!stats.relevant) continue;
      const label = escapeHtml(unit.unitLabel || unit.label || '');
      parts.push(
        `<span class="aoe4-inline-summary-entry">` +
          `${label} ` +
          `<span class="aoe4-army-unit-delta-trained ${stats.trained === 0 ? 'is-zero' : ''}">${stats.trained}</span> ` +
          `<span class="aoe4-army-unit-delta-lost ${stats.lost === 0 ? 'is-zero' : ''}">${stats.lost}</span>` +
        `</span>`
      );
    }
    const html = parts.join(', ') || '—';
    if (meta.summaryLabelEl.innerHTML !== html) meta.summaryLabelEl.innerHTML = html;
  }
}
