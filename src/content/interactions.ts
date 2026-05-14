import { normalizeName } from './dom.ts';
import { niceGeometryForChart } from './canvas-geom.ts';
import { precomputeStackedValues } from './army-series.ts';
import { drawTimelineCanvasChart } from './canvas-render.ts';
import { nativePlayerRowText } from './native-timeline.ts';
import { playerCacheKey } from './canvas-cache.ts';
import type {
  Chart,
  PlayerSummary,
  PlayerToggleHandler,
  TimelineElements,
  TooltipCacheRow,
} from './types.ts';

export function attachTimelineHoverGuard(timeline: TimelineElements, chart: Chart): void {
  detachTimelineHoverGuard(timeline);
  let guardFrame = 0;
  const redraw = (): void => {
    guardFrame = 0;
    if (timeline.root.__aoe4SummaryActiveChart !== chart) return;
    const activeValue = timeline.select.__aoe4SummaryActiveValue;
    if (!activeValue || !activeValue.startsWith('aoe4plus:')) return;
    timeline.heading.textContent = chart.title;
    // If a chart animation is in progress, let it finish — calling
    // drawTimelineCanvasChart() here without preserveAnimation:true would
    // invoke cancelTimelineCanvasAnimation() and kill the RAF loop.
    if (timeline.canvas.__aoe4AnimationToken) return;
    drawTimelineCanvasChart(timeline.canvas, chart);
  };
  const guardHover = (event: Event): void => {
    const target = event.target as Element | null;
    if (target === timeline.canvas) return;
    if (timeline.chartBox?.__aoe4HoverActive || timeline.canvas?.__aoe4HoverActive) return;
    if (target?.closest?.('.aoe4-army-unit-legend, .aoe4-inline-legend-summary, .aoe4-inline-legend-chevron, .aoe4-legend-breakdown')) return;
    if (target?.closest?.('[data-aoe4-legend-injected]')) return;
    if (!guardFrame) guardFrame = requestAnimationFrame(redraw);
  };
  for (const type of ['mouseover', 'mouseout']) {
    timeline.root.addEventListener(type, guardHover, true);
  }
  timeline.root.__aoe4SummaryActiveChart = chart;
  timeline.root.__aoe4SummaryHoverGuard = { guardHover };
}

export function detachTimelineHoverGuard(timeline: TimelineElements): void {
  const guard = timeline.root.__aoe4SummaryHoverGuard;
  if (!guard) return;
  for (const type of ['mouseover', 'mouseout']) {
    timeline.root.removeEventListener(type, guard.guardHover, true);
  }
  delete timeline.root.__aoe4SummaryActiveChart;
  delete timeline.root.__aoe4SummaryHoverGuard;
}

