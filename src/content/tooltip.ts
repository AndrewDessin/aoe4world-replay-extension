import { drawTimelineCanvasChart } from './canvas-render.ts';
import {
  getCollapsedPlayers,
  playerCacheKey,
  playerValueSumAt,
} from './canvas-cache.ts';
import {
  updateLegendLive,
  resetLegendSummary,
} from './legend-live.ts';
import {
  RANGE_DRAG_THRESHOLD_PX,
  clientXToSampleIndex,
  getActiveRange,
  getActiveDrag,
  syncRangeUi,
  applyRangeLegend,
} from './range.ts';
import { updateCanvasTooltip, updateArmyMiniTooltip } from './tooltip-content.ts';
import type {
  CanvasExtensions,
  Chart,
  ClosestSeriesKey,
  StackedYCache,
  TimelineElements,
  TooltipElement,
} from './types.ts';

type TooltipCanvas = HTMLCanvasElement & CanvasExtensions;

const drawChart = drawTimelineCanvasChart as unknown as (
  canvas: TooltipCanvas,
  chart: Chart,
  hoverIndex?: number | null,
) => void;

function isStackedYCache(value: Float32Array | StackedYCache | undefined): value is StackedYCache {
  return Boolean(value) && !(value instanceof Float32Array);
}

export function attachCanvasTooltip(canvas: TooltipCanvas, chart: Chart, timeline: TimelineElements | null): void {
  detachCanvasTooltip(canvas);
  const useFloatingTooltip = chart.type !== 'army';
  const tooltip = useFloatingTooltip ? ensureCanvasTooltip(canvas) : null;
  const armyMiniTooltip = (chart.type === 'army') ? ensureCanvasTooltip(canvas) : null;

  let pendingFrame = 0;
  let pendingEvent: MouseEvent | null = null;
  const flushMove = (): void => {
    pendingFrame = 0;
    const event = pendingEvent;
    pendingEvent = null;
    if (!event) return;
    const rect = canvas.getBoundingClientRect();
    const margin = { top: 18, right: 14, bottom: 32, left: 28 };
    const plotW = Math.max(1, rect.width - margin.left - margin.right);
    const raw = ((event.clientX - rect.left - margin.left) / plotW) * (chart.data.labels.length - 1);
    const index = Math.max(0, Math.min(chart.data.labels.length - 1, Math.round(raw)));

    const closestKey = computeClosestSeriesKey(canvas, chart, index, event);
    drawChart(canvas, chart, index);

    if (useFloatingTooltip && tooltip) {
      updateCanvasTooltip(tooltip, canvas, chart, index, event, closestKey);
    } else {
      updateLegendLive(chart, index, closestKey);
      if (armyMiniTooltip) {
        updateArmyMiniTooltip(armyMiniTooltip, canvas, chart, index, event, closestKey);
      }
    }
  };
  const onMove = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (chart.type === 'army' && getActiveRange(timeline?.chartBox, chart)
        && !getActiveDrag(timeline?.chartBox, chart)) {
      return;
    }
    canvas.__aoe4HoverActive = true;
    if (timeline?.chartBox) timeline.chartBox.__aoe4HoverActive = true;
    pendingEvent = event;
    if (!pendingFrame) pendingFrame = requestAnimationFrame(flushMove);
  };
  const onLeave = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.__aoe4HoverActive = false;
    if (timeline?.chartBox) timeline.chartBox.__aoe4HoverActive = false;
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      pendingEvent = null;
    }
    if (useFloatingTooltip && tooltip) {
      tooltip.style.display = 'none';
      tooltip.__lastIndex = undefined;
      tooltip.__lastClosest = undefined;
    } else {
      if (armyMiniTooltip) {
        armyMiniTooltip.style.display = 'none';
        armyMiniTooltip.__lastIndex = undefined;
        armyMiniTooltip.__lastClosest = undefined;
      }
      if (chart.type === 'army' && getActiveDrag(timeline?.chartBox, chart)) {
        // mid-drag: leave legend alone until mouseup commits
      } else if (chart.type === 'army' && getActiveRange(timeline?.chartBox, chart)) {
        applyRangeLegend(chart, timeline);
      } else {
        resetLegendSummary(chart);
      }
    }
    drawChart(canvas, chart);
  };
  const suppress = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  canvas.addEventListener('mousemove', onMove, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('mouseleave', onLeave, true);
  canvas.addEventListener('pointerleave', onLeave, true);
  for (const type of ['mouseover', 'mouseout', 'pointerover', 'pointerout', 'click'] as const) {
    canvas.addEventListener(type, suppress, true);
  }

  let onMouseDown: ((event: MouseEvent) => void) | null = null;
  if (chart.type === 'army') {
    onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const chartBox = timeline?.chartBox;
      if (!chartBox) return;
      if (chartBox.__aoe4DragAbort) chartBox.__aoe4DragAbort.abort();
      const ctrl = new AbortController();
      chartBox.__aoe4DragAbort = ctrl;
      const anchorIdx = clientXToSampleIndex(canvas, chart, event.clientX);
      const anchorClientX = event.clientX;
      chartBox.__aoe4ActiveDrag = { chartValue: chart.value, anchorIdx, currentIdx: anchorIdx };

      let dragMoved = false;
      const onWindowMove = (e: MouseEvent): void => {
        if (Math.abs(e.clientX - anchorClientX) >= RANGE_DRAG_THRESHOLD_PX) dragMoved = true;
        const idx = clientXToSampleIndex(canvas, chart, e.clientX);
        const drag = chartBox.__aoe4ActiveDrag;
        if (!drag || drag.chartValue !== chart.value) return;
        if (drag.currentIdx === idx) return;
        drag.currentIdx = idx;
        drawChart(canvas, chart);
      };
      const onWindowUp = (e: MouseEvent): void => {
        ctrl.abort();
        chartBox.__aoe4DragAbort = null;
        const drag = chartBox.__aoe4ActiveDrag;
        chartBox.__aoe4ActiveDrag = null;
        if (!drag || drag.chartValue !== chart.value) return;
        const finalIdx = clientXToSampleIndex(canvas, chart, e.clientX);
        const minIdx = Math.min(drag.anchorIdx, finalIdx);
        const maxIdx = Math.max(drag.anchorIdx, finalIdx);
        if (dragMoved && minIdx !== maxIdx) {
          chartBox.__aoe4ActiveRange = { chartValue: chart.value, startIdx: minIdx, endIdx: maxIdx };
        } else {
          chartBox.__aoe4ActiveRange = null;
        }
        syncRangeUi(timeline, chart);
        drawChart(canvas, chart);
      };
      window.addEventListener('mousemove', onWindowMove, { capture: true, signal: ctrl.signal });
      window.addEventListener('mouseup', onWindowUp, { capture: true, signal: ctrl.signal });
      window.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        ctrl.abort();
        chartBox.__aoe4DragAbort = null;
        chartBox.__aoe4ActiveDrag = null;
        drawChart(canvas, chart);
      }, { signal: ctrl.signal });
    };
    canvas.addEventListener('mousedown', onMouseDown, true);
  }

  canvas.__aoe4SummaryHandlers = { onMove, onLeave, onMouseDown, tooltip, armyMiniTooltip };
  canvas.__aoe4SummarySuppress = suppress;
}

