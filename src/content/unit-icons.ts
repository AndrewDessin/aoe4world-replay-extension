import type { UnitIconTarget } from './types.ts';

interface UnitIconCacheEntry {
  status: 'pending' | 'loaded' | 'failed';
  url?: string;
  candidates?: string[];
  index?: number;
  candidateCount?: number;
}

interface AreaIconImageEntry {
  img: HTMLImageElement;
  loaded: boolean;
}

const unitIconCache: Map<string, UnitIconCacheEntry> = new Map();
const areaIconImageCache: Map<string, AreaIconImageEntry> = new Map();
const unitIconDomExactSources: Map<string, string> = new Map();
const unitIconDomSources: Map<string, string> = new Map();
const unitDisplayNameExactSources: Map<string, string> = new Map();
const unitDisplayNameSources: Map<string, string> = new Map();

export function clearUnitDisplayNameCaches(): void {
  unitDisplayNameExactSources.clear();
  unitDisplayNameSources.clear();
}

export function cleanUnitDisplayName(value: string | null | undefined): string {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  return name && !/^\d+(?:-\d+)?$/.test(name) ? name : '';
}

export function unitIconSlugFromUrl(url: string | null | undefined, stripAge = true): string {
  const path = String(url || '').split('?')[0].split('#')[0];
  const filename = decodeURIComponent(path.split('/').pop() || '').toLowerCase();
  const stem = filename.replace(/\.png$/i, '');
  return stripAge ? stem.replace(/-\d+$/i, '') : stem;
}

export function unitIconCacheKey(unit: UnitIconTarget | null | undefined): string {
  return (unit?.iconCandidates || unit?.iconUrl || unit?.icon || unit?.label || '').toString();
}

export function loadAreaIcon(url: string): AreaIconImageEntry {
  const cached = areaIconImageCache.get(url);
  if (cached) return cached;
  const entry: AreaIconImageEntry = { img: new Image(), loaded: false };
  entry.img.crossOrigin = 'anonymous';
  entry.img.onload = () => { entry.loaded = true; };
  entry.img.onerror = () => { entry.loaded = false; };
  entry.img.src = url;
  areaIconImageCache.set(url, entry);
  return entry;
}

export function unitIconImage(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'aoe4-army-unit-icon';
  img.alt = '';
  img.loading = 'lazy';
  img.src = url;
  return img;
}

export function unitIconPlaceholder(key: string): HTMLSpanElement {
  const empty = document.createElement('span');
  empty.className = 'aoe4-army-unit-icon aoe4-army-unit-icon-placeholder';
  if (key) empty.dataset.unitIconKey = key;
  return empty;
}

export function replaceUnitIconPlaceholders(key: string, url: string): void {
  for (const node of document.querySelectorAll<HTMLElement>('.aoe4-army-unit-icon-placeholder')) {
    if (node.dataset.unitIconKey !== key) continue;
    node.replaceWith(unitIconImage(url));
  }
}

let _lastDomSeedTime = 0;
export function seedUnitIconCacheFromDom(): void {
  // Throttle to 1Hz — called from per-frame hot paths.
  const now = performance.now();
  if (now - _lastDomSeedTime < 1000) return;
  _lastDomSeedTime = now;
  for (const image of document.querySelectorAll<HTMLImageElement>('build-order img[src], build-order img[srcset], img[src*="/images/units/"]')) {
    const url = image.currentSrc || image.src;
    if (!url) continue;
    const exact = unitIconSlugFromUrl(url, false);
    const slug = unitIconSlugFromUrl(url, true);
    if (exact) unitIconDomExactSources.set(exact, url);
    if (slug) unitIconDomSources.set(slug, url);
    const displayName = cleanUnitDisplayName(image.title || image.alt);
    if (displayName) {
      if (exact) unitDisplayNameExactSources.set(exact, displayName);
      if (slug) unitDisplayNameSources.set(slug, displayName);
    }
  }
}

export function resolveLoadedUnitIconFromDom(candidates: string[]): string {
  for (const candidate of candidates) {
    const exactUrl = unitIconDomExactSources.get(unitIconSlugFromUrl(candidate, false));
    if (exactUrl) return exactUrl;
  }
  for (const candidate of candidates) {
    const fallbackUrl = unitIconDomSources.get(unitIconSlugFromUrl(candidate, true));
    if (fallbackUrl) return fallbackUrl;
  }
  return '';
}

export function resolveLoadedUnitDisplayNameFromDom(candidates: string[]): string {
  seedUnitIconCacheFromDom();
  for (const candidate of candidates) {
    const exactName = unitDisplayNameExactSources.get(unitIconSlugFromUrl(candidate, false));
    if (exactName) return exactName;
  }
  for (const candidate of candidates) {
    const fallbackName = unitDisplayNameSources.get(unitIconSlugFromUrl(candidate, true));
    if (fallbackName) return fallbackName;
  }
  return '';
}

// Tries each candidate URL; swaps placeholder spans for <img> on first success.
function loadNextUnitIcon(key: string): void {
  const entry = unitIconCache.get(key);
  if (!entry || entry.status !== 'pending' || !entry.candidates) return;
  const url = entry.candidates[entry.index || 0];
  entry.index = (entry.index || 0) + 1;
  if (!url) {
    entry.status = 'failed';
    entry.candidateCount = entry.candidates.length;
    return;
  }
  const image = new Image();
  image.onload = () => {
    entry.status = 'loaded';
    entry.url = url;
    replaceUnitIconPlaceholders(key, url);
  };
  image.onerror = () => loadNextUnitIcon(key);
  image.src = url;
}

export function resolveUnitIconUrl(unit: UnitIconTarget | null | undefined, key = unitIconCacheKey(unit)): string {
  const candidates = unit?.iconCandidates || (unit?.iconUrl ? [unit.iconUrl] : []);
  if (!candidates.length) return '';
  const cached = unitIconCache.get(key);
  if (cached?.status === 'loaded') return cached.url || '';
  if (cached?.status === 'pending') return '';
  if (cached?.status === 'failed' && cached.candidateCount === candidates.length) return '';
  seedUnitIconCacheFromDom();
  const domUrl = resolveLoadedUnitIconFromDom(candidates);
  if (domUrl) {
    unitIconCache.set(key, { status: 'loaded', url: domUrl });
    return domUrl;
  }
  // Async CDN probe; placeholder spans are swapped on success.
  unitIconCache.set(key, { status: 'pending', candidates: [...candidates], index: 0 });
  loadNextUnitIcon(key);
  return '';
}

export function armyIconElement(unit: UnitIconTarget | null | undefined): HTMLElement {
  const key = unitIconCacheKey(unit);
  const url = resolveUnitIconUrl(unit, key);
  if (!url) return unitIconPlaceholder(key);
  return unitIconImage(url);
}

// Re-resolve display name from DOM each render; build-order images load async.
export function resolveCurrentUnitName(item: UnitIconTarget | null | undefined): string {
  if (!item) return '';
  const fromDom = resolveLoadedUnitDisplayNameFromDom(item.iconCandidates || []);
  if (fromDom) return fromDom;
  return item.unitLabel || item.label || '';
}
