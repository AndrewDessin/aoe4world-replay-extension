import { parseTimeToSeconds } from './dom.ts';
import { playerColor } from './colors.ts';
import type {
  AgeUp,
  AgeUpPlacement,
  AgeUpPlacementItem,
  DrawAgeUpOptions,
  GameSummary,
  TimelineElements,
} from './types.ts';

const AGE_UP_FONT = 'bold 10px system-ui, -apple-system, sans-serif';
const AGE_UP_FONT_SIZE = 10;
const AGE_UP_LABEL_HEIGHT = 13;
const AGE_UP_HORIZONTAL_PAD = 4;
const AGE_UP_TOP_PAD = 6;
const AGE_UP_BASELINE_PAD = 4;
const AGE_UP_DEFAULT_MARGIN = 20;

export { AGE_UP_DEFAULT_MARGIN };

export function extractAgeUps(summary: GameSummary | null | undefined, nativeColors: Map<string, string>): AgeUp[] {
  const players = Array.isArray(summary?.players) ? summary.players : [];
  const ageUps: AgeUp[] = [];
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const color = playerColor(summary, player, i, nativeColors);
    const landmarks = player.analysis?.landmarks;
    if (Array.isArray(landmarks) && landmarks.length) {
      for (const landmark of landmarks) {
        if (!landmark.newAge || landmark.newAge < 2 || landmark.newAge > 4) continue;
        const ageSec = landmark.gameTime;
        if (typeof ageSec !== 'number' || ageSec <= 0) continue;
        const label = ['', '', 'II', 'III', 'IV'][landmark.newAge] || '';
        ageUps.push({ gameTimeSec: ageSec, label, color, playerName: player.name || '' });
      }
      continue;
    }

    const times = player.ageUpTimes;
    if (!times) continue;
    for (const [key, label] of [['feudalAge', 'II'], ['castleAge', 'III'], ['imperialAge', 'IV']] as const) {
      const raw = times[key];
      if (!raw) continue;
      const sec = parseTimeToSeconds(raw);
      if (sec == null || sec <= 0) continue;
      ageUps.push({ gameTimeSec: sec, label, color, playerName: player.name || '' });
    }
  }
  return ageUps.sort((a, b) => a.gameTimeSec - b.gameTimeSec);
}

export function planAgeUpPlacement(
  ctx: CanvasRenderingContext2D,
  ageUps: AgeUp[],
  gameDuration: number,
  marginLeft: number,
  marginRight: number,
  cssWidth: number,
  plotW: number,
): AgeUpPlacement {
  if (!ageUps.length || gameDuration <= 0) return { items: [], rowCount: 0 };
  ctx.save();
  ctx.font = AGE_UP_FONT;
  const ordered = [...ageUps].sort((a, b) =>
    (a.gameTimeSec - b.gameTimeSec) || String(a.label).localeCompare(String(b.label))
  );
  const items: AgeUpPlacementItem[] = [];
  for (const ageUp of ordered) {
    const x = marginLeft + (ageUp.gameTimeSec / gameDuration) * plotW;
    if (x < marginLeft || x > cssWidth - marginRight) continue;
    const text = String(ageUp.label || '');
    const halfW = (ctx.measureText(text).width / 2) || 4;
    const labelX = Math.max(halfW + AGE_UP_TOP_PAD, Math.min(x, cssWidth - halfW - AGE_UP_TOP_PAD));
    items.push({ ageUp, x, labelX, halfW, text, row: 0 });
  }
  const placed: Array<Pick<AgeUpPlacementItem, 'labelX' | 'halfW' | 'row'>> = [];
  let rowCount = 0;
  for (const item of items) {
    let row = 0;
    while (placed.some(placedItem =>
      placedItem.row === row &&
      Math.abs(placedItem.labelX - item.labelX) < (placedItem.halfW + item.halfW + AGE_UP_HORIZONTAL_PAD)
    )) {
      row++;
    }
    item.row = row;
    placed.push({ labelX: item.labelX, halfW: item.halfW, row });
    if (row + 1 > rowCount) rowCount = row + 1;
  }
  ctx.restore();
  return { items, rowCount };
}

export function ageUpMarginTopForRows(rowCount: number): number {
  if (rowCount <= 0) return AGE_UP_DEFAULT_MARGIN;
  const required = (rowCount - 1) * AGE_UP_LABEL_HEIGHT + AGE_UP_FONT_SIZE + AGE_UP_BASELINE_PAD + AGE_UP_TOP_PAD;
  return Math.max(AGE_UP_DEFAULT_MARGIN, required);
}

export function drawAgeUpIndicators(ctx: CanvasRenderingContext2D, ageUps: AgeUp[], opts: DrawAgeUpOptions): void {
  const { margin, plotW, plotH, cssWidth, gameDuration, placement = null } = opts;
  if (!ageUps.length || gameDuration <= 0) return;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.font = AGE_UP_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const baseLabelY = margin.top - AGE_UP_BASELINE_PAD;
  const plan = placement || planAgeUpPlacement(ctx, ageUps, gameDuration, margin.left, margin.right, cssWidth, plotW);

  for (const item of plan.items) {
    const labelY = baseLabelY - item.row * AGE_UP_LABEL_HEIGHT;
    ctx.strokeStyle = item.ageUp.color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(item.x, labelY + 2);
    ctx.lineTo(item.x, margin.top + plotH);
    ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = item.ageUp.color;
    ctx.fillText(item.text, item.labelX, labelY);
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawAgeUpOverlay(
  overlay: HTMLCanvasElement,
  ageUps: AgeUp[],
  summary: GameSummary,
  timeline: TimelineElements | null,
): void {
  const chartBox = timeline?.chartBox || overlay.parentElement;
  const nativeCanvas = timeline?.canvas || chartBox?.querySelector<HTMLCanvasElement>('canvas:not(.aoe4-ageup-overlay)');
  const chartRect = chartBox?.getBoundingClientRect();
  const canvasRect = nativeCanvas?.getBoundingClientRect();
  if (!chartBox || !chartRect || !canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return;

  overlay.style.left = `${canvasRect.left - chartRect.left}px`;
  overlay.style.top = `${canvasRect.top - chartRect.top}px`;
  overlay.style.width = `${canvasRect.width}px`;
  overlay.style.height = `${canvasRect.height}px`;

  const cssWidth = canvasRect.width;
  const cssHeight = canvasRect.height;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(cssWidth * dpr);
  overlay.height = Math.round(cssHeight * dpr);
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const baseMargin = { top: AGE_UP_DEFAULT_MARGIN, right: 15, bottom: 35, left: 45 };
  const initialPlotW = Math.max(1, cssWidth - baseMargin.left - baseMargin.right);
  const gameDuration = Number(summary.duration) || 1;
  const placement = planAgeUpPlacement(ctx, ageUps, gameDuration, baseMargin.left, baseMargin.right, cssWidth, initialPlotW);
  const margin = { ...baseMargin, top: ageUpMarginTopForRows(placement.rowCount) };
  const plotW = Math.max(1, cssWidth - margin.left - margin.right);
  const plotH = Math.max(1, cssHeight - margin.top - margin.bottom);

  drawAgeUpIndicators(ctx, ageUps, { margin, plotW, plotH, cssWidth, gameDuration, placement });
}
