import type { ChartSeries } from './types.ts';

export const RESOURCE_KEYS = ['food', 'wood', 'gold', 'stone', 'oliveoil', 'silver'];
export const RESOURCE_LABELS = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone', oliveoil: 'Olive Oil', silver: 'Silver' };
export const RESOURCE_SAMPLE_SECONDS = 20;
export const SUMMARY_PLUS_PREFIX = 'aoe4plus:';

export function numericArray(values: unknown): number[] {
  return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
}

export function maxAbs(values: readonly number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value || 0)), 0);
}

export function buildSampleLabels(duration: number, step: number): number[] {
  const end = Math.max(0, Math.ceil(duration / step) * step);
  const labels: number[] = [];
  for (let second = 0; second <= end; second += step) labels.push(second);
  return labels;
}

export function activeCountValues(labels: readonly number[], finished: readonly number[], destroyed: readonly number[]): number[] {
  const created = [...finished].sort((a, b) => a - b);
  const lost = [...destroyed].sort((a, b) => a - b);
  let createdIndex = 0;
  let lostIndex = 0;
  return labels.map(time => {
    while (createdIndex < created.length && created[createdIndex] <= time) createdIndex++;
    while (lostIndex < lost.length && lost[lostIndex] <= time) lostIndex++;
    return Math.max(0, createdIndex - lostIndex);
  });
}

export function collapseChartSeries(series: ChartSeries[], limit: number): ChartSeries[] {
  if (series.length <= limit) return series.sort((a, b) => maxAbs(b.values) - maxAbs(a.values));
  const sorted = [...series].sort((a, b) => maxAbs(b.values) - maxAbs(a.values));
  const keep = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  const otherFinished: number[] = [];
  const otherDestroyed: number[] = [];
  for (const item of rest) {
    if (item._finishedTimes) otherFinished.push(...item._finishedTimes);
    if (item._destroyedTimes) otherDestroyed.push(...item._destroyedTimes);
  }
  otherFinished.sort((a, b) => a - b);
  otherDestroyed.sort((a, b) => a - b);
  keep.push({
    label: 'Other',
    unitLabel: 'Other',
    color: '#94a3b8',
    iconCandidates: [],
    createdTotal: rest.reduce((sum, item) => sum + (item.createdTotal || 0), 0),
    values: sorted[0].values.map((_, index) => rest.reduce((sum, item) => sum + (item.values[index] || 0), 0)),
    _finishedTimes: otherFinished,
    _destroyedTimes: otherDestroyed
  });
  return keep;
}
