import { normalizeName } from './dom.ts';
import { AOE4_PLAYER_COLOR_HEX, playerColor } from './colors.ts';
import {
  isArmyUnit,
  unitCostTotal,
} from './unit-mapping.ts';
import {
  civDataSlugForPlayer,
  unitDataLoaded,
  lookupUnitDataByPbgid,
  lookupUnitDataForIcon,
} from './unit-data-cache.ts';
import {
  numericArray,
  buildSampleLabels,
  SUMMARY_PLUS_PREFIX,
} from './chart-utils.ts';
import {
  buildArmySeriesForPlayer,
  armyTeamSigns,
  precomputeStackedValues,
} from './army-series.ts';
import {
  resourceSampleLabels,
  lastResourceTimestamp,
} from './chart-resources.ts';
import type { Chart, ChartSeries, GameSummary, PlayerSummary } from './types.ts';

type NativeColors = Map<string, string>;
type DestroyedEvent = { time: number; cost: number };
const getArmyTeamSigns = armyTeamSigns as (players: PlayerSummary[], nativePlayerOrder?: string[]) => Map<number, number>;
const TEAM_POSITIVE_COLOR = AOE4_PLAYER_COLOR_HEX[0];
const TEAM_NEGATIVE_COLOR = AOE4_PLAYER_COLOR_HEX[1];

export function buildArmyCharts(summary: GameSummary, nativeColors: NativeColors, nativePlayerOrder: string[] = []): Chart[] {
  const players: PlayerSummary[] = Array.isArray(summary.players) ? summary.players : [];
  // Avoid flatlining past recorded samples.
  const lastResourceTime = lastResourceTimestamp(players);
  const gameDuration = lastResourceTime || summary.duration || 0;
  const labels = buildSampleLabels(gameDuration, 10);
  const teamSigns = getArmyTeamSigns(players, nativePlayerOrder);

  const orderedPlayers: PlayerSummary[] = [];
  const used = new Set<PlayerSummary>();
  for (const name of nativePlayerOrder) {
    const player = players.find((p: PlayerSummary) => normalizeName(p.name) === normalizeName(name) && !used.has(p));
    if (player) {
      orderedPlayers.push(player);
      used.add(player);
    }
  }
  for (const player of players) {
    if (!used.has(player)) orderedPlayers.push(player);
  }

  const series: ChartSeries[] = orderedPlayers.flatMap((player: PlayerSummary) => {
    const originalIndex = players.indexOf(player);
    const playerName = player.name || `Player ${originalIndex + 1}`;
    const baseColor = playerColor(summary, player, originalIndex, nativeColors);
    const sign = player.team == null ? (originalIndex === 0 ? 1 : -1) : (teamSigns.get(player.team) ?? (originalIndex === 0 ? 1 : -1));
    return (buildArmySeriesForPlayer(player, labels, baseColor) as ChartSeries[])
      .map((item: ChartSeries) => ({
        ...item,
        playerName,
        team: player.team,
        sign,
        // Labels can collide across civ substitutions.
        key: `army:${player.profileId || originalIndex}:${item.mergeKey || item.label}`,
        label: `${playerName}: ${item.label}`,
        values: item.values.map((value: number) => value * sign)
      }));
  });
  if (!labels.length || !series.length) return [];
  precomputeStackedValues(series);
  return [{
    value: `${SUMMARY_PLUS_PREFIX}army-composition`,
    title: 'Army Composition',
    meta: 'Active military units for all players over time from AoE4 World unit build-order finished/destroyed timestamps.',
    data: { labels, series },
    type: 'army',
    options: { height: 280 }
  }];
}

export function buildArmyValueLeadCharts(summary: GameSummary, nativeColors: NativeColors, nativePlayerOrder: string[] = []): Chart[] {
  const players: PlayerSummary[] = Array.isArray(summary.players) ? summary.players : [];
  const labels = resourceSampleLabels(players, summary.duration || 0);
  if (!labels.length) return [];

  const teamSigns = getArmyTeamSigns(players, nativePlayerOrder);
  const teams = [...new Set(players.map((player: PlayerSummary) => player.team).filter((team): team is number => team !== undefined && team !== null))];
  if (teams.length !== 2) return [];

  const positiveTeam = [...teamSigns.entries()].find(([, sign]) => sign > 0)?.[0];
  const negativeTeam = [...teamSigns.entries()].find(([, sign]) => sign < 0)?.[0];
  if (positiveTeam === undefined || negativeTeam === undefined) return [];

  const is1v1 = players.length === 2;
  const posPlayers = players.filter((player: PlayerSummary) => player.team === positiveTeam);
  const negPlayers = players.filter((player: PlayerSummary) => player.team === negativeTeam);
  const posMilitary: number[][] = posPlayers.map((player: PlayerSummary) => numericArray(player.resources?.military) as number[]);
  const negMilitary: number[][] = negPlayers.map((player: PlayerSummary) => numericArray(player.resources?.military) as number[]);

  const posValues: number[] = labels.map((_, i) => posMilitary.reduce((s: number, v: number[]) => s + (v[i] || 0), 0));
  const negValues: number[] = labels.map((_, i) => negMilitary.reduce((s: number, v: number[]) => s + (v[i] || 0), 0));
  const diffValues: number[] = labels.map((_, i) => posValues[i] - negValues[i]);

  const posColor = is1v1 ? playerColor(summary, posPlayers[0], players.indexOf(posPlayers[0]), nativeColors) : TEAM_POSITIVE_COLOR;
  const negColor = is1v1 ? playerColor(summary, negPlayers[0], players.indexOf(negPlayers[0]), nativeColors) : TEAM_NEGATIVE_COLOR;

  const leadPosSeries: ChartSeries = {
    label: is1v1 ? (posPlayers[0]?.name || 'Team 1') : 'Team 1',
    color: posColor,
    values: diffValues.map(v => Math.max(0, v)),
    _rawValues: posValues,
    key: 'lead:positive'
  };
  const leadNegSeries: ChartSeries = {
    label: is1v1 ? (negPlayers[0]?.name || 'Team 2') : 'Team 2',
    color: negColor,
    values: diffValues.map(v => Math.min(0, v)),
    _rawValues: negValues,
    key: 'lead:negative'
  };

  return [{
    value: `${SUMMARY_PLUS_PREFIX}army-value-lead`,
    title: 'Army Value Lead',
    data: { labels, series: [leadPosSeries, leadNegSeries] },
    type: 'lead',
    options: { height: 280 }
  }];
}

