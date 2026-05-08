import { summaryScaleX } from './canvas-geom.ts';
import type { Chart, ChartMargin } from './types.ts';

export function drawCanvasTooltip(
  ctx: CanvasRenderingContext2D,
  chart: Chart,
  index: number,
  margin: ChartMargin,
  plotW: number,
  plotH: number,
  yMin: number,
  yMax: number,
  cssWidth: number,
): void {
  const x = summaryScaleX(index, chart.data.labels.length, margin, plotW);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, margin.top);
  ctx.lineTo(x, margin.top + plotH);
  ctx.stroke();
  ctx.restore();
}
