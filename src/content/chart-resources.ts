import { titleCase } from './canvas-geom.ts';
import { playerColor } from './colors.ts';
import {
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

type ResourcePoint = {
  time: number;
  value: number;
};

type ResourceDescriptor = {
  key: ResourceKey;
  label: string;
  totalLabel: string;
  appliesToPlayer?: (player: PlayerSummary) => boolean;
  stockpileKeys: string[];
  gatheredKeys: string[];
};

const BASE_RESOURCE_DESCRIPTORS: ResourceDescriptor[] = [
  { key: 'food', label: 'Food', totalLabel: 'food', stockpileKeys: ['food'], gatheredKeys: ['foodGathered'] },
  { key: 'wood', label: 'Wood', totalLabel: 'wood', stockpileKeys: ['wood'], gatheredKeys: ['woodGathered'] },
  { key: 'gold', label: 'Gold', totalLabel: 'gold', stockpileKeys: ['gold'], gatheredKeys: ['goldGathered'] },
  { key: 'stone', label: 'Stone', totalLabel: 'stone', stockpileKeys: ['stone'], gatheredKeys: ['stoneGathered'] },
];

const SPECIAL_RESOURCE_DESCRIPTORS: ResourceDescriptor[] = [
  {
    key: 'oliveoil',
    label: 'Olive Oil',
    totalLabel: 'olive oil',
    appliesToPlayer: isByzantineOliveOilPlayer,
    stockpileKeys: ['oliveoil'],
    gatheredKeys: ['oliveoilGathered'],
  },
  {
    key: 'silver',
    label: 'Silver',
    totalLabel: 'silver',
    appliesToPlayer: isMacedonianSilverPlayer,
    // aoe4world currently stores Macedonian silver totals in the historical
    // oliveoil bucket, so accept both the future semantic key and today's alias.
    stockpileKeys: ['silver', 'oliveoil'],
    gatheredKeys: ['silverGathered', 'oliveoilGathered'],
  },
];

function civSlug(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isMacedonianSilverPlayer(player: PlayerSummary): boolean {
  const civ = civSlug(player.civilization);
  const attrib = civSlug(player.civilizationAttrib);
  return civ.includes('macedonian') || attrib.includes('macedonian') || attrib === 'byzantine_ha_mac';
}

function isByzantineOliveOilPlayer(player: PlayerSummary): boolean {
  if (isMacedonianSilverPlayer(player)) return false;
  const civ = civSlug(player.civilization);
  const attrib = civSlug(player.civilizationAttrib);
  return civ.includes('byzant') || attrib.includes('byzant');
}

function resourceDescriptorsForPlayer(player: PlayerSummary): ResourceDescriptor[] {
  return [
    ...BASE_RESOURCE_DESCRIPTORS,
    ...SPECIAL_RESOURCE_DESCRIPTORS.filter(descriptor => !descriptor.appliesToPlayer || descriptor.appliesToPlayer(player)),
  ];
}

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
  // Avoid flatlining past recorded samples.
  const end = lastTs || Math.max(Number(duration) || 0, 0);
  const labels = [];
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

function firstNumericResourceArray(resources: PlayerResources | undefined, keys: string[]): number[] {
  if (!resources) return [];
  for (const key of keys) {
    const values = numericArray(resources[key]);
    if (values.length) return values;
  }
  return [];
}

function resourceRunningTotalValues(resources: PlayerResources | undefined, descriptor: ResourceDescriptor, labels: number[]): number[] {
  const timestamps = numericArray(resources?.timestamps);
  // aoe4world's gathered series behaves like cumulative spent.
  const spent = firstNumericResourceArray(resources, descriptor.gatheredKeys);
  const stockpile = firstNumericResourceArray(resources, descriptor.stockpileKeys);
  if (!timestamps.length || (!spent.length && !stockpile.length) || !labels.length) {
    return labels.map(() => 0);
  }
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

function resourceValuesForDescriptor(player: PlayerSummary, descriptor: ResourceDescriptor, labels: number[]): number[] {
  return resourceRunningTotalValues(player.resources, descriptor, labels);
}

export function buildResourceGatheredCharts(summary: GameSummary, nativeColors: Map<string, string>): Chart[] {
  const players: PlayerSummary[] = Array.isArray(summary.players) ? summary.players : [];
  const labels = resourceSampleLabels(players, summary.duration || 0);
  if (!labels.length) return [];

  const charts: Chart[] = [];
  const totalSeries: ChartSeries[] = players.map((player: PlayerSummary, index: number): ChartSeries => ({
    label: player.name || `Player ${index + 1}`,
    playerName: player.name || `Player ${index + 1}`,
    key: `resources:total:${player.profileId || index}`,
    color: playerColor(summary, player, index, nativeColors),
    values: resourceDescriptorsForPlayer(player)
      .map((descriptor: ResourceDescriptor) => resourceValuesForDescriptor(player, descriptor, labels))
      .reduce((totals: number[], values: number[]) => totals.map((total: number, valueIndex: number) => total + (values[valueIndex] || 0)), labels.map(() => 0))
  })).filter((series: ChartSeries) => maxAbs(series.values) > 0);

  if (totalSeries.length) {
    charts.push({
      value: `${SUMMARY_PLUS_PREFIX}resources-gathered-total`,
      title: 'Resources Gathered: Total',
      meta: 'Running total of resources gathered from aoe4world time-series data (food, wood, gold, stone, plus civilization-specific resources when present).',
      data: { labels, series: totalSeries },
      type: 'line',
      options: { height: 280 }
    });
  }

  const chartDescriptors = [
    ...BASE_RESOURCE_DESCRIPTORS,
    ...SPECIAL_RESOURCE_DESCRIPTORS,
  ];

  for (const descriptor of chartDescriptors) {
    const series: ChartSeries[] = players.map((player: PlayerSummary, index: number): ChartSeries => {
      let values: number[];
      if (descriptor.appliesToPlayer && !descriptor.appliesToPlayer(player)) {
        values = labels.map(() => 0);
      } else {
        values = resourceValuesForDescriptor(player, descriptor, labels);
      }
      return {
        label: player.name || `Player ${index + 1}`,
        playerName: player.name || `Player ${index + 1}`,
        key: `resources:${descriptor.key}:${player.profileId || index}`,
        color: playerColor(summary, player, index, nativeColors),
        values,
      };
    }).filter((item: ChartSeries) => maxAbs(item.values) > 0);
    if (series.length) {
      const label = RESOURCE_LABELS[descriptor.key as keyof typeof RESOURCE_LABELS] || descriptor.label || titleCase(descriptor.key);
      charts.push({
        value: `${SUMMARY_PLUS_PREFIX}resources-gathered-${descriptor.key}`,
        title: `Resources Gathered: ${label}`,
        meta: `Running total of ${descriptor.totalLabel || label.toLowerCase()} gathered.`,
        data: { labels, series },
        type: 'line',
        options: { height: 240 }
      });
    }
  }
  return charts;
}
