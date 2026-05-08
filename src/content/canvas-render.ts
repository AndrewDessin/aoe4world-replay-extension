import { summaryScaleX, summaryScaleY, formatGameTime } from './canvas-geom.ts';
import {
  AGE_UP_DEFAULT_MARGIN,
  planAgeUpPlacement,
  ageUpMarginTopForRows,
  drawAgeUpIndicators,
} from './age-up.ts';
import {
  playerCacheKey,
  ensureChartRenderCache,
  getCollapsedPlayers,
  isHighlightForPlayer,
} from './canvas-cache.ts';
import {
  resolveUnitIconUrl,
  unitIconCacheKey,
  loadAreaIcon,
} from './unit-icons.ts';
import { drawCanvasTooltip } from './canvas-tooltip-draw.ts';
import type {
  CanvasExtensions,
  Chart,
  ChartBoxExtensions,
  ChartMargin,
  DragState,
  RangeState,
  StackedYCache,
} from './types.ts';

export function drawTimelineCanvasChart(canvas: HTMLCanvasElement & CanvasExtensions, chart: Chart, hoverIndex: number | null = null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(600, rect.width || canvas.clientWidth || 1000);
  const cssHeight = Math.max(320, rect.height || canvas.clientHeight || 500);
  const dpr = window.devicePixelRatio || 1;
  // Only resize backing store on actual size change to avoid clearing on every hover frame.
  const needW = Math.round(cssWidth * dpr);
  const needH = Math.round(cssHeight * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const labels = chart.data.labels;
  const series = chart.data.series;
  const geometry = chart._geometry || { yMin: 0, yMax: 1 };
  const yMin = geometry.yMin;
  const yMax = geometry.yMax;

  // Dynamic margin.top so AU labels don't clip in 4v4+ games.
  const baseMargin: ChartMargin = { top: AGE_UP_DEFAULT_MARGIN, right: 14, bottom: 32, left: 28 };
  const initialPlotW = cssWidth - baseMargin.left - baseMargin.right;
  const ageUpGameDuration = chart.ageUps?.length ? (labels[labels.length - 1] || 1) : 0;
  const ageUpPlacement = chart.ageUps?.length
    ? planAgeUpPlacement(ctx, chart.ageUps, ageUpGameDuration, baseMargin.left, baseMargin.right, cssWidth, initialPlotW)
    : { items: [], rowCount: 0 };
  const margin = { ...baseMargin, top: ageUpMarginTopForRows(ageUpPlacement.rowCount) };
  const plotW = Math.max(1, cssWidth - margin.left - margin.right);
  const plotH = Math.max(1, cssHeight - margin.top - margin.bottom);

  const renderedY = ensureChartRenderCache(chart, margin, plotH) as Map<string, Float32Array | StackedYCache>;

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.fillStyle = '#9ca3af';
  ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  for (let index = 0; index <= 3; index++) {
    const tick = yMin + ((yMax - yMin) * index / 3);
    const y = summaryScaleY(tick, yMin, yMax, margin, plotH);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(cssWidth - margin.right, y);
    ctx.stroke();
  }

  const xTickEvery = Math.max(1, Math.ceil(labels.length / 4));
  ctx.textBaseline = 'top';
  labels.forEach((seconds: number, index: number) => {
    if (index % xTickEvery !== 0 && index !== labels.length - 1) return;
    const x = summaryScaleX(index, labels.length, margin, plotW);
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, cssHeight - margin.bottom);
    ctx.stroke();
    ctx.fillText(formatGameTime(seconds), x - 14, cssHeight - 22);
  });

  if (yMin < 0) {
    const zeroY = summaryScaleY(0, yMin, yMax, margin, plotH);
    ctx.save();
    ctx.strokeStyle = chart.type === 'lead' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.32)';
    ctx.lineWidth = chart.type === 'lead' ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, zeroY);
    ctx.lineTo(cssWidth - margin.right, zeroY);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  if (chart.type === 'army') {
    const collapsedPlayers = getCollapsedPlayers(chart);
    const drawnCollapsedPlayers = new Set<string>();
    for (const item of series) {
      if (item._hidden || !item.playerName) continue;
      if (collapsedPlayers.has(item.playerName)) {
        if (drawnCollapsedPlayers.has(item.playerName)) continue;
        drawnCollapsedPlayers.add(item.playerName);
        const ys = renderedY.get(playerCacheKey(item.playerName)) as StackedYCache | undefined;
        if (!ys?.stackBase || !ys?.stackTop) continue;
        const highlighted = isHighlightForPlayer(chart, item.playerName);

        ctx.globalAlpha = highlighted ? 0.5 : 0.08;
        ctx.fillStyle = item.baseColor || item.color;
        ctx.beginPath();
        for (let i = 0; i < ys.stackTop.length; i++) {
          const x = summaryScaleX(i, ys.stackTop.length, margin, plotW);
          const y = ys.stackTop[i];
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = ys.stackBase.length - 1; i >= 0; i--) {
          const x = summaryScaleX(i, ys.stackBase.length, margin, plotW);
          ctx.lineTo(x, ys.stackBase[i]);
        }
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = highlighted ? 0.9 : 0.15;
        ctx.strokeStyle = item.baseColor || item.color;
        ctx.lineWidth = highlighted ? 1.5 : 0.75;
        ctx.beginPath();
        for (let i = 0; i < ys.stackTop.length; i++) {
          const x = summaryScaleX(i, ys.stackTop.length, margin, plotW);
          const y = ys.stackTop[i];
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        continue;
      }
      if (!item.key) continue;
      const ys = renderedY.get(item.key) as StackedYCache | undefined;
      if (!ys?.stackBase || !ys?.stackTop) continue;
      const highlighted = !chart.highlightKey || chart.highlightKey === item.key;

      ctx.globalAlpha = highlighted ? 0.5 : 0.08;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      for (let i = 0; i < ys.stackTop.length; i++) {
        const x = summaryScaleX(i, ys.stackTop.length, margin, plotW);
        const y = ys.stackTop[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = ys.stackBase.length - 1; i >= 0; i--) {
        const x = summaryScaleX(i, ys.stackBase.length, margin, plotW);
        ctx.lineTo(x, ys.stackBase[i]);
      }
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = highlighted ? 0.9 : 0.15;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = highlighted ? 1.5 : 0.75;
      ctx.beginPath();
      for (let i = 0; i < ys.stackTop.length; i++) {
        const x = summaryScaleX(i, ys.stackTop.length, margin, plotW);
        const y = ys.stackTop[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (chart.type === 'lead') {
    const zeroY = summaryScaleY(0, yMin, yMax, margin, plotH);
    for (const item of series) {
      if (item._hidden || !item.values.length) continue;
      if (!item.key) continue;
      const highlighted = !chart.highlightKey || chart.highlightKey === item.key;
      const ys = renderedY.get(item.key) as Float32Array | undefined;
      if (!ys) continue;

      ctx.fillStyle = item.color;
      ctx.globalAlpha = highlighted ? 0.5 : 0.08;
      ctx.beginPath();
      for (let i = 0; i < item.values.length; i++) {
        const x = summaryScaleX(i, item.values.length, margin, plotW);
        const y = ys[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const lastX = summaryScaleX(item.values.length - 1, item.values.length, margin, plotW);
      const firstX = summaryScaleX(0, item.values.length, margin, plotW);
      ctx.lineTo(lastX, zeroY);
      ctx.lineTo(firstX, zeroY);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = highlighted ? 0.9 : 0.15;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = highlighted ? 1.5 : 0.75;
      ctx.beginPath();
      for (let i = 0; i < item.values.length; i++) {
        const x = summaryScaleX(i, item.values.length, margin, plotW);
        const y = ys[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    for (const item of series) {
      if (item._hidden) continue;
      if (!item.key) continue;
      ctx.strokeStyle = item.color;
      const highlighted = !chart.highlightKey || chart.highlightKey === item.key;
      ctx.globalAlpha = highlighted ? 1 : 0.18;
      ctx.lineWidth = highlighted ? 2.25 : 1.25;
      ctx.beginPath();
      const values = item.values;
      const ys = renderedY.get(item.key) as Float32Array | undefined;
      if (!ys) continue;
      let pathOpen = false;
      for (let i = 0; i < values.length; i++) {
        const x = summaryScaleX(i, values.length, margin, plotW);
        const y = ys[i];
        if (!pathOpen) { ctx.moveTo(x, y); pathOpen = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // --- Unit icons inside stacked areas ---
  if (chart.type === 'army') {
    const collapsedPlayers = getCollapsedPlayers(chart);
    const maxIconSize = 28;
    const minAreaPx = 36;
    for (const item of series) {
      if (item._hidden || !item.playerName || !item.key) continue;
      if (collapsedPlayers.has(item.playerName)) continue;
      if (!item._stackBase || !item._stackTop) continue;

      const ys = renderedY.get(item.key) as StackedYCache | undefined;
      if (!ys?.stackBase || !ys?.stackTop) continue;

      if (!item._areaIcon) {
        const iconUrl = resolveUnitIconUrl(item, unitIconCacheKey(item));
        if (!iconUrl) { item._areaIcon = { url: '', entry: null }; continue; }
        item._areaIcon = { url: iconUrl, entry: loadAreaIcon(iconUrl) };
      }
      const areaIcon = item._areaIcon;
      if (!areaIcon?.url || !areaIcon.entry?.loaded) continue;
      const areaIconEntry = areaIcon.entry;

      // Find contiguous non-zero segments tall+wide enough for an icon.
      let segStart = -1;
      let segBestIdx = -1;
      let segBestH = 0;
      let inSegment = false;
      const placeIcon = (segEnd: number): void => {
        if (segBestIdx < 0 || segBestH < minAreaPx) return;
        const iconSize = Math.min(maxIconSize, Math.floor(segBestH * 0.6));
        const xStart = summaryScaleX(segStart, ys.stackTop.length, margin, plotW);
        const xEnd = summaryScaleX(segEnd - 1, ys.stackTop.length, margin, plotW);
        const segPixelWidth = xEnd - xStart;
        if (segPixelWidth < iconSize * 1.5) return;
        const halfIcon = Math.ceil(iconSize / 2);
        const x = summaryScaleX(segBestIdx, ys.stackTop.length, margin, plotW);
        const clampedX = Math.max(xStart + halfIcon, Math.min(xEnd - halfIcon, x));
        const yTop = Math.min(ys.stackTop[segBestIdx], ys.stackBase[segBestIdx]);
        const yBot = Math.max(ys.stackTop[segBestIdx], ys.stackBase[segBestIdx]);
        const centerY = Math.max(yTop + halfIcon, Math.min(yBot - halfIcon, (yTop + yBot) / 2));
        ctx.globalAlpha = 0.85;
        ctx.drawImage(areaIconEntry.img, clampedX - halfIcon, centerY - halfIcon, iconSize, iconSize);
      };
      for (let i = 0; i < ys.stackTop.length; i++) {
        const h = Math.abs(ys.stackBase[i] - ys.stackTop[i]);
        if (h > 1) {
          if (!inSegment) { inSegment = true; segStart = i; segBestIdx = i; segBestH = h; }
          else if (h > segBestH) { segBestIdx = i; segBestH = h; }
        } else {
          if (inSegment) { placeIcon(i); inSegment = false; segBestIdx = -1; segBestH = 0; }
        }
      }
      if (inSegment) placeIcon(ys.stackTop.length);
    }

    // Upgrade dots — collapsed players use COMBINED stackTop.
    for (const item of series) {
      if (item._hidden || !item.upgrades?.length || !item.playerName) continue;
      const ysKey = collapsedPlayers.has(item.playerName)
        ? playerCacheKey(item.playerName)
        : item.key;
      if (!ysKey) continue;
      const ys = renderedY.get(ysKey) as StackedYCache | undefined;
      if (!ys?.stackTop) continue;
      const maxTimeSec = labels[labels.length - 1] || 1;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5;
      for (const upg of item.upgrades) {
        const fracIdx = (upg.time / maxTimeSec) * (ys.stackTop.length - 1);
        const i = Math.round(fracIdx);
        if (i < 0 || i >= ys.stackTop.length) continue;
        const x = summaryScaleX(i, ys.stackTop.length, margin, plotW);
        const y = ys.stackTop[i];
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (chart.ageUps?.length) {
    drawAgeUpIndicators(ctx, chart.ageUps, {
      margin, plotW, plotH, cssWidth, gameDuration: ageUpGameDuration,
      placement: ageUpPlacement,
    });
  }

  if (chart.type === 'army') {
    const chartBox = canvas.parentElement as (HTMLElement & ChartBoxExtensions) | null;
    const drag = chartBox?.__aoe4ActiveDrag as DragState | null | undefined;
    const range = chartBox?.__aoe4ActiveRange as RangeState | null | undefined;
    let from: number | null = null;
    let to: number | null = null;
    if (drag && drag.chartValue === chart.value) {
      from = Math.min(drag.anchorIdx, drag.currentIdx);
      to = Math.max(drag.anchorIdx, drag.currentIdx);
    } else if (range && range.chartValue === chart.value) {
      from = range.startIdx;
      to = range.endIdx;
    }
    if (from !== null && to !== null && labels.length > 1) {
      const xFrom = summaryScaleX(from, labels.length, margin, plotW);
      const xTo = summaryScaleX(to, labels.length, margin, plotW);
      const left = Math.min(xFrom, xTo);
      const right = Math.max(xFrom, xTo);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(left, margin.top, Math.max(1, right - left), plotH);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left + 0.5, margin.top);
      ctx.lineTo(left + 0.5, margin.top + plotH);
      ctx.moveTo(right - 0.5, margin.top);
      ctx.lineTo(right - 0.5, margin.top + plotH);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (hoverIndex !== null && labels[hoverIndex] !== undefined) {
    drawCanvasTooltip(ctx, chart, hoverIndex, margin, plotW, plotH, yMin, yMax, cssWidth);
  }
}
