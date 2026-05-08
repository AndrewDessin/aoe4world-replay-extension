import type { PbgidEntry } from './types.ts';

interface PbgidMapResponse {
  units?: Record<string, PbgidEntry>;
  technologies?: Record<string, PbgidEntry>;
  upgrades?: Record<string, PbgidEntry>;
}

export const PBGID_MAP_URL = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
  ? chrome.runtime.getURL('data/pbgid-map.json')
  : '';

export const pbgidUnitsMap: Map<number, PbgidEntry> = new Map();
export const pbgidTechsMap: Map<number, PbgidEntry> = new Map();
export const pbgidUpgradesMap: Map<number, PbgidEntry> = new Map();
let pbgidMapLoaded = false;
let pbgidMapPromise: Promise<void> | null = null;

export function isPbgidMapLoaded(): boolean { return pbgidMapLoaded; }

export function ensurePbgidMap(onLoaded?: () => void): Promise<void> {
  // onLoaded is "fire-once when the map JUST became available". When already
  // loaded we return resolved promise WITHOUT invoking onLoaded — invoking it
  // creates an infinite microtask chain via installTimelineMetrics.
  if (pbgidMapLoaded) return Promise.resolve();
  if (!pbgidMapPromise) {
    pbgidMapPromise = (PBGID_MAP_URL ? fetch(PBGID_MAP_URL) : Promise.reject(new Error('no_runtime_url')))
      .then(r => r.ok ? r.json() as Promise<PbgidMapResponse> : Promise.reject(new Error('http_' + r.status)))
      .then(json => {
        for (const [pbgid, entry] of Object.entries(json.units || {})) pbgidUnitsMap.set(Number(pbgid), entry);
        for (const [pbgid, entry] of Object.entries(json.technologies || {})) pbgidTechsMap.set(Number(pbgid), entry);
        for (const [pbgid, entry] of Object.entries(json.upgrades || {})) pbgidUpgradesMap.set(Number(pbgid), entry);
        // Only mark loaded on success — null promise on failure so next caller retries.
        pbgidMapLoaded = true;
      })
      .catch((err: unknown) => {
        const error = err as { message?: unknown };
        console.warn('[aoe4-charts] pbgid-map load failed; will retry on next call:', error.message || err);
        pbgidMapPromise = null;
      });
  }
  if (typeof onLoaded === 'function') {
    pbgidMapPromise.then(() => { if (pbgidMapLoaded) onLoaded(); });
  }
  return pbgidMapPromise;
}

export function resolveUnitByPbgid(pbgid: number | null | undefined): PbgidEntry | null {
  if (!pbgid) return null;
  return pbgidUnitsMap.get(Number(pbgid)) || null;
}

export function resolveTechByPbgid(pbgid: number | null | undefined): PbgidEntry | null {
  if (!pbgid) return null;
  return pbgidTechsMap.get(Number(pbgid)) || null;
}

export function resolveUpgradeByPbgid(pbgid: number | null | undefined): PbgidEntry | null {
  if (!pbgid) return null;
  return pbgidUpgradesMap.get(Number(pbgid)) || null;
}
