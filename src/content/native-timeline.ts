import { normalizeName } from './dom.ts';
import { extractAgeUps, drawAgeUpOverlay } from './age-up.ts';
import {
  removeArmyUnitLegend,
} from './legend.ts';
import { detachCanvasTooltip } from './tooltip.ts';
import {
  detachTimelineHoverGuard,
  detachPlayerToggle,
} from './interactions.ts';
import type { CanvasExtensions, GameSummary, TimelineElements } from './types.ts';

export function nativeTimelinePlayerColors(timeline: TimelineElements): Map<string, string> {
  const rows = [...timeline.root.querySelectorAll<HTMLElement>('.flex.items-center.cursor-pointer')];
  const colors = new Map<string, string>();
  for (const row of rows) {
    const name = nativePlayerRowText(row);
    const swatch = row.querySelector('div[style*="color"]') || row.firstElementChild;
    const color = swatch ? getComputedStyle(swatch).color : '';
    if (name && color) colors.set(name.toLowerCase(), color);
  }
  return colors;
}

export function nativeTimelinePlayerOrder(timeline: TimelineElements, summary: GameSummary): string[] {
  const players = Array.isArray(summary.players) ? summary.players : [];
  const rows = [...timeline.root.querySelectorAll<HTMLElement>('.flex.items-center.cursor-pointer')];
  const order: string[] = [];
  for (const row of rows) {
    const text = normalizeName(nativePlayerRowText(row));
    const player = players.find(candidate => {
      const name = normalizeName(candidate.name);
      return name && text.includes(name) && !order.some(existing => normalizeName(existing) === name);
    });
    if (player?.name) order.push(player.name);
  }
  return order;
}

export function nativePlayerRowText(row: Element): string {
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('.aoe4-inline-legend-summary, .aoe4-inline-legend-chevron').forEach((node: HTMLElement) => node.remove());
  return clone.textContent?.trim() || '';
}

export function restoreNativeTimeline(timeline: TimelineElements): void {
  removeArmyUnitLegend(timeline);
  detachTimelineHoverGuard(timeline);
  detachCanvasTooltip(timeline.canvas);
  detachPlayerToggle(timeline);
  const nativeCanvas = timeline.__aoe4NativeCanvas;
  if (nativeCanvas && timeline.canvas !== nativeCanvas) {
    const currentCanvas = timeline.canvas;
    if (currentCanvas?.parentElement) {
      currentCanvas.parentElement.replaceChild(nativeCanvas, currentCanvas);
    }
    timeline.canvas = nativeCanvas;
  }
  timeline.canvas.style.display = '';
  if (timeline.heading.dataset.aoe4NativeTitle) {
    timeline.heading.textContent = timeline.heading.dataset.aoe4NativeTitle;
  }
  ensureNativeAgeUpOverlayResizeObserver(timeline);
}

export function showNativeAgeUpOverlay(timeline: TimelineElements): void {
  const summary = timeline.__aoe4Summary;
  if (!summary || !timeline.chartBox || !timeline.canvas) return;
  const nativeColors = nativeTimelinePlayerColors(timeline);
  const ageUps = extractAgeUps(summary, nativeColors);
  if (!ageUps.length) {
    hideNativeAgeUpOverlay(timeline);
    return;
  }

  let overlay = timeline.chartBox.querySelector<HTMLCanvasElement>('.aoe4-ageup-overlay') as (HTMLCanvasElement & CanvasExtensions) | null;
  if (!overlay) {
    overlay = document.createElement('canvas') as HTMLCanvasElement & CanvasExtensions;
    overlay.className = 'aoe4-ageup-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    const position = getComputedStyle(timeline.chartBox).position;
    if (!position || position === 'static') timeline.chartBox.style.position = 'relative';
    timeline.chartBox.appendChild(overlay);
  }
  overlay.style.display = '';
  ensureNativeAgeUpOverlayResizeObserver(timeline);

  requestAnimationFrame(() => drawAgeUpOverlay(overlay, ageUps, summary, timeline));
}

export function hideNativeAgeUpOverlay(timeline: TimelineElements): void {
  const overlay = timeline.chartBox?.querySelector<HTMLElement>('.aoe4-ageup-overlay');
  if (overlay) overlay.style.display = 'none';
}

export function ensureNativeAgeUpOverlayResizeObserver(timeline: TimelineElements): void {
  if (!timeline.chartBox || timeline.__aoe4OverlayResizeObserver || typeof ResizeObserver === 'undefined') return;
  timeline.__aoe4OverlayResizeObserver = new ResizeObserver(() => {
    const overlay = timeline.chartBox?.querySelector<HTMLCanvasElement>('.aoe4-ageup-overlay') as (HTMLCanvasElement & CanvasExtensions) | null;
    if (!overlay || overlay.style.display === 'none') return;
    const summary = timeline.__aoe4Summary;
    if (!summary) return;
    const nativeColors = nativeTimelinePlayerColors(timeline);
    const ageUps = extractAgeUps(summary, nativeColors);
    if (ageUps.length) drawAgeUpOverlay(overlay, ageUps, summary, timeline);
    else hideNativeAgeUpOverlay(timeline);
  });
  timeline.__aoe4OverlayResizeObserver.observe(timeline.chartBox);
}
