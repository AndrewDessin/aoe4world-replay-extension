import { normalizeName } from './dom.ts';
import { shadeColor } from './colors.ts';
import { resolveUnitByPbgid } from './pbgid-map.ts';
import { lookupUnitDataByPbgid } from './unit-data-cache.ts';
import {
  isArmyUnit,
  unitMergeKey,
  unitLabel,
  unitLabelBase,
  unitIconCandidates,
  findUnitGroupForUpgrade,
} from './unit-mapping.ts';
import {
  numericArray,
  maxAbs,
  activeCountValues,
  collapseChartSeries,
} from './chart-utils.ts';
import type { ChartSeries, PlayerSummary, UnitUpgrade } from './types.ts';

type ArmySeriesGroup = {
  finished: number[];
  destroyed: number[];
  icon: string;
  pbgid?: number;
  label: string;
  upgrades: UnitUpgrade[];
  mergeKey: string;
};

type FindUnitGroupForUpgrade = (
  upgradeIcon: string,
  upgradeName: string,
  grouped: Map<string, ArmySeriesGroup>,
  upgradePbgid?: number,
  iconAliasMap?: Map<string, string>,
) => ArmySeriesGroup | undefined;

const findUnitGroupForUpgradeTyped = findUnitGroupForUpgrade as FindUnitGroupForUpgrade;
const collapseChartSeriesTyped = collapseChartSeries as (series: ChartSeries[], limit: number) => ChartSeries[];

export function buildArmySeriesForPlayer(player: PlayerSummary, labels: number[], baseColor: string): ChartSeries[] {
  const grouped = new Map<string, ArmySeriesGroup>();
  const legacyToCanonicals = new Map<string, Set<string>>();

  for (const item of player.buildOrder || []) {
    if (item.type !== 'Unit' || !isArmyUnit(item)) continue;
    const key = unitMergeKey(item.icon, item.pbgid);
    const legacyKey = unitMergeKey(item.icon, null);
    if (legacyKey && legacyKey !== key) {
      let bucket = legacyToCanonicals.get(legacyKey);
      if (!bucket) {
        bucket = new Set<string>();
        legacyToCanonicals.set(legacyKey, bucket);
      }
      bucket.add(key);
    }

    let group = grouped.get(key);
    if (!group) {
      group = {
        finished: [],
        destroyed: [],
        icon: item.icon,
        pbgid: item.pbgid,
        label: unitLabelBase(key, item.icon, player, item.pbgid),
        upgrades: [],
        mergeKey: key,
      };
      grouped.set(key, group);
    } else if (!group.pbgid && item.pbgid) {
      group.pbgid = item.pbgid;
      group.icon = item.icon;
    }

    group.finished.push(...numericArray(item.finished), ...numericArray(item.transformed));
    group.destroyed.push(...numericArray(item.destroyed));
  }

  const iconAliasToGroup = new Map<string, string>();
  for (const [legacyKey, canonicals] of legacyToCanonicals) {
    if (canonicals.size !== 1) continue;
    const [only] = canonicals;
    if (only) iconAliasToGroup.set(legacyKey, only);
  }

  for (const item of player.buildOrder || []) {
    if (item.type !== 'Upgrade') continue;
    const upgradeName = unitLabel(item.icon, player, item.pbgid);
    const group = findUnitGroupForUpgradeTyped(item.icon, upgradeName, grouped, item.pbgid, iconAliasToGroup);
    if (!group) continue;
    for (const t of numericArray(item.finished)) {
      group.upgrades.push({ time: t, name: upgradeName });
    }
  }

  const byLabel = new Map<string, ArmySeriesGroup>();
  for (const group of grouped.values()) {
    const label = group.label || group.mergeKey;
    const existing = byLabel.get(label);
    if (existing) {
      existing.finished.push(...group.finished);
      existing.destroyed.push(...group.destroyed);
      existing.upgrades.push(...group.upgrades);
      if (!existing.pbgid && group.pbgid) {
        existing.pbgid = group.pbgid;
        existing.icon = group.icon;
      }
    } else {
      byLabel.set(label, group);
    }
  }

  const series: ChartSeries[] = [...byLabel.values()]
    .map((events, index, arr) => {
      const fromPbgid = resolveUnitByPbgid(events.pbgid);
      const pbgidData = events.pbgid ? lookupUnitDataByPbgid(events.pbgid, player) : null;
      const baseCands = unitIconCandidates(events.icon, events.label, player, events.pbgid);
      const iconCands = pbgidData?.icon ? [pbgidData.icon, ...baseCands] : baseCands;
      if (fromPbgid?.i && !iconCands.includes(fromPbgid.i)) iconCands.unshift(fromPbgid.i);
      const finishedTimes = events.finished.slice().sort((a: number, b: number) => a - b);
      const destroyedTimes = events.destroyed.slice().sort((a: number, b: number) => a - b);
      return {
        label: events.label,
        mergeKey: events.mergeKey,
        unitLabel: events.label,
        color: shadeColor(baseColor, index, arr.length),
        baseColor,
        icon: events.icon,
        iconCandidates: iconCands,
        createdTotal: events.finished.length,
        upgrades: events.upgrades.sort((a: UnitUpgrade, b: UnitUpgrade) => a.time - b.time),
        values: activeCountValues(labels, events.finished, events.destroyed),
        _finishedTimes: finishedTimes,
        _destroyedTimes: destroyedTimes,
      };
    })
    .filter(item => maxAbs(item.values) > 0);

  return collapseChartSeriesTyped(series, 10);
}

