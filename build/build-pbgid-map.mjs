#!/usr/bin/env node
// Build a slim pbgid → {name, family-id, icon-url} index that the extension
// bundles. Replaces the runtime heuristic stack (icon-slug regex + per-civ JSON
// + DOM scrape) for canonical unit name and icon resolution.
//
// Source of truth: aoe4world/data repo's pre-aggregated all-optimized files
// (215 unit families, ~980 unit pbgids, ~84KB; 449 tech families, ~1700 tech
// pbgids, ~85KB). One file per type fetched at build time, slimmed to only
// the keys the extension consumes (n=display name, k=family id / merge key,
// i=canonical CDN icon URL).
//
// Run: `node build/build-pbgid-map.mjs`. CI does this before zipping the
// extension so every release ships fresh data. On upstream fetch failure
// (network outage, GitHub down, schema rename) the script keeps the existing
// committed `chrome-extension/data/pbgid-map.json` so releases aren't blocked
// by external availability. Pass `--strict` to fail-fast instead.

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCES = [
  {
    type: 'units',
    url: 'https://raw.githubusercontent.com/aoe4world/data/main/units/all-optimized.json',
    nameSource: 'family',
  },
  {
    type: 'technologies',
    url: 'https://raw.githubusercontent.com/aoe4world/data/main/technologies/all-optimized.json',
    nameSource: 'family',
  },
  {
    // Unit-tier upgrades like `hardened-samurai-2` (Samurai → Hardened Samurai)
    // and `veteran-royal-knights-3` (Royal Knight → Veteran Royal Knight). These
    // pbgids are NOT in the units or technologies all-optimized files at all,
    // and previously fell through to "titlecase the icon basename" which yielded
    // wrong names like "Lancer" or "Yumi Ashigaru Upgrade 3". Each variation
    // here has its own meaningful `id` (e.g. `hardened-samurai-2`) — use that
    // for display rather than the family name (which is "Upgrade to Hardened",
    // less useful as a tooltip).
    type: 'upgrades',
    url: 'https://raw.githubusercontent.com/aoe4world/data/main/upgrades/all-optimized.json',
    nameSource: 'variation',
  },
];

