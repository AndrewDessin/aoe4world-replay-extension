import type {
  GameSummary,
  PlayerSummary,
  UnitDataEntry,
  UnitDataMap,
  UnitDataSourceUnit,
} from './types.ts';

interface UnitDataResponse {
  success?: boolean;
  units?: Record<string, UnitDataSourceUnit[]>;
}

const CIV_ID_TO_DATA_SLUG: Record<string, string> = {
  abbasid_dynasty: 'abbasid', ayyubids: 'ayyubids', byzantines: 'byzantines',
  chinese: 'chinese', delhi_sultanate: 'delhi', english: 'english', french: 'french',
  golden_horde: 'goldenhorde', holy_roman_empire: 'hre', house_of_lancaster: 'lancaster',
  japanese: 'japanese', jeanne_darc: 'jeannedarc', jin_dynasty: 'jindynasty', knights_templar: 'templar',
  macedonian_dynasty: 'macedonian', malians: 'malians', mongols: 'mongols',
  order_of_the_dragon: 'orderofthedragon', ottomans: 'ottomans', rus: 'rus',
  sengoku_daimyo: 'sengoku', tughlaq_dynasty: 'tughlaq', zhu_xis_legacy: 'zhuxi',
};

export const unitDataIndex: Map<string, UnitDataMap> = new Map();
export const unitDataLoaded: Set<string> = new Set();
export const unitDataPendingFetches: Map<string, boolean> = new Map();

export function civDataSlugForPlayer(player: PlayerSummary | null): string {
  if (!player) return '';
  const id = String(player.civilization || '').toLowerCase();
  if (CIV_ID_TO_DATA_SLUG[id]) return CIV_ID_TO_DATA_SLUG[id];
  const attrib = String(player.civilizationAttrib || '').toLowerCase();
  if (CIV_ID_TO_DATA_SLUG[attrib]) return CIV_ID_TO_DATA_SLUG[attrib];
  if (/^[a-z]+$/.test(attrib)) return attrib;
  return '';
}

export function buildUnitDataIndexForCiv(slug: string, units: UnitDataSourceUnit[]): void {
  const index: UnitDataMap = new Map();
  const pbgidIndex: Map<number, UnitDataEntry> = new Map();
  const sorted = [...units].sort((a, b) => (a.age || 0) - (b.age || 0));
  for (const u of sorted) {
    const baseId = String(u.baseId || u.id || '').replace(/-/g, '_').toLowerCase();
    const entry: UnitDataEntry = { id: u.id, name: u.name, icon: u.icon || '', costs: u.costs || null };
    if (u.pbgid) pbgidIndex.set(Number(u.pbgid), entry);
    if (baseId) {
      if (u.age) {
        const ageKey = `${baseId}_${u.age}`;
        if (!index.has(ageKey)) index.set(ageKey, entry);
      }
      if (!index.has(baseId)) index.set(baseId, entry);
    }
    const m = String(u.attribName || '').match(/^unit_(.+?)(?:_[a-z]{2,5}(?:_ha_[a-z0-9]{2,5})?)?$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (!index.has(k)) index.set(k, entry);
    }
  }
  for (const u of sorted) {
    const entry: UnitDataEntry = { id: u.id, name: u.name, icon: u.icon || '', costs: u.costs || null };
    for (const cls of (u.classes || [])) {
      const lc = String(cls).toLowerCase();
      if (u.age) {
        const k = `${lc}_${u.age}`;
        if (!index.has(k)) index.set(k, entry);
      }
      if (!index.has(lc)) index.set(lc, entry);
    }
  }
  for (const u of sorted) {
    if (!u.icon) continue;
    const entry: UnitDataEntry = { id: u.id, name: u.name, icon: u.icon, costs: u.costs || null };
    const iconFilename = String(u.icon).split('/').pop() || '';
    const iconSlug = iconFilename.replace(/\.png$/i, '').replace(/-/g, '_').toLowerCase();
    if (iconSlug && !index.has(iconSlug)) index.set(iconSlug, entry);
    const merged = iconSlug.replace(/_(?:age_?\d+|\d+|cw)$/, '');
    if (merged && merged !== iconSlug && !index.has(merged)) index.set(merged, entry);
  }
  index.__pbgidIndex = pbgidIndex;
  unitDataIndex.set(slug, index);
  unitDataLoaded.add(slug);
}

export function lookupUnitDataForIcon(icon: string | null | undefined, player: PlayerSummary | null): UnitDataEntry | null {
  const slug = civDataSlugForPlayer(player);
  if (!slug) return null;
  const idx = unitDataIndex.get(slug);
  if (!idx) return null;
  const iconFilename = String(icon || '').split('/').pop() || '';
  const basename = iconFilename.replace(/\.png$/i, '').replace(/-/g, '_').toLowerCase();
  if (!basename) return null;
  const candidates: string[] = [basename];
  const ageM = basename.match(/^(.+)_age_?(\d)$/);
  if (ageM) candidates.push(`${ageM[1]}_${ageM[2]}`);
  candidates.push(basename.replace(/_\d+$/, ''));
  candidates.push(basename.replace(/_age_?\d+$/, ''));
  for (const k of candidates) {
    const hit = idx.get(k);
    if (hit) return hit;
  }
  return null;
}

export function lookupUnitDataByPbgid(pbgid: number | null | undefined, player: PlayerSummary | null): UnitDataEntry | null {
  if (!pbgid) return null;
  const slug = civDataSlugForPlayer(player);
  if (!slug) return null;
  const idx = unitDataIndex.get(slug);
  if (!idx?.__pbgidIndex) return null;
  return idx.__pbgidIndex.get(Number(pbgid)) || null;
}

export function ensureUnitDataForSummary(summary: GameSummary | null | undefined, onUpdated?: () => void): void {
  const players = Array.isArray(summary?.players) ? summary.players : [];
  const slugs = [...new Set(players.map(civDataSlugForPlayer).filter((slug): slug is string => Boolean(slug)))];
  const missing = slugs.filter(s => !unitDataLoaded.has(s) && !unitDataPendingFetches.has(s));
  if (!missing.length) return;
  for (const s of missing) unitDataPendingFetches.set(s, true);
  chrome.runtime.sendMessage({ type: 'getUnitData', civSlugs: missing }, (response: UnitDataResponse | undefined) => {
    let updated = false;
    if (response?.success && response.units) {
      for (const [slug, units] of Object.entries(response.units)) {
        if (Array.isArray(units) && units.length) {
          buildUnitDataIndexForCiv(slug, units);
          updated = true;
        } else {
          unitDataLoaded.add(slug);
        }
      }
    }
    for (const s of missing) unitDataPendingFetches.delete(s);
    if (updated && typeof onUpdated === 'function') onUpdated();
  });
}