export function attachPlayerToggle(timeline: TimelineElements, chart: Chart): void {
  detachPlayerToggle(timeline);
  const summary = timeline.__aoe4Summary;
  const players: PlayerSummary[] = Array.isArray(summary?.players) ? summary.players : [];
  const rows = [...timeline.root.querySelectorAll<HTMLElement>('.flex.items-center.cursor-pointer')];
  const handlers: PlayerToggleHandler[] = [];
  for (const row of rows) {
    const text = normalizeName(nativePlayerRowText(row));
    const player = players.find((p: PlayerSummary) => {
      const n = normalizeName(p.name);
      return n && text.includes(n);
    });
    if (!player?.name) continue;
    const playerName = player.name;
    const iconWrapper = row.firstElementChild;
    const nameEl = row.querySelector<HTMLElement>('.font-bold, [class*="font-bold"]');
    const onClick = (e: MouseEvent): void => {
      const target = e.target as (Element & Node) | null;
      if (target?.closest?.('.aoe4-inline-legend-summary, .aoe4-inline-legend-chevron, .aoe4-legend-breakdown')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const onIcon = !!(iconWrapper && target && iconWrapper.contains(target));
      const onName = !!(nameEl && target && nameEl.contains(target));
      if (!onIcon && !onName) return;
      const seriesForPlayer = chart.data.series.filter(s =>
        s.playerName === playerName || s.label === playerName
      );
      const anyVisible = seriesForPlayer.some(s => !s._hidden);
      for (const s of seriesForPlayer) s._hidden = anyVisible;
      row.style.opacity = anyVisible ? '0.35' : '';
      const wasOpen = row.dataset.aoe4LegendOpen === '1';
      const inlineSummary = row.querySelector<HTMLElement>('.aoe4-inline-legend-summary');
      const chevronEl = row.querySelector<HTMLElement>('.aoe4-inline-legend-chevron');
      const panel = [...(row.parentElement?.querySelectorAll<HTMLElement>('.aoe4-legend-breakdown') || [])]
        .find(node => node.dataset.playerName === playerName);
      if (inlineSummary) inlineSummary.style.display = anyVisible ? 'none' : (wasOpen ? 'none' : '');
      if (chevronEl) chevronEl.style.display = anyVisible ? 'none' : '';
      if (panel) panel.style.display = anyVisible ? 'none' : (wasOpen ? '' : 'none');
      delete chart._cachedPlotH;
      delete chart._cachedMarginTop;
      delete chart._cachedYMin;
      delete chart._cachedYMax;
      delete chart._renderedY;
      recomputeVisibleGeometry(chart);
      drawTimelineCanvasChart(timeline.canvas, chart);
    };
    row.addEventListener('click', onClick, true);
    const highlightKeyForPlayer = chart.type === 'army'
      ? playerCacheKey(playerName)
      : chart.data.series.find(s => s.playerName === playerName || s.label === playerName)?.key || null;
    if (highlightKeyForPlayer) {
      const onEnter = (): void => {
        chart.highlightKey = highlightKeyForPlayer;
        drawTimelineCanvasChart(timeline.canvas, chart);
      };
      const onLeave = (): void => {
        if (chart.highlightKey === highlightKeyForPlayer) {
          chart.highlightKey = null;
          drawTimelineCanvasChart(timeline.canvas, chart);
        }
      };
      row.addEventListener('mouseenter', onEnter);
      row.addEventListener('mouseleave', onLeave);
      handlers.push({ row, onClick, onEnter, onLeave });
    } else {
      handlers.push({ row, onClick });
    }
  }
  timeline.__aoe4PlayerToggleHandlers = handlers;
}

export function detachPlayerToggle(timeline: TimelineElements): void {
  const handlers = timeline.__aoe4PlayerToggleHandlers;
  if (!handlers) return;
  for (const h of handlers) {
    h.row.removeEventListener('click', h.onClick, true);
    if (h.onEnter) h.row.removeEventListener('mouseenter', h.onEnter);
    if (h.onLeave) h.row.removeEventListener('mouseleave', h.onLeave);
    h.row.style.opacity = '';
  }
  delete timeline.__aoe4PlayerToggleHandlers;
}

export function recomputeVisibleGeometry(chart: Chart): void {
  if (chart.type === 'army') precomputeStackedValues(chart.data.series);
  let yMin = 0;
  let yMax = 1;
  for (const series of chart.data.series) {
    if (series._hidden) continue;
    const vals = (chart.type === 'army' && series._stackTop) ? series._stackTop : series.values;
    for (const value of vals) {
      if (value < yMin) yMin = value;
      if (value > yMax) yMax = value;
    }
  }
  chart._geometry = niceGeometryForChart(chart.type, yMin, yMax);

  const allSeries = chart.data.series;
  const numSamples = chart.data.labels.length;
  const tooltipRows: TooltipCacheRow[][] = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const rows: TooltipCacheRow[] = [];
    for (let s = 0; s < allSeries.length; s++) {
      const item = allSeries[s];
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
      const maxValue = rows.reduce((max, row) => Math.max(max, row.value), -Infinity);
      for (const row of rows) row.delta = row.value - maxValue;
    }
    rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    tooltipRows[i] = rows;
  }
  chart._tooltipRows = tooltipRows;
}