export function buildDestroyedValueCharts(summary: GameSummary, nativeColors: NativeColors, nativePlayerOrder: string[] = []): Chart[] {
  const players: PlayerSummary[] = Array.isArray(summary.players) ? summary.players : [];
  // Avoid partial values before cost data finishes loading.
  const slugs = players.map(civDataSlugForPlayer).filter((slug): slug is string => Boolean(slug));
  if (slugs.length === 0 || !slugs.every(s => unitDataLoaded.has(s))) return [];
  const lastResTime = lastResourceTimestamp(players);
  const gameDuration = lastResTime || summary.duration || 0;
  const labels = buildSampleLabels(gameDuration, 10);
  if (!labels.length) return [];

  const teamSigns = getArmyTeamSigns(players, nativePlayerOrder);
  const teams = [...new Set(players.map((player: PlayerSummary) => player.team).filter((team): team is number => team !== undefined && team !== null))];
  if (teams.length !== 2) return [];

  const positiveTeam = [...teamSigns.entries()].find(([, sign]) => sign > 0)?.[0];
  const negativeTeam = [...teamSigns.entries()].find(([, sign]) => sign < 0)?.[0];
  if (positiveTeam === undefined || negativeTeam === undefined) return [];

  const is1v1 = players.length === 2;
  const posDestroyedEvents: DestroyedEvent[] = [];
  const negDestroyedEvents: DestroyedEvent[] = [];

  for (const player of players) {
    const sign = player.team == null ? 1 : (teamSigns.get(player.team) ?? 1);
    for (const item of (player.buildOrder || [])) {
      if (item.type !== 'Unit') continue;
      const unitData = lookupUnitDataByPbgid(item.pbgid, player) || lookupUnitDataForIcon(item.icon, player);
      const cost = unitCostTotal(unitData);
      if (!cost) continue;
      for (const time of numericArray(item.destroyed)) {
        if (sign > 0) negDestroyedEvents.push({ time, cost });
        else posDestroyedEvents.push({ time, cost });
      }
    }
  }

  posDestroyedEvents.sort((a, b) => a.time - b.time);
  negDestroyedEvents.sort((a, b) => a.time - b.time);

  const cumulativeAtLabels = (events: DestroyedEvent[]): number[] => {
    let eventIndex = 0;
    let cumulative = 0;
    return labels.map((time: number) => {
      while (eventIndex < events.length && events[eventIndex].time <= time) {
        cumulative += events[eventIndex].cost;
        eventIndex++;
      }
      return cumulative;
    });
  };

  const posPlayer = players.find((player: PlayerSummary) => player.team === positiveTeam);
  const negPlayer = players.find((player: PlayerSummary) => player.team === negativeTeam);
  const posColor = is1v1 ? playerColor(summary, posPlayer as PlayerSummary, players.indexOf(posPlayer as PlayerSummary), nativeColors) : TEAM_POSITIVE_COLOR;
  const negColor = is1v1 ? playerColor(summary, negPlayer as PlayerSummary, players.indexOf(negPlayer as PlayerSummary), nativeColors) : TEAM_NEGATIVE_COLOR;

  return [{
    value: `${SUMMARY_PLUS_PREFIX}destroyed-value`,
    title: 'Destroyed Value',
    data: {
      labels,
      series: [
        {
          label: is1v1 ? (posPlayer?.name || 'Team 1') : 'Team 1',
          color: posColor,
          values: cumulativeAtLabels(posDestroyedEvents),
          sign: 1,
          key: 'destroyed:positive'
        },
        {
          label: is1v1 ? (negPlayer?.name || 'Team 2') : 'Team 2',
          color: negColor,
          values: cumulativeAtLabels(negDestroyedEvents).map(value => -value),
          sign: -1,
          key: 'destroyed:negative'
        }
      ]
    },
    type: 'lead',
    options: { height: 280 }
  }];
}
