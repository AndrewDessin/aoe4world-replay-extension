import { titleCase } from './canvas-geom.ts';
import { normalizeName } from './dom.ts';
import type { BuildOrderItem, PlayerSummary, UnitDataEntry, UnitGroup } from './types.ts';
import {
  resolveUnitByPbgid,
  resolveTechByPbgid,
  resolveUpgradeByPbgid,
} from './pbgid-map.ts';
import {
  civDataSlugForPlayer,
  unitDataIndex,
  lookupUnitDataByPbgid,
  lookupUnitDataForIcon,
} from './unit-data-cache.ts';
import { resolveLoadedUnitDisplayNameFromDom } from './unit-icons.ts';

export const EXCLUDED_ARMY_UNITS = [
  'villager', 'worker', 'scout', 'sheep', 'deer', 'boar', 'cow', 'livestock',
  'trader', 'merchant', 'fishing', 'monk', 'prelate', 'scholar', 'priest', 'imam',
  'religious'
];

export function isArmyUnit(item: BuildOrderItem): boolean {
  const icon = String(item.icon || '').toLowerCase();
  const unit = icon.split('/').pop() || icon;
  return !EXCLUDED_ARMY_UNITS.some(excluded => unit.includes(excluded));
}

export function unitCostTotal(unitData: UnitDataEntry | null | undefined): number {
  const total = Number(unitData?.costs?.total);
  if (Number.isFinite(total) && total > 0) return total;
  const costs = unitData?.costs;
  if (!costs || typeof costs !== 'object') return 0;
  return ['food', 'wood', 'gold', 'stone', 'vizier', 'oliveOil']
    .reduce((sum, key) => sum + (Number(costs[key]) || 0), 0);
}

export function unitMergeKey(icon: string | null | undefined, pbgid: number | null = null): string {
  const fromPbgid = resolveUnitByPbgid(pbgid);
  if (fromPbgid?.k) return fromPbgid.k;
  const filename = (String(icon || '').split('/').pop() || '').toLowerCase();
  // Strip age + civ + variant suffixes: horseman_2_jin_grassland → horseman
  const stripped = filename
    .replace(/_\d+_[a-z]{2,5}(?:_[a-z0-9_]+)?$/, '')  // _2_chi, _3_jin_grassland, _2_ha_01
    .replace(/_(?:age_?\d+|\d+|cw|upgrade(?:_\d+)?)$/, '');
  return stripped || filename;
}

export function findUnitGroupForUpgrade(
  upgradeIcon: string | null | undefined,
  upgradeName: string,
  grouped: Map<string, UnitGroup>,
  upgradePbgid: number | null = null,
  iconAliasMap: Map<string, string> | null = null
): UnitGroup | null {
  const getGroup = (key: string): UnitGroup | null => grouped.get(key) || null;
  const fromPbgidUp = resolveUpgradeByPbgid(upgradePbgid);
  if (fromPbgidUp?.b) {
    const groupId = fromPbgidUp.b;
    if (grouped.has(groupId)) return getGroup(groupId);
    const snake = groupId.replace(/-/g, '_');
    if (snake !== groupId && grouped.has(snake)) return getGroup(snake);
    if (iconAliasMap) {
      for (const [legacyKey, canonical] of iconAliasMap) {
        if (canonical === groupId || canonical === snake) {
          if (grouped.has(legacyKey)) return getGroup(legacyKey);
          if (grouped.has(canonical)) return getGroup(canonical);
        }
      }
    }
  }

  const baseKey = unitMergeKey(upgradeIcon, upgradePbgid);
  if (grouped.has(baseKey)) return getGroup(baseKey);
  const baseKebab = baseKey.replace(/_/g, '-');
  if (baseKebab !== baseKey && grouped.has(baseKebab)) return getGroup(baseKebab);
  const baseSnake = baseKey.replace(/-/g, '_');
  if (baseSnake !== baseKey && grouped.has(baseSnake)) return getGroup(baseSnake);

  if (iconAliasMap) {
    const aliasHit = iconAliasMap.get(baseKey);
    if (aliasHit && grouped.has(aliasHit)) return getGroup(aliasHit);
  }

  const stripped = baseKey
    .replace(/^(?:tech_|research_|upgrade_)+/, '')
    .replace(/_(?:upgrade|research)(?:_\d+)?$/, '');
  if (stripped && stripped !== baseKey) {
    if (grouped.has(stripped)) return getGroup(stripped);
    const sk = stripped.replace(/_/g, '-');
    if (sk !== stripped && grouped.has(sk)) return getGroup(sk);
    if (iconAliasMap) {
      const aliasHit = iconAliasMap.get(stripped);
      if (aliasHit && grouped.has(aliasHit)) return getGroup(aliasHit);
    }
  }

  if (baseKey) {
    const bk = baseKey.replace(/-/g, '_');
    for (const [unitKey, group] of grouped) {
      if (!unitKey) continue;
      const uk = unitKey.replace(/-/g, '_');
      if (
        bk === uk ||
        bk.startsWith(uk + '_') ||
        bk.endsWith('_' + uk) ||
        bk.includes('_' + uk + '_')
      ) {
        return group;
      }
    }
  }

  if (upgradeName) {
    const cleaned = String(upgradeName)
      .toLowerCase()
      .replace(/^(early|veteran|elite|hardened)\s+/i, '')
      .trim();
    if (cleaned) {
      const variants = new Set([cleaned]);
      variants.add(cleaned.replace(/men$/, 'man'));
      variants.add(cleaned.replace(/s$/, ''));
      variants.add(cleaned.replace(/men\b/g, 'man'));
      for (const [, group] of grouped) {
        const label = String(group.label || '').toLowerCase();
        if (variants.has(label)) return group;
      }
    }
  }
  return null;
}