const COMMIT_API = 'https://api.github.com/repos/aoe4world/data/commits?path=';
const STRICT = process.argv.includes('--strict');

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Fetch ${url} failed: HTTP ${r.status}`);
  return r.json();
}

async function fetchHeadCommit(path) {
  // Best-effort latest commit for provenance. Skip on rate-limit.
  try {
    const arr = await fetchJson(`${COMMIT_API}${encodeURIComponent(path)}&per_page=1`);
    if (Array.isArray(arr) && arr[0]) return { sha: arr[0].sha, date: arr[0].commit?.author?.date };
  } catch {}
  return null;
}

// Build family-id → display-name index from units json. Used to derive
// upgrade display names from their base unit's canonical name (preserving
// punctuation like "Man-at-Arms", "Earl's Guard", "Knights or Lancers" that
// `titleCaseFromId` would lose).
function buildUnitFamilyNameIndex(unitsJson) {
  const data = Array.isArray(unitsJson) ? unitsJson : unitsJson?.data;
  if (!Array.isArray(data)) return new Map();
  const idx = new Map();
  for (const fam of data) {
    if (fam?.id && fam?.name) idx.set(fam.id, fam.name);
  }
  return idx;
}

// Map family-id prefix to canonical tier display word. Order matters — longest
// prefix first to avoid e.g. "elite-" greedily matching part of "elite-elite".
const TIER_PREFIXES = [
  ['hardened-', 'Hardened'],
  ['veteran-', 'Veteran'],
  ['elite-', 'Elite'],
  ['early-', 'Early'],
];

// Derive an upgrade's display name from its base unit's canonical name plus
// a tier prefix word (e.g. "Elite Man-at-Arms"). Falls back to titleCaseFromId
// when no base unit is known or no tier prefix matches.
function deriveUpgradeName(famId, baseUnitId, unitFamilyNameIndex, varId) {
  if (baseUnitId && unitFamilyNameIndex) {
    const baseName = unitFamilyNameIndex.get(baseUnitId);
    if (baseName) {
      for (const [prefix, word] of TIER_PREFIXES) {
        if (famId.startsWith(prefix)) return `${word} ${baseName}`;
      }
      // No tier prefix on family id (e.g. `upgrade-warrior-scout`) — return
      // the base unit name unprefixed; caller may override per-variation.
      return baseName;
    }
  }
  return titleCaseFromId(varId || famId);
}

function titleCaseFromId(id) {
  if (!id) return '';
  // Strip trailing tier suffix `-2`, `-3`, `-4` (and `_2/3/4` for safety).
  const base = String(id).replace(/[-_][234]$/, '');
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Build attribName → unit-family-id index from units json. Used as the FIRST
// strategy for upgrade base-unit derivation: many upgrades' attribName looks
// like `upgrade_unit_<class>_<tier>_<civ>`; stripping `upgrade_` sometimes
// yields the exact attribName of a unit family variation. When that succeeds
// we have a 100%-reliable upgrade→unit link. When it fails (the upgrade and
// unit use different internal class slots — e.g. samurai uses `manatarms`,
// zhuge-nu uses `crossbow` vs `crossbowman`), the family-id stripping
// strategy below kicks in.
function buildAttribNameToFamilyIndex(unitsJson) {
  const data = Array.isArray(unitsJson) ? unitsJson : unitsJson?.data;
  if (!Array.isArray(data)) return new Map();
  const idx = new Map();
  for (const fam of data) {
    if (!fam?.id) continue;
    for (const v of (fam.variations || [])) {
      if (v?.attribName) idx.set(v.attribName, fam.id);
    }
  }
  return idx;
}

// Build unit-family-id set for membership tests in the family-id stripping
// strategy. Also used for derived-id validation.
function buildUnitFamilyIdSet(unitsJson) {
  const data = Array.isArray(unitsJson) ? unitsJson : unitsJson?.data;
  if (!Array.isArray(data)) return new Set();
  return new Set(data.filter(f => f?.id).map(f => f.id));
}

// Hardcoded irregular pluralization + civ-specific name remappings. Verified
// to cover all current aoe4world upgrade families that don't reduce by simple
// `s$` removal or `men$ → man$` rules. Add new entries here when upstream
// introduces another irregular plural.
const UNIT_PLURAL_OVERRIDES = {
  'men-at-arms': 'man-at-arms',
  'gilded-men-at-arms': 'gilded-man-at-arms',
  'desert-raiders': 'desert-raider',
  'ghazi-raiders': 'ghazi-raider',
  'cataphracts': 'cataphract',
  'arbaletriers': 'arbaletrier',
  'keshiks': 'keshik',
  'landsknechte': 'landsknecht',
  'gilded-landsknechte': 'gilded-landsknecht',
  'earl-s-guard': 'earls-guard',
  'chevalier-confreres': 'chevalier-confrere',
  'genitours': 'genitour',
  'serjeants': 'serjeant',
  'templar-brothers': 'templar-brother',
  'musofadi': 'musofadi-warrior',
  'kanabo': 'kanabo-samurai',
  'raider-elephants': 'raider-elephant',
  // Imperial-age English upgrade transforms knight class to lancers; map to
  // knight as the most reasonable base (the chart will attach the dot to
  // English knight series).
  'knights-or-lancers': 'knight',
  // Mongol scout → warrior scout: family id is `upgrade-warrior-scout` (not
  // hardened/veteran/elite prefixed). Attach to warrior-scout series so the
  // dot lands on the unit it produces.
  'upgrade-warrior-scout': 'warrior-scout',
};

function singularizeUnitId(s, unitFamilyIdSet) {
  if (UNIT_PLURAL_OVERRIDES[s]) return UNIT_PLURAL_OVERRIDES[s];
  // word ending in `men` → `man` (spearmen→spearman, horsemen→horseman).
  let r = s.replace(/men$/, 'man');
  if (unitFamilyIdSet.has(r)) return r;
  // plural `s` removal (knights→knight, archers→archer, lancers→lancer).
  r = s.replace(/s$/, '');
  if (unitFamilyIdSet.has(r)) return r;
  // No change (samurai, zhuge-nu — unit family id matches stripped form).
  if (unitFamilyIdSet.has(s)) return s;
  return null;
}

// Derive base unit family id from upgrade family id. e.g.
//   `veteran-royal-knights` → strip prefix → `royal-knights` → singularize → `royal-knight`
//   `hardened-samurai`     → strip prefix → `samurai`        → no change   → `samurai`
//   `elite-zhuge-nu`       → strip prefix → `zhuge-nu`       → no change   → `zhuge-nu`
function deriveBaseFromFamilyId(famId, unitFamilyIdSet) {
  const stripped = String(famId || '').replace(/^(hardened|veteran|elite)-/, '');
  if (!stripped) return null;
  if (unitFamilyIdSet.has(stripped)) return stripped;
  return singularizeUnitId(stripped, unitFamilyIdSet);
}

function slimFamilies(json, opts = {}) {
  const {
    nameSource = 'family',
    baseUnitIndex = null,
    unitFamilyIdSet = null,
    unitFamilyNameIndex = null,
  } = opts;
  const data = Array.isArray(json) ? json : json?.data;
  if (!Array.isArray(data)) throw new Error('Unexpected payload shape (no data array)');
  const out = {};
  let families = 0;
  for (const fam of data) {
    if (!fam || typeof fam !== 'object') continue;
    families++;
    const familyEntry = {
      n: fam.name || fam.id || 'Unit',
      k: fam.id || (fam.name || '').toLowerCase().replace(/\s+/g, '-'),
      i: fam.icon || '',
    };
    // Pre-compute base unit id for upgrade families (same for all variations).
    let familyBaseUnit = null;
    if (nameSource === 'variation' && unitFamilyIdSet) {
      familyBaseUnit = deriveBaseFromFamilyId(fam.id, unitFamilyIdSet);
    }
    for (const v of (fam.variations || [])) {
      if (v && Number.isFinite(v.pbgid)) {
        let entry = familyEntry;
        if (nameSource === 'variation' && v.id) {
          // Strategy 1: try attribName-strip lookup (works for upgrades whose
          // internal slot name matches their target unit's slot, e.g. French
          // knights `upgrade_unit_knight_3_fre` → `unit_knight_3_fre`).
          let baseUnit = null;
          if (baseUnitIndex && v.attribName) {
            const stripped = String(v.attribName).replace(/^upgrade_/, '');
            baseUnit = baseUnitIndex.get(stripped);
          }
          // Strategy 2 fallback: family-id stripping with singularization.
          // Covers upgrades whose attribName uses a different slot than the
          // unit (e.g. samurai upgrade attribName is `upgrade_unit_manatarms_*`
          // but unit attribName is `unit_samurai_*`).
          if (!baseUnit) baseUnit = familyBaseUnit;
          // Build the display name from the base unit's canonical name +
          // tier prefix (preserves punctuation like "Man-at-Arms"). Falls
          // back to titleCaseFromId when no base unit resolves.
          const displayName = deriveUpgradeName(fam.id, baseUnit, unitFamilyNameIndex, v.id);
          entry = {
            n: displayName,
            k: fam.id || familyEntry.k,
            i: fam.icon || familyEntry.i,
          };
          if (baseUnit) entry.b = baseUnit;
        }
        const existing = out[v.pbgid];
        if (existing && existing !== entry) {
          if (existing.k !== entry.k || existing.b !== entry.b || existing.n !== entry.n) {
            console.warn(
              `⚠ Cross-family pbgid collision: ${v.pbgid} maps to {k:"${existing.k}",n:"${existing.n}"} and {k:"${entry.k}",n:"${entry.n}"} — keeping first`
            );
            continue;
          }
        }
        out[v.pbgid] = entry;
      }
    }
  }
  return { map: out, families, pbgids: Object.keys(out).length };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, '..', 'chrome-extension', 'data');
  const outPath = join(outDir, 'pbgid-map.json');
  await mkdir(outDir, { recursive: true });

  const result = {
    __version__: 1,
    fetchedAt: new Date().toISOString(),
    sources: {},
    units: {},
    technologies: {},
    upgrades: {},
  };

  let baseUnitIndex = null;
  let unitFamilyIdSet = null;
  let unitFamilyNameIndex = null;
  let fetchFailed = false;
  for (const src of SOURCES) {
    process.stdout.write(`Fetching ${src.type}…`);
    try {
      const json = await fetchJson(src.url);
      if (src.type === 'units') {
        baseUnitIndex = buildAttribNameToFamilyIndex(json);
        unitFamilyIdSet = buildUnitFamilyIdSet(json);
        unitFamilyNameIndex = buildUnitFamilyNameIndex(json);
      }
      const slimOpts = { nameSource: src.nameSource };
      if (src.type === 'upgrades') {
        slimOpts.baseUnitIndex = baseUnitIndex;
        slimOpts.unitFamilyIdSet = unitFamilyIdSet;
        slimOpts.unitFamilyNameIndex = unitFamilyNameIndex;
      }
      const { map, families, pbgids } = slimFamilies(json, slimOpts);
      result[src.type] = map;
      const commit = await fetchHeadCommit(src.url.replace('https://raw.githubusercontent.com/aoe4world/data/main/', ''));
      result.sources[src.type] = { url: src.url, families, pbgids, commit };
      let baseStat = '';
      if (src.type === 'upgrades') {
        const withBase = Object.values(map).filter(e => e.b).length;
        baseStat = `, ${withBase} with base unit`;
      }
      console.log(` ${families} families, ${pbgids} pbgids${baseStat}`);
    } catch (err) {
      console.log(` FAILED (${err.message})`);
      fetchFailed = true;
      if (STRICT) throw err;
    }
  }

  if (fetchFailed) {
    // Reuse the committed bundle so releases aren't blocked by transient
    // upstream outage. Loud warning so it shows up in CI logs.
    let existingBytes;
    try { existingBytes = (await stat(outPath)).size; } catch { existingBytes = 0; }
    if (existingBytes > 0) {
      console.warn(`\n⚠ Upstream fetch failed; reusing existing bundle at ${outPath} (${existingBytes.toLocaleString()} bytes).`);
      console.warn('  Bundled data may be stale. Re-run when upstream is available, or pass --strict to fail-fast.');
      return;
    }
    throw new Error('Upstream fetch failed AND no existing bundle to reuse.');
  }

  // Cross-source pbgid collision guard. Today there are zero overlaps between
  // units / technologies / upgrades, but the runtime resolver tiers in
  // unitLabel/unitIconCandidates would silently route a colliding pbgid to
  // the FIRST tier that hits — which would re-introduce wrong-name bugs of
  // exactly the class this build is trying to fix. Fail-fast so any future
  // upstream rename is caught at build time, not in the field.
  const sourceKeys = ['units', 'technologies', 'upgrades'];
  const seen = new Map(); // pbgid → source name
  for (const src of sourceKeys) {
    for (const pbgid of Object.keys(result[src] || {})) {
      const prior = seen.get(pbgid);
      if (prior && prior !== src) {
        throw new Error(
          `Cross-source pbgid collision: ${pbgid} present in both "${prior}" and "${src}"`
        );
      }
      seen.set(pbgid, src);
    }
  }

  // Compact JSON; gzipped over the wire by Chrome on resource load anyway,
  // and ~210KB is well under web-store size limits.
  await writeFile(outPath, JSON.stringify(result) + '\n', 'utf8');
  const bytes = (await import('node:fs')).statSync(outPath).size;
  console.log(`Wrote ${outPath} (${bytes.toLocaleString()} bytes)`);
}

main().catch(err => {
  console.error('build-pbgid-map failed:', err);
  process.exit(1);
});
