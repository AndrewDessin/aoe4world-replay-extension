import type { ChartGeometry, ChartMargin } from './types.ts';

export function niceCeilForChart(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const step = Math.pow(10, exp - 1) / 2;
  return Math.ceil(v * 1.04 / step) * step;
}

export function niceFloorForChart(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v >= 0) return v;
  return -niceCeilForChart(-v);
}

// Lead chart needs symmetric domain so toggling a player doesn't shift every gridline.
export function niceGeometryForChart(chartType: string, rawYMin: number, rawYMax: number): ChartGeometry {
  if (chartType === 'lead') {
    const maxAbs = Math.max(Math.abs(rawYMin), Math.abs(rawYMax)) || 1;
    const niceAbs = niceCeilForChart(maxAbs);
    return { yMin: -niceAbs, yMax: niceAbs };
  }
  return {
    yMin: niceFloorForChart(rawYMin),
    yMax: niceCeilForChart(rawYMax),
  };
}

export function summaryScaleX(index: number, count: number, margin: ChartMargin, plotW: number): number {
  return margin.left + (count <= 1 ? 0 : (index / (count - 1)) * plotW);
}

export function summaryScaleY(value: number, yMin: number, yMax: number, margin: ChartMargin, plotH: number): number {
  const span = yMax - yMin || 1;
  return margin.top + (1 - ((value || 0) - yMin) / span) * plotH;
}

export function formatGameTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function titleCase(value: unknown): string {
  return String(value).replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
