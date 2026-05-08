import type { Chart, ChartMargin, LegendNodeMeta, LegendSummaryNode, StackedYCache } from './types.ts';

export const PLAYER_CACHE_PREFIX = '__player__:';
export function playerCacheKey(playerName: string): string { return PLAYER_CACHE_PREFIX + playerName; }

function isLegendSummaryNode(meta: LegendNodeMeta): meta is LegendSummaryNode {
  return 'panelEl' in meta;
}

// Without this cache, summaryScaleY runs per point per frame — cursor lag is real on army charts.
export function ensureChartRenderCache(chart: Chart, margin: ChartMargin, plotH: number): Map<string, Float32Array | StackedYCache> {
  const { yMin, yMax } = chart._geometry || { yMin: 0, yMax: 1 };
  if (
    chart._cachedPlotH === plotH &&
    chart._cachedMarginTop === margin.top &&
    chart._cachedYMin === yMin &&
    chart._cachedYMax === yMax &&
    chart._renderedY
  ) return chart._renderedY;
  const span = (yMax - yMin) || 1;
  const renderedY = new Map<string, Float32Array | StackedYCache>();
  for (const series of chart.data.series) {
    if (chart.type === 'army' && series._stackBase && series._stackTop) {
      const stackBase = new Float32Array(series._stackBase.length);
      const stackTop = new Float32Array(series._stackTop.length);
      for (let i = 0; i < series._stackTop.length; i++) {
        const base = series._stackBase[i] || 0;
        const top = series._stackTop[i] || 0;
        stackBase[i] = margin.top + (1 - (base - yMin) / span) * plotH;
        stackTop[i] = margin.top + (1 - (top - yMin) / span) * plotH;
      }
      renderedY.set(series.key as string, { stackBase, stackTop });
      continue;
    }
    const ys = new Float32Array(series.values.length);
    for (let i = 0; i < series.values.length; i++) {
      const v = series.values[i] || 0;
      ys[i] = margin.top + (1 - (v - yMin) / span) * plotH;
    }
    renderedY.set(series.key as string, ys);
  }
  if (chart.type === 'army') {
    const seen = new Set<string>();
    for (const series of chart.data.series) {
      if (!series.playerName || seen.has(series.playerName)) continue;
      if (!series._playerBase || !series._playerTop) continue;
      seen.add(series.playerName);
      const len = series._playerTop.length;
      const stackBase = new Float32Array(len);
      const stackTop = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        stackBase[i] = margin.top + (1 - (series._playerBase[i] - yMin) / span) * plotH;
        stackTop[i] = margin.top + (1 - (series._playerTop[i] - yMin) / span) * plotH;
      }
      renderedY.set(playerCacheKey(series.playerName), { stackBase, stackTop });
    }
  }
  chart._cachedPlotH = plotH;
  chart._cachedMarginTop = margin.top;
  chart._cachedYMin = yMin;
  chart._cachedYMax = yMax;
  chart._renderedY = renderedY;
  return renderedY;
}

export function getCollapsedPlayers(chart: Chart): Set<string> {
  const collapsed = new Set<string>();
  const nodes = chart._legendNodes;
  if (!nodes) return collapsed;
  const unitsByPlayer = new Map<string, typeof chart.data.series>();
  for (const s of chart.data.series) {
    if (!s.playerName) continue;
    const units = unitsByPlayer.get(s.playerName);
    if (units) units.push(s);
    else unitsByPlayer.set(s.playerName, [s]);
  }
  for (const [key, meta] of nodes) {
    if (!key.startsWith('__summary__')) continue;
    const playerName = key.slice(11);
    const units = unitsByPlayer.get(playerName) || [];
    if (!units.length) continue;
    if (units.some(u => u._hidden)) continue;
    if (!isLegendSummaryNode(meta) || !meta.panelEl || meta.panelEl.style.display === 'none') {
      collapsed.add(playerName);
    }
  }
  return collapsed;
}

export function isHighlightForPlayer(chart: Chart, playerName: string): boolean {
  const hk = chart.highlightKey;
  if (!hk) return true;
  if (hk === playerCacheKey(playerName)) return true;
  for (const s of chart.data.series) {
    if (s.key === hk) return s.playerName === playerName;
  }
  return false;
}

export function playerValueSumAt(chart: Chart, playerName: string, index: number): number {
  let sum = 0;
  for (const s of chart.data.series) {
    if (s.playerName !== playerName || s._hidden) continue;
    sum += Math.abs(s.values[index] || 0);
  }
  return sum;
}