export function unitLabel(icon: string | null | undefined, player: PlayerSummary | null = null, pbgid: number | null = null): string {
  const fromPbgidUnit = resolveUnitByPbgid(pbgid);
  if (fromPbgidUnit?.n) return fromPbgidUnit.n;
  const fromPbgidTech = resolveTechByPbgid(pbgid);
  if (fromPbgidTech?.n) return fromPbgidTech.n;
  const fromPbgidUpgrade = resolveUpgradeByPbgid(pbgid);
  if (fromPbgidUpgrade?.n) return fromPbgidUpgrade.n;
  if (pbgid) {
    const fromPbgid = lookupUnitDataByPbgid(pbgid, player);
    if (fromPbgid?.name) return fromPbgid.name;
  }
  const fromData = lookupUnitDataForIcon(icon, player);
  if (fromData?.name) return fromData.name;
  const alias = unitAlias(icon, player);
  const displayName = resolveLoadedUnitDisplayNameFromDom(unitIconCandidates(icon, alias?.displayName, player, pbgid));
  if (displayName) return displayName;
  if (alias?.displayName) return alias.displayName;
  const raw = String(icon || 'unit').split('/').pop() || 'unit';
  return titleCase(raw.replace(/_(?:cw|age_?\d+|\d+)$/, '').replace(/_/g, ' '));
}

export function unitLabelBase(
  mergeKey: string,
  originalIcon: string | null | undefined,
  player: PlayerSummary | null,
  pbgid: number | null = null
): string {
  const fromPbgid = resolveUnitByPbgid(pbgid);
  if (fromPbgid?.n) return fromPbgid.n;
  const slug = civDataSlugForPlayer(player);
  if (slug) {
      const idx = unitDataIndex.get(slug);
      if (idx) {
        const hit = idx.get(mergeKey) || idx.get(String(mergeKey).replace(/-/g, '_'));
      if (hit?.name) {
        const cleaned = hit.name.replace(/^(Early|Veteran|Elite|Hardened)\s+/i, '');
        return cleaned || hit.name;
      }
    }
  }
  return unitLabel(mergeKey, player, null) || unitLabel(originalIcon, player, pbgid);
}

export function unitIconCandidates(
  icon: string | null | undefined,
  label: string | undefined,
  player: PlayerSummary | null = null,
  pbgid: number | null = null
): string[] {
  const candidates: string[] = [];
  const fromPbgid = resolveUnitByPbgid(pbgid);
  if (fromPbgid?.i) candidates.push(fromPbgid.i);
  const fromPbgidUp = resolveUpgradeByPbgid(pbgid);
  if (fromPbgidUp?.i) candidates.push(fromPbgidUp.i);
  const fromData = lookupUnitDataForIcon(icon, player);
  if (fromData?.icon) candidates.push(fromData.icon);
  else if (fromData?.id) candidates.push(`https://data.aoe4world.com/images/units/${fromData.id}.png`);
  const alias = unitAlias(icon, player);
  if (alias?.slugs?.length) {
    for (const slug of alias.slugs) candidates.push(`https://data.aoe4world.com/images/units/${slug}.png`);
  }
  const raw = String(icon || '').split('/').pop() || label || 'unit';
  const age = raw.match(/(?:age|_)([1-4])$/)?.[1] || '';
  let slug = raw
    .replace(/_(?:cw|age_?\d+|\d+)$/, '')
    .replace(/^elephant_raider$/, 'raider_elephant')
    .replace(/_/g, '-')
    .toLowerCase();
  if (slug === 'chierosiphon') candidates.push('https://data.aoe4world.com/images/units/cheirosiphon-3.png');
  else if (slug === 'war-elephant') candidates.push('https://data.aoe4world.com/images/units/war-elephant-3.png');
  else if (slug === 'horseman' || slug === 'spearman') candidates.push(`https://data.aoe4world.com/images/units/${slug}-1.png`);
  else {
    const primaryAge = age || '1';
    candidates.push(`https://data.aoe4world.com/images/units/${slug}-${primaryAge}.png`);
    if (primaryAge !== '1') candidates.push(`https://data.aoe4world.com/images/units/${slug}-1.png`);
  }
  for (const candidate of [...candidates]) {
    const hyphenated = candidate.replace(/\/([^/?#]+)([?#].*)?$/, (match: string, filename: string, suffix = '') => {
      const normalized = filename.replace(/_/g, '-');
      return normalized === filename ? match : `/${normalized}${suffix}`;
    });
    if (hyphenated !== candidate) candidates.push(hyphenated);
  }
  return [...new Set(candidates)];
}

export function unitAlias(
  icon: string | null | undefined,
  player: PlayerSummary | null = null
): { displayName: string; slugs: string[] } | null {
  const raw = String(icon || '').split('/').pop() || '';
  const civ = normalizeName(player?.civilizationAttrib || player?.civilization);
  if (civ === 'french' && /^lancer(?:_\d+)?$/.test(raw)) {
    return { displayName: 'Royal Knight', slugs: ['royal-knight-2'] };
  }
  return null;
}
