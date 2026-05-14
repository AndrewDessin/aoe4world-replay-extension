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
  hasCanonicalPbgid?: boolean;
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

function addAliasCandidate(aliases: Map<string, Set<string>>, alias: string, canonical: string): void {
  if (!alias || !canonical || alias === canonical) return;
  let bucket = aliases.get(alias);
  if (!bucket) {
    bucket = new Set<string>();
    aliases.set(alias, bucket);
  }
  bucket.add(canonical);
}

function buildUniqueAliasMap(aliases: Map<string, Set<string>>): Map<string, string> {
  const unique = new Map<string, string>();
  for (const [alias, canonicals] of aliases) {
    if (canonicals.size !== 1) continue;
    const [only] = canonicals;
    if (only) unique.set(alias, only);
  }
  return unique;
}

function unitEntityId(item: { id?: unknown }): string {
  const id = item.id == null ? '' : String(item.id).trim();
  return id && id !== '0' ? id : '';
}

export function buildArmySeriesForPlayer(player: PlayerSummary, labels: number[], baseColor: string): ChartSeries[] {
  const grouped = new Map<string, ArmySeriesGroup>();
  const legacyToCanonicalsByIcon = new Map<string, Set<string>>();
  const canonicalKeysByEntityId = new Map<string, Set<string>>();

  for (const item of player.buildOrder || []) {
    if (item.type !== 'Unit' || !isArmyUnit(item)) continue;
    const canonicalFromPbgid = resolveUnitByPbgid(item.pbgid)?.k || '';
    const rawKey = unitMergeKey(item.icon, item.pbgid);
    const legacyKey = unitMergeKey(item.icon, null);
    if (legacyKey && legacyKey !== rawKey) {
      addAliasCandidate(legacyToCanonicalsByIcon, legacyKey, rawKey);
    }
    const entityId = unitEntityId(item);
    if (entityId) {
      if (canonicalFromPbgid) {
        let canonicalBucket = canonicalKeysByEntityId.get(entityId);
        if (!canonicalBucket) {
          canonicalBucket = new Set<string>();
          canonicalKeysByEntityId.set(entityId, canonicalBucket);
        }
        canonicalBucket.add(canonicalFromPbgid);
      }
    }
  }

  const iconAliasToGroup = buildUniqueAliasMap(legacyToCanonicalsByIcon);
  const canonicalByEntityId = new Map<string, string>();
  for (const [entityId, canonicals] of canonicalKeysByEntityId) {
    if (canonicals.size !== 1) continue;
    const [canonical] = canonicals;
    if (canonical) canonicalByEntityId.set(entityId, canonical);
  }

  for (const item of player.buildOrder || []) {
    if (item.type !== 'Unit' || !isArmyUnit(item)) continue;
    const rawKey = unitMergeKey(item.icon, item.pbgid);
    const legacyKey = unitMergeKey(item.icon, null);
    const entityCanonical = canonicalByEntityId.get(unitEntityId(item));
    const key = entityCanonical || rawKey;
    const canonicalPbgidKey = resolveUnitByPbgid(item.pbgid)?.k || '';
    const hasCanonicalPbgid = Boolean(canonicalPbgidKey && canonicalPbgidKey === key);

    let group = grouped.get(key);
    if (!group) {
      group = {
        finished: [],
        destroyed: [],
        icon: item.icon,
        pbgid: item.pbgid,
        hasCanonicalPbgid,
        label: unitLabelBase(key, item.icon, player, item.pbgid),
        upgrades: [],
        mergeKey: key,
      };
      grouped.set(key, group);
    } else if ((!group.pbgid || (!group.hasCanonicalPbgid && hasCanonicalPbgid)) && item.pbgid) {
      group.pbgid = item.pbgid;
      group.icon = item.icon;
      group.hasCanonicalPbgid = hasCanonicalPbgid;
      group.label = unitLabelBase(key, item.icon, player, item.pbgid);
    }

    group.finished.push(...numericArray(item.finished), ...numericArray(item.transformed));
    group.destroyed.push(...numericArray(item.destroyed));
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
      if ((!existing.pbgid || (!existing.hasCanonicalPbgid && group.hasCanonicalPbgid)) && group.pbgid) {
        existing.pbgid = group.pbgid;
        existing.icon = group.icon;
        existing.hasCanonicalPbgid = group.hasCanonicalPbgid;
        existing.label = group.label;
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