export function armyTeamSigns(players: PlayerSummary[], nativePlayerOrder: string[] = []): Map<number, number> {
  const teams = [...new Set(players.map(player => player.team).filter((team): team is number => team !== undefined && team !== null))]
    .sort((a, b) => Number(a) - Number(b));
  const firstLegendPlayer = nativePlayerOrder
    .map(name => players.find(player => normalizeName(player.name) === normalizeName(name)))
    .find((player): player is PlayerSummary => Boolean(player));
  const positiveTeam = firstLegendPlayer?.team ?? teams[0];
  return new Map<number, number>(teams.map(team => [team, team === positiveTeam ? 1 : -1]));
}

export function precomputeStackedValues(series: ChartSeries[]): void {
  const bySide: { pos: ChartSeries[]; neg: ChartSeries[] } = { pos: [], neg: [] };
  for (const s of series) {
    if ((s.sign ?? 1) >= 0) bySide.pos.push(s);
    else bySide.neg.push(s);
  }

  for (const group of [bySide.pos, bySide.neg] as ChartSeries[][]) {
    if (group === bySide.pos) group.reverse();
    let baseline: Float32Array | null = null;
    let currentPlayer: string | null = null;
    let playerStartBase: Float32Array | null = null;
    let playerUnits: ChartSeries[] = [];

    const flushPlayer = (): void => {
      if (!playerUnits.length || !baseline) return;
      for (const unit of playerUnits) {
        unit._playerBase = playerStartBase;
        unit._playerTop = baseline;
      }
    };

    for (const s of group) {
      const len = s.values.length;
      s._stackBase = new Float32Array(len);
      s._stackTop = new Float32Array(len);

      if ((s.playerName ?? null) !== currentPlayer) {
        flushPlayer();
        currentPlayer = s.playerName ?? null;
        playerStartBase = baseline ? baseline.slice() : new Float32Array(len);
        playerUnits = [];
      }

      playerUnits.push(s);
      if (s._hidden) {
        for (let i = 0; i < len; i++) {
          const base = baseline ? baseline[i] : 0;
          s._stackBase[i] = base;
          s._stackTop[i] = base;
        }
        continue;
      }

      for (let i = 0; i < len; i++) {
        const base = baseline ? baseline[i] : 0;
        s._stackBase[i] = base;
        s._stackTop[i] = base + Math.abs(s.values[i] || 0) * ((s.sign ?? 1) >= 0 ? 1 : -1);
      }
      baseline = s._stackTop;
    }

    flushPlayer();
  }
}
