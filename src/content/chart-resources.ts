import { titleCase } from './canvas-geom.ts';
import { playerColor } from './colors.ts';
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  RESOURCE_SAMPLE_SECONDS,
  SUMMARY_PLUS_PREFIX,
  numericArray,
  maxAbs,
} from './chart-utils.ts';
import type {
  Chart,
  ChartSeries,
  GameSummary,
  PlayerResources,
  PlayerSummary,
  ResourceKey,
} from './types.ts';

// Per-session set of game IDs already warned for the "oliveoil time-series
// missing" defensive check, so chart switches / re-renders don't re-spam.
const oliveoilWarnedGames = new Set<string>();

type ResourcePoint = {
  time: number;
  value: number;
};

export function firstResourceLabels(players: PlayerSummary[]): number[] {
  for (const player of players) {
    const timestamps = numericArray(player.resources?.timestamps);
    if (timestamps.length) return timestamps;
  }
  return [];
}

export function lastResourceTimestamp(players: PlayerSummary[]): number {
  let last = 0;
  for (const player of players) {
    const timestamps = numericArray(player.resources?.timestamps);
    if (timestamps.length) last = Math.max(last, timestamps[timestamps.length - 1]);
  }
  return last;
}

export function resourceSampleLabels(players: PlayerSummary[], duration: number): number[] {
  const timestamps = firstResourceLabels(players);
  const lastTs = timestamps[timestamps.length - 1] || 0;
  // Use last resource timestamp; summary.duration can extend past when
  // recording stopped, causing flatline ticks at the end.
  const end = lastTs || Math.max(Number(duration) || 0, 0);
  const labels = [];
  // Ceil so the final partial bucket is included; floor would drop end-of-game events.
  const stop = Math.ceil(end / RESOURCE_SAMPLE_SECONDS) * RESOURCE_SAMPLE_SECONDS;
  for (let second = 0; second <= stop; second += RESOURCE_SAMPLE_SECONDS) {
    labels.push(second);
  }
  return labels;
}

function resourceChangePoints(timestamps: number[], values: number[]): ResourcePoint[] {
  const points: ResourcePoint[] = [];
  const length = Math.min(timestamps.length, values.length);
  for (let index = 0; index < length; index++) {
    const time = Number(timestamps[index]);
    const value = Math.max(0, Number(values[index]) || 0);
    if (!Number.isFinite(time)) continue;
    if (!points.length) {
      points.push({ time, value });
      continue;
    }
    if (value > points[points.length - 1].value) {
      points.push({ time, value });
    }
  }
  return points;
}

function segmentedCumulativeAt(points: ResourcePoint[], time: number): number {
  if (!points.length) return 0;
  if (time <= points[0].time) return points[0].value;
  for (let index = 1; index < points.length; index++) {
    const prevTime = points[index - 1].time;
    const nextTime = points[index].time;
    if (time > nextTime) continue;
    const prevValue = points[index - 1].value;
    const nextValue = points[index].value;
    if (nextTime <= prevTime) return nextValue;
    const ratio = Math.max(0, Math.min(1, (time - prevTime) / (nextTime - prevTime)));
    return prevValue + (nextValue - prevValue) * ratio;
  }
  return points[points.length - 1].value;
}

function resourceRunningTotalValues(resources: PlayerResources | undefined, resource: ResourceKey, labels: number[]): number[] {
  const timestamps = numericArray(resources?.timestamps);
  // The `<resource>Gathered` field in the API is misleadingly named: empirically
  // its last sample equals `totalResourcesSpent.<resource>` (NOT total gathered).
  // True cumulative gathered = stockpile + cumulative spent, so we sum
  // `<resource>` (current stockpile) and `<resource>Gathered` (cumulative spent).
  // The last tick approximates official total-gathered (within ~1-3% — series
  // stops a few samples before game end + Dark Age starting resources count).
  // Caveats:
  //  - Tribute received in team games inflates the receiver's "gathered" line.
  //  - Tribute given is correctly absorbed (drops dropped by monotonic-only
  //    `resourceChangePoints`).
  //  - Olive oil from IO/landmark counts as gathered (matches aoe4world).
  const spent = numericArray(resources?.[`${resource}Gathered`]);
  const stockpile = numericArray(resources?.[resource]);
  if (!timestamps.length || (!spent.length && !stockpile.length) || !labels.length) {
    return labels.map(() => 0);
  }
  // Symmetric min so the tail uses real data on both arrays — avoids a
  // synthetic dip when one array is shorter than the other.
  const length = Math.min(
    timestamps.length,
    spent.length || timestamps.length,
    stockpile.length || timestamps.length
  );
  const summed = new Array(length);
  for (let index = 0; index < length; index++) {
    summed[index] = (Number(spent[index]) || 0) + (Number(stockpile[index]) || 0);
  }
  const changePoints = resourceChangePoints(timestamps, summed);
  return labels.map((time: number) => segmentedCumulativeAt(changePoints, time));
}