export function detachCanvasTooltip(canvas: TooltipCanvas): void {
  const handlers = canvas.__aoe4SummaryHandlers;
  if (!handlers) return;
  canvas.removeEventListener('mousemove', handlers.onMove, true);
  canvas.removeEventListener('pointermove', handlers.onMove, true);
  canvas.removeEventListener('mouseleave', handlers.onLeave, true);
  canvas.removeEventListener('pointerleave', handlers.onLeave, true);
  if (handlers.onMouseDown) canvas.removeEventListener('mousedown', handlers.onMouseDown, true);
  const suppress = canvas.__aoe4SummarySuppress;
  for (const type of ['mouseover', 'mouseout', 'pointerover', 'pointerout', 'click'] as const) {
    if (suppress) canvas.removeEventListener(type, suppress, true);
  }
  handlers.tooltip?.remove();
  handlers.armyMiniTooltip?.remove();
  delete canvas.__aoe4SummaryHandlers;
  delete canvas.__aoe4SummarySuppress;
}

export function ensureCanvasTooltip(canvas: HTMLCanvasElement): TooltipElement {
  const parent = canvas.parentElement || canvas;
  if (parent.style.position === '') parent.style.position = 'relative';
  const tooltip = document.createElement('div') as TooltipElement;
  tooltip.className = 'aoe4-summary-html-tooltip';
  tooltip.style.display = 'none';
  parent.appendChild(tooltip);
  return tooltip;
}

export function computeClosestSeriesKey(
  canvas: HTMLCanvasElement,
  chart: Chart,
  index: number,
  event: MouseEvent,
): ClosestSeriesKey {
  const renderedY = chart._renderedY;
  if (!renderedY) return null;
  const rect = canvas.getBoundingClientRect();
  const cursorY = event.clientY - rect.top;

  let collapsedPlayers: Set<string> | null = null;
  if (chart.type === 'army') {
    collapsedPlayers = getCollapsedPlayers(chart);
  }

  let closestKey: ClosestSeriesKey = null;
  let closestDist = Infinity;
  const seenCollapsed = new Set<string>();
  for (const item of chart.data.series) {
    if (item._hidden) continue;

    if (chart.type === 'army' && item.playerName && collapsedPlayers?.has(item.playerName)) {
      if (seenCollapsed.has(item.playerName)) continue;
      seenCollapsed.add(item.playerName);
      if (playerValueSumAt(chart, item.playerName, index) === 0) continue;
      const ys = renderedY.get(playerCacheKey(item.playerName));
      if (!isStackedYCache(ys)) continue;
      const top = ys.stackTop[index];
      const base = ys.stackBase[index];
      if (top === undefined || base === undefined) continue;
      const yLo = Math.min(top, base);
      const yHi = Math.max(top, base);
      if (cursorY >= yLo && cursorY <= yHi) {
        return playerCacheKey(item.playerName);
      }
      continue;
    }

    if (!item.key) continue;
    if (chart.type === 'army' && (item.values[index] || 0) === 0) continue;
    const ys = renderedY.get(item.key);
    if (!ys) continue;
    if (chart.type === 'army' && isStackedYCache(ys)) {
      const top = ys.stackTop[index];
      const base = ys.stackBase[index];
      if (top === undefined || base === undefined) continue;
      const yLo = Math.min(top, base);
      const yHi = Math.max(top, base);
      if (cursorY >= yLo && cursorY <= yHi) {
        return item.key;
      }
      const dist = Math.min(Math.abs(top - cursorY), Math.abs(base - cursorY));
      if (dist < closestDist) { closestDist = dist; closestKey = item.key; }
    } else if (ys instanceof Float32Array) {
      const y = ys[index];
      if (y === undefined) continue;
      const dist = Math.abs(y - cursorY);
      if (dist < closestDist) { closestDist = dist; closestKey = item.key; }
    }
  }
  return closestKey;
}