export function buildResourceGatheredCharts(summary: GameSummary, nativeColors: Map<string, string>, gameIdForWarn = ''): Chart[] {
  const players: PlayerSummary[] = Array.isArray(summary.players) ? summary.players : [];
  const labels = resourceSampleLabels(players, summary.duration || 0);
  if (!labels.length) return [];

  // One-shot defensive warn per game ID: if any player has
  // totalResourcesGathered.oliveoil > 0 but no `oliveoilGathered` time-series,
  // the API field name shape is wrong and the per-resource chart will hide.
  const warnKey = gameIdForWarn || '__no_game__';
  if (!oliveoilWarnedGames.has(warnKey)) {
    for (const p of players) {
      const tg = (p?.totalResourcesGathered) || {};
      const r = (p?.resources) || {};
      if ((Number(tg.oliveoil) || 0) > 0 && !Array.isArray(r.oliveoilGathered) && !Array.isArray(r.oliveoil)) {
        console.warn(
          `[aoe4plus] Player has totalResourcesGathered.oliveoil > 0 but no oliveoil time-series found — chart will not render. Field-name shape may differ.`,
          { player: p.name, oliveoilTotal: tg.oliveoil, resourceKeys: Object.keys(r) }
        );
        oliveoilWarnedGames.add(warnKey);
        break;
      }
    }
  }

  const charts: Chart[] = [];
  const totalSeries: ChartSeries[] = players.map((player: PlayerSummary, index: number): ChartSeries => ({
    label: player.name || `Player ${index + 1}`,
    playerName: player.name || `Player ${index + 1}`,
    key: `resources:total:${player.profileId || index}`,
    color: playerColor(summary, player, index, nativeColors),
    values: (RESOURCE_KEYS as ResourceKey[])
      .map((resource: ResourceKey) => resourceRunningTotalValues(player.resources, resource, labels))
      .reduce((totals: number[], values: number[]) => totals.map((total: number, valueIndex: number) => total + (values[valueIndex] || 0)), labels.map(() => 0))
  })).filter((series: ChartSeries) => maxAbs(series.values) > 0);

  if (totalSeries.length) {
    charts.push({
      value: `${SUMMARY_PLUS_PREFIX}resources-gathered-total`,
      title: 'Resources Gathered: Total',
      meta: 'Running total of all resources gathered (food, wood, gold, stone, plus olive oil for Byzantines).',
      data: { labels, series: totalSeries },
      type: 'line',
      options: { height: 280 }
    });
  }

  for (const resource of RESOURCE_KEYS as ResourceKey[]) {
    const series: ChartSeries[] = players.map((player: PlayerSummary, index: number): ChartSeries => ({
      label: player.name || `Player ${index + 1}`,
      playerName: player.name || `Player ${index + 1}`,
      key: `resources:${resource}:${player.profileId || index}`,
      color: playerColor(summary, player, index, nativeColors),
      values: resourceRunningTotalValues(player.resources, resource, labels)
    })).filter((item: ChartSeries) => maxAbs(item.values) > 0);
    if (series.length) {
      const label = RESOURCE_LABELS[resource as keyof typeof RESOURCE_LABELS] || titleCase(resource);
      charts.push({
        value: `${SUMMARY_PLUS_PREFIX}resources-gathered-${resource}`,
        title: `Resources Gathered: ${label}`,
        meta: `Running total of ${label.toLowerCase()} gathered.`,
        data: { labels, series },
        type: 'line',
        options: { height: 240 }
      });
    }
  }
  return charts;
}
