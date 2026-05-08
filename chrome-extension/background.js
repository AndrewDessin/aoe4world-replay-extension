import { extractPlayerColors, extractPlayerColorsStructural, setDebug as setParserDebug } from './replay-parser.js';

// ----- settings (synced from chrome.storage.local.settings) -----
const SETTINGS_DEFAULTS = Object.freeze({ recolorSwatches: false, injectCharts: true, debugLogs: false });
let SETTINGS = { ...SETTINGS_DEFAULTS };
let __settingsReadyResolve;
const settingsReady = new Promise(r => { __settingsReadyResolve = r; });
function applySettings(stored) {
  SETTINGS = { ...SETTINGS_DEFAULTS, ...(stored || {}) };
  setParserDebug(SETTINGS.debugLogs);
}
chrome.storage.local.get('settings', ({ settings }) => {
  applySettings(settings);
  __settingsReadyResolve();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  applySettings(changes.settings.newValue);
});
const dbg = (...args) => { if (SETTINGS.debugLogs) console.log(...args); };
const dbgWarn = (...args) => { if (SETTINGS.debugLogs) console.warn(...args); };

const REPLAY_API = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getReplayFiles';
const PATCH_API = 'https://aoe4world.com/api/v0/stats/rm_solo/civilizations';
const UA = 'AoE4ReplayLauncher-ChromeExt/0.4 (https://github.com/spartain-aoe/aoe4world-replay-extension, discord:591850595498065931)';

// Shared response parser for the WorldsEdge replay API. The endpoint can
// return HTML error pages (rate limits, outages, ad blockers redirecting,
// etc.) and parsing those as JSON yields confusing "Unexpected token '<'"
// errors that surface in user-facing tooltips. Fail with a clean message
// instead. Also tracks the exponential-backoff streak so consecutive 429s
// progressively widen the cooldown window and any 2xx clears it.
async function parseReplayApiJson(response, what = 'replay API') {
  if (response.status === 429) {
    recordBackoff(what);
    throw new Error('Rate limited');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${what}`);
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    try { await response.text(); } catch (_) {}
    throw new Error(`Non-JSON response from ${what} (likely an error page)`);
  }
  const json = await response.json();
  recordBackoffSuccess();
  return json;
}
const NATIVE_HOST = 'com.aoe4.replay_launcher';
const MAX_FAVORITES = 10;

const COLORS_CACHE_KEY_PREFIX = 'colors_v3_';
const COLORS_CACHE_LIMIT = 50;
const COLORS_NEGATIVE_TTL_MS = 60 * 60 * 1000; // 1 hour for permanent failures
// Shorter TTL for transient network failures (ad blockers, offline, blob 5xx)
// — long enough to stop quota-burn loops, short enough that recovery (e.g.
// user disables ad-blocker, network restored) is picked up automatically.
const COLORS_SOFT_FAILURE_TTL_MS = 10 * 60 * 1000;
const inFlightColorRequests = new Map();

// Exponential backoff for the WorldsEdge replay API. WorldsEdge typically
// rate-limits per-IP at ~120 req/min; a flat 5s retry happily lands inside
// the same window and burns more quota. Grow the cooldown 5s→10s→20s→40s→60s
// (cap) on consecutive 429s; reset to 0 on any successful response so
// transient blips don't permanently slow the user down.
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;
let backoffUntil = 0;
let backoffStreak = 0;
function recordBackoff(what = 'replay API') {
  backoffStreak++;
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, backoffStreak - 1), BACKOFF_MAX_MS);
  backoffUntil = Date.now() + delay;
  console.warn(`[replay] 429 from ${what} — backing off ${Math.round(delay / 1000)}s (streak ${backoffStreak})`);
  return delay;
}
function recordBackoffSuccess() {
  if (backoffStreak > 0) {
    dbg(`[replay] Backoff cleared after ${backoffStreak} 429(s)`);
    backoffStreak = 0;
  }
}
let currentPatch = null;
let knownPatches = []; // sorted descending — [current, previous, ...]

// Fetch current patch on startup and cache for 24h
async function ensureCurrentPatch() {
  if (currentPatch) return currentPatch;
  const cached = await chrome.storage.local.get('patchInfo');
  if (cached.patchInfo && Date.now() - cached.patchInfo.time < 24 * 60 * 60 * 1000) {
    currentPatch = cached.patchInfo.current;
    knownPatches = cached.patchInfo.patches || [];
    return currentPatch;
  }
  await refreshCurrentPatch();
  return currentPatch;
}

async function refreshCurrentPatch() {
  try {
    const r = await fetch(PATCH_API, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    const data = await r.json();
    const patches = String(data.patch).split(',').map(Number).filter(n => n > 0).sort((a, b) => b - a);
    if (patches.length > 0) {
      const oldPatch = currentPatch;
      currentPatch = patches[0];
      knownPatches = patches;
      chrome.storage.local.set({ patchInfo: { current: currentPatch, patches: knownPatches, time: Date.now() } });
      dbg(`[replay] Patches: ${knownPatches.join(', ')} (current: ${currentPatch})`);
    }
  } catch (e) {
    console.warn('[replay] Failed to fetch patch info:', e.message);
  }
}

function updatePatchFromUrl(url) {
  const m = url.match(/\/(\d{4,})\/M_/);
  if (m) {
    const patch = Number(m[1]);
    if (patch > (currentPatch || 0)) {
      currentPatch = patch;
      if (!knownPatches.includes(patch)) knownPatches.unshift(patch);
      knownPatches.sort((a, b) => b - a);
      chrome.storage.local.set({ patchInfo: { current: currentPatch, patches: knownPatches, time: Date.now() } });
      dbg(`[replay] Patch updated from replay URL: ${currentPatch}`);
    }
  }
}

// Defer noisy startup tasks until settings are loaded so the user's debug
// preference is honoured for the very first log line.
settingsReady.then(() => {
  ensureCurrentPatch();
});

// One-time cleanup of stale color cache entries from previous schema versions
// (e.g. v1 had a parser bug that produced null names + duplicate colors for
// some multiplayer games). Drop them so the new parser repopulates cleanly.
(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter(k =>
      k.startsWith('colors_') && !k.startsWith(COLORS_CACHE_KEY_PREFIX)
    );
    if (stale.length) {
      await chrome.storage.local.remove(stale);
      dbg(`[replay] Removed ${stale.length} stale color cache entries`);
    }
  } catch (e) {
    console.warn('[replay] Color cache cleanup failed:', e.message);
  }
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'checkReplays') {
    const now = Date.now();
    if (now < backoffUntil) {
      dbg(`[replay] Backoff active, skipping (${Math.round((backoffUntil-now)/1000)}s left)`);
      sendResponse({ available: {}, rateLimited: true });
      return true;
    }

    const ids = msg.gameIds.slice(0, 10);
    const url = `${REPLAY_API}?matchIDs=[${ids.join(',')}]&title=age4`;
    dbg(`[replay] Fetching ${ids.length} IDs: ${ids.join(',')}`);

    fetch(url, { headers: { 'User-Agent': UA } })
      .then(r => parseReplayApiJson(r, 'replay metadata'))
      .then(data => {
        const available = {};
        const gamePatches = {};
        if (data.result?.code === 0 && data.replayFiles) {
          for (const file of data.replayFiles) {
            if (file.datatype === 0 && file.size > 0) {
              available[file.matchhistory_id] = true;
            }
            if (file.url) {
              updatePatchFromUrl(file.url);
              const pm = file.url.match(/\/(\d{4,})\/M_/);
              if (pm) gamePatches[file.matchhistory_id] = Number(pm[1]);
            }
          }
        }
        dbg(`[replay] Got ${Object.keys(available).length} available out of ${ids.length}`);
        sendResponse({ available, gamePatches, currentPatch, knownPatches });
      })
      .catch(e => {
        console.warn('[replay] Error:', e.message);
        sendResponse({ available: {}, rateLimited: e.message.includes('Rate limited') });
      });

    return true;
  }

  if (msg.type === 'launchReplay') {
    // Check favorites first — use saved replay if available
    const favKey = 'fav_' + msg.matchId;
    chrome.storage.local.get(favKey, result => {
      const fav = result[favKey];
      if (fav?.replayData) {
        // Launch from saved replay — write via native host
        chrome.runtime.sendNativeMessage(NATIVE_HOST, {
          action: 'launchReplayData',
          matchId: msg.matchId,
          replayB64: fav.replayData
        }, response => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message, needsInstall: true });
          } else {
            sendResponse(response);
          }
        });
      } else {
        // Download fresh
        chrome.runtime.sendNativeMessage(NATIVE_HOST, {
          action: 'launchReplay',
          matchId: msg.matchId
        }, response => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message, needsInstall: true });
          } else {
            sendResponse(response);
          }
        });
      }
    });
    return true;
  }

  if (msg.type === 'saveFavorite') {
    // Honour the shared exponential backoff. Without this, clicking save
    // immediately after a checkReplays/getPlayerColors 429 would burn another
    // request inside the cooldown window and almost certainly hit 429 again.
    if (Date.now() < backoffUntil) {
      const remainMs = backoffUntil - Date.now();
      sendResponse({
        success: false,
        error: `Rate limited — try again in ${Math.ceil(remainMs / 1000)}s`,
        rateLimited: true,
      });
      return false;
    }
    // Download the replay and store it
    const url = `${REPLAY_API}?matchIDs=[${msg.matchId}]&title=age4`;
    
    chrome.storage.local.get(null, allData => {
      const favCount = Object.keys(allData).filter(k => k.startsWith('fav_')).length;
      if (favCount >= MAX_FAVORITES) {
        sendResponse({ success: false, error: `Maximum ${MAX_FAVORITES} favorites reached` });
        return;
      }

      fetch(url, { headers: { 'User-Agent': UA } })
        .then(r => parseReplayApiJson(r, 'replay metadata'))
        .then(data => {
          if (data.result?.code !== 0 || !data.replayFiles) throw new Error('No replay data');
          const file = data.replayFiles.find(f => f.datatype === 0 && f.size > 0);
          if (!file) throw new Error('No replay file');
          // Extract patch from URL
          const pm = file.url.match(/\/(\d{4,})\/M_/);
          const patch = pm ? Number(pm[1]) : null;
          return fetch(file.url).then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} downloading replay`);
            return { arrayBuffer: r.arrayBuffer(), patch };
          });
        })
        .then(async ({ arrayBuffer, patch }) => {
          const buf = await arrayBuffer;
          const b64 = arrayBufferToBase64(buf);
          const favKey = 'fav_' + msg.matchId;
          chrome.storage.local.set({
            [favKey]: {
              matchId: msg.matchId,
              meta: msg.meta || {},
              replayData: b64,
              patch,
              savedAt: Date.now()
            }
          }, () => {
            dbg(`[replay] Saved favorite ${msg.matchId} (${Math.round(b64.length/1024)}KB, patch ${patch})`);
            sendResponse({ success: true });
          });
        })
        .catch(e => {
          console.warn('[replay] Save failed:', e.message);
          sendResponse({ success: false, error: e.message });
        });
    });
    return true;
  }

  if (msg.type === 'removeFavorite') {
    chrome.storage.local.remove('fav_' + msg.matchId, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'getFavorites') {
    chrome.storage.local.get(null, allData => {
      const favs = {};
      for (const [key, val] of Object.entries(allData)) {
        if (key.startsWith('fav_')) {
          favs[key.slice(4)] = { meta: val.meta, savedAt: val.savedAt };
        }
      }
      sendResponse({ favorites: favs, count: Object.keys(favs).length, max: MAX_FAVORITES });
    });
    return true;
  }

  if (msg.type === 'isFavorite') {
    chrome.storage.local.get('fav_' + msg.matchId, result => {
      const fav = result['fav_' + msg.matchId];
      sendResponse({ isFavorite: !!fav, patch: fav?.patch || null });
    });
    return true;
  }

  if (msg.type === 'getCurrentPatch') {
    ensureCurrentPatch().then(() => {
      sendResponse({ patch: currentPatch || null, patches: knownPatches });
    });
    return true;
  }

  if (msg.type === 'getPlayerColors') {
    const matchId = String(msg.matchId);
    if (!matchId) { sendResponse({ success: false, error: 'matchId required' }); return false; }
    // Honour the recolor setting at the BG layer too — content.js also gates,
    // but a stale tab could still send the message after the user disabled
    // colors. Wait for settingsReady so the very first request can't sneak
    // past a disabled preference.
    settingsReady.then(() => {
      if (!SETTINGS.recolorSwatches) {
        sendResponse({ success: false, error: 'disabled', disabled: true });
        return;
      }
      handleGetPlayerColors(matchId)
        .then(payload => sendResponse(payload))
        .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    });
    return true;
  }

  if (msg.type === 'getUnitData') {
    // Gate behind injectCharts — content.js only requests unit data when
    // building the army-comp / build-order charts. A stale tab could still
    // fire after disable; respond cleanly without hitting GitHub.
    settingsReady.then(() => {
      if (!SETTINGS.injectCharts) {
        sendResponse({ success: false, error: 'disabled', disabled: true });
        return;
      }
      const slugs = Array.isArray(msg.civSlugs) ? msg.civSlugs : [];
      handleGetUnitData(slugs)
        .then(payload => sendResponse(payload))
        .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    });
    return true;
  }
});

// Per-civ unit data fetched from the aoe4world/data GitHub repo. Used by the
// content script to map API icon paths (e.g. "icons/races/abbasid/units/mameluke_3")
// to canonical display names (e.g. "Camel Rider") and CDN icon URLs. Cached for
// 7 days because game data changes infrequently and the index file is ~100KB/civ.
const UNIT_DATA_CACHE_PREFIX = 'unit_data_v2_';
const UNIT_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNIT_DATA_NEGATIVE_TTL_MS = 60 * 60 * 1000;
const inFlightUnitDataRequests = new Map();

async function handleGetUnitData(civSlugs) {
  const valid = [...new Set((civSlugs || []).filter(s => /^[a-z0-9_-]+$/i.test(String(s))))];
  if (!valid.length) return { success: true, units: {} };
  const results = await Promise.all(valid.map(slug => fetchOneCivUnits(slug).then(units => [slug, units], err => [slug, null])));
  const units = {};
  for (const [slug, data] of results) units[slug] = data || [];
  return { success: true, units };
}

async function fetchOneCivUnits(slug) {
  const cacheKey = UNIT_DATA_CACHE_PREFIX + slug;
  const cached = await chrome.storage.local.get(cacheKey);
  const entry = cached[cacheKey];
  if (entry?.units && Date.now() - entry.savedAt < UNIT_DATA_TTL_MS) return entry.units;
  if (entry?.failedAt && Date.now() - entry.failedAt < UNIT_DATA_NEGATIVE_TTL_MS) return null;
  if (inFlightUnitDataRequests.has(slug)) return inFlightUnitDataRequests.get(slug);
  const promise = (async () => {
    try {
      const url = `https://raw.githubusercontent.com/aoe4world/data/main/units/${slug}.json`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error(`http_${resp.status}`);
      const data = await resp.json();
      const raw = Array.isArray(data?.data) ? data.data : [];
      const slim = raw
        .filter(u => u && u.id && u.name)
        .map(u => ({
          id: u.id,
          baseId: u.baseId || '',
          name: u.name,
          age: u.age || 0,
          pbgid: u.pbgid || 0,
          attribName: u.attribName || '',
          icon: u.icon || '',
          classes: Array.isArray(u.classes) ? u.classes : [],
          costs: u.costs || null,
        }));
      await chrome.storage.local.set({ [cacheKey]: { units: slim, savedAt: Date.now() } });
      return slim;
    } catch (err) {
      await chrome.storage.local.set({ [cacheKey]: { failedAt: Date.now(), error: err?.message || String(err) } });
      return null;
    } finally {
      inFlightUnitDataRequests.delete(slug);
    }
  })();
  inFlightUnitDataRequests.set(slug, promise);
  return promise;
}

async function handleGetPlayerColors(matchId) {
  const cacheKey = COLORS_CACHE_KEY_PREFIX + matchId;
  const cached = await chrome.storage.local.get(cacheKey);
  const entry = cached[cacheKey];
  if (entry?.players) {
    return { success: true, players: entry.players, cached: true };
  }
  if (entry?.failedAt) {
    // Soft failures (network/blocked) expire in ~10 min so recovery is picked
    // up; permanent failures (4xx, parse errors) sit for ~1 h. Either way,
    // honouring the cache prevents quota-burn from repeatedly retrying a
    // request that won't succeed.
    const ttl = entry.softFailure ? COLORS_SOFT_FAILURE_TTL_MS : COLORS_NEGATIVE_TTL_MS;
    if (Date.now() - entry.failedAt < ttl) {
      return { success: false, error: entry.error || 'cached_failure', cached: true };
    }
  }

  if (inFlightColorRequests.has(matchId)) {
    return inFlightColorRequests.get(matchId);
  }
  const inflight = (async () => {
    try {
      if (Date.now() < backoffUntil) {
        return { success: false, error: 'rate_limited', rateLimited: true };
      }
      const players = await fetchAndParsePlayerColors(matchId);
      await storeColorEntry(cacheKey, { players, savedAt: Date.now() });
      return { success: true, players, cached: false };
    } catch (err) {
      const message = err?.message || String(err);
      if (message === 'rate_limited') {
        return { success: false, error: 'rate_limited', rateLimited: true };
      }
      if (isPermanentFailure(message)) {
        await storeColorEntry(cacheKey, { failedAt: Date.now(), error: message });
      } else if (isSoftFailure(message)) {
        // Cache transient failures briefly so an ad blocker / offline state
        // / temporary 5xx doesn't cause every subsequent page visit to
        // re-fire the metadata request.
        await storeColorEntry(cacheKey, { failedAt: Date.now(), error: message, softFailure: true });
      }
      return { success: false, error: message };
    }
  })();
  inFlightColorRequests.set(matchId, inflight);
  try {
    return await inflight;
  } finally {
    inFlightColorRequests.delete(matchId);
  }
}

function isPermanentFailure(message) {
  if (!message) return false;
  if (message === 'no_replay_file') return true;
  if (message === 'replay_api_no_data') return true;
  if (message.startsWith('parse_')) return true;
  if (/^replay_api_4\d\d$/.test(message)) return true;
  return false;
}

// Transient errors that we still want to cache briefly to avoid quota-burn
// loops: ad blockers (ERR_BLOCKED_BY_CLIENT surfaces as `Failed to fetch`),
// offline networks (`NetworkError`), Azure blob 5xx (`blob_fetch_5xx`), and
// our own "downloading replay" wrapper. We deliberately do NOT mark 429s as
// soft failures here — those are handled by the global `backoffUntil` gate
// instead, so a per-game cache entry would just delay the recovery once the
// backoff window expires.
function isSoftFailure(message) {
  if (!message) return false;
  if (/Failed to fetch/i.test(message)) return true;
  if (/NetworkError/i.test(message)) return true;
  if (/ERR_BLOCKED/i.test(message)) return true;
  if (/^blob_fetch_/.test(message)) return true;
  if (/HTTP \d+ downloading replay/i.test(message)) return true;
  return false;
}

async function fetchAndParsePlayerColors(matchId) {
  const apiUrl = `${REPLAY_API}?matchIDs=[${matchId}]&title=age4`;
  const apiResponse = await fetch(apiUrl, { headers: { 'User-Agent': UA } });
  // parseReplayApiJson handles 429/non-ok/non-JSON; remap to the granular
  // error codes this code path expects so the caller's permanent-failure
  // classifier still works.
  let data;
  try {
    data = await parseReplayApiJson(apiResponse, 'replay metadata');
  } catch (e) {
    if (e.message === 'Rate limited') throw new Error('rate_limited');
    const m = e.message.match(/HTTP (\d+)/);
    if (m) throw new Error(`replay_api_${m[1]}`);
    throw new Error('replay_api_no_data');
  }
  if (data.result?.code !== 0 || !Array.isArray(data.replayFiles)) {
    throw new Error('replay_api_no_data');
  }
  const replayFile = data.replayFiles.find(f => f.datatype === 0 && f.size > 0 && f.url);
  if (!replayFile) throw new Error('no_replay_file');
  if (replayFile.url) updatePatchFromUrl(replayFile.url);

  const blobResponse = await fetch(replayFile.url);
  if (!blobResponse.ok) throw new Error(`blob_fetch_${blobResponse.status}`);
  const arrayBuffer = await blobResponse.arrayBuffer();
  const result = await extractPlayerColors(arrayBuffer);

  // Shadow validation: run the structural parser alongside the heuristic one.
  // Log any disagreement so we can validate before flipping primary→structural.
  // Throws are caught and reported (heuristic remains authoritative until bake-in completes).
  // The inner function has its own try/catch for structural-parser errors; this
  // outer catch is for synchronous failures in the comparator itself.
  // See chrome-extension/docs/replayData.bt for the structural parser's spec.
  shadowValidateStructural(arrayBuffer, result, matchId).catch(err => {
    // outer-throw is a real bug in the comparator itself, not a parser
    // disagreement. Always-on so it surfaces if it ever fires.
    console.warn('[parse-shadow] outer threw', { matchId, error: err?.message || String(err) });
  });

  return result.players.map(p => ({
    slot: p.slot,
    name: p.name,
    civilization: p.civilization,
    playerId: p.playerId,
    color: p.color,
    colorName: p.colorName,
  }));
}

async function shadowValidateStructural(arrayBuffer, heuristicResult, matchId) {
  try {
    const structural = await extractPlayerColorsStructural(arrayBuffer);
    const agree = playersAgree(heuristicResult.players, structural.players);
    if (agree) {
      const stringDiffs = playersStringDiff(heuristicResult.players, structural.players);
      // Success-case "agrees" log fires on every successful parse — debug-only.
      // Disagreement is the actionable signal that ships always.
      dbg('[parse-shadow] structural agrees', {
        matchId,
        chunkVersion: heuristicResult.chunkVersion,
        playerCount: structural.players.length,
        warnings: structural.warnings,
        stringDiffs,
        diagnostic: structural.diagnostic,
      });
    } else {
      console.warn('[parse-shadow] structural ≠ heuristic', {
        matchId,
        chunkVersion: heuristicResult.chunkVersion,
        heuristic: heuristicResult.players.map(p => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
        structural: structural.players.map(p => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
        structuralWarnings: structural.warnings,
        structuralDiagnostic: structural.diagnostic,
      });
    }
  } catch (err) {
    console.warn('[parse-shadow] structural threw', {
      matchId,
      chunkVersion: heuristicResult.chunkVersion,
      error: err?.message || String(err),
    });
  }
}

// Shadow-validation comparator. The heuristic returns slots in find-order
// (whichever player ID matched first); the structural parser returns slots in
// true file order. So compare as a SET keyed by `playerId` (the strongest
// discriminator), and verify color matches after lookup. We don't include
// color in the Map key because that would let one parser's wrong-color slot
// "agree" with itself if the other parser drops the matching playerId entry.
//
// Names and civilizations are compared advisorily (string equality after
// nullish-normalize) and a string-only mismatch is logged but doesn't trip
// disagreement — the heuristic's UTF-16 walkback occasionally picks up an
// adjacent garbage code unit for emoji-heavy names which is structurally
// equivalent to the right name but not byte-exact.
//
// IMPORTANT: slots with null/missing playerId on EITHER side are counted in
// `sentinelDrops` and trip disagreement if either side has them and the
// counts don't match. This catches the case where one parser fails playerId
// extraction and the other succeeds (a real defect we want to surface).
function playersAgree(heuristic, structural) {
  if (!Array.isArray(heuristic) || !Array.isArray(structural)) return false;
  if (heuristic.length !== structural.length) return false;
  const norm = (s) => (s == null ? null : String(s));
  const h = new Map();
  let hNullCount = 0;
  for (const p of heuristic) {
    const key = norm(p.playerId);
    if (key == null) { hNullCount++; continue; }
    if (h.has(key)) return false; // duplicate playerId on heuristic side is itself a disagreement signal
    h.set(key, p);
  }
  const s = new Map();
  let sNullCount = 0;
  for (const p of structural) {
    const key = norm(p.playerId);
    if (key == null) { sNullCount++; continue; }
    if (s.has(key)) return false;
    s.set(key, p);
  }
  // If one side dropped a playerId that the other resolved, that's a real
  // disagreement worth surfacing (rather than silently equal-by-omission).
  if (hNullCount !== sNullCount) return false;
  if (h.size !== s.size) return false;
  for (const [pid, sp] of s) {
    const hp = h.get(pid);
    if (!hp) return false;
    if (sp.color !== hp.color) return false;
  }
  return true;
}

// Detail string-only differences for shadow logging — non-fatal but worth
// surfacing in the agreement log so we can spot heuristic walkback noise.
function playersStringDiff(heuristic, structural) {
  const diffs = [];
  const norm = (s) => (s == null ? null : String(s));
  const sByPid = new Map(structural.filter(p => p.playerId).map(p => [norm(p.playerId), p]));
  for (const hp of heuristic) {
    const sp = sByPid.get(norm(hp.playerId));
    if (!sp) continue;
    if ((hp.name ?? null) !== (sp.name ?? null)) diffs.push({ playerId: hp.playerId, field: 'name', heuristic: hp.name, structural: sp.name });
    if ((hp.civilization ?? null) !== (sp.civilization ?? null)) diffs.push({ playerId: hp.playerId, field: 'civilization', heuristic: hp.civilization, structural: sp.civilization });
  }
  return diffs;
}

async function storeColorEntry(cacheKey, value) {
  await chrome.storage.local.set({ [cacheKey]: value });
  await pruneColorCache();
}

async function pruneColorCache() {
  const all = await chrome.storage.local.get(null);
  const entries = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(COLORS_CACHE_KEY_PREFIX)) continue;
    const ts = value?.savedAt ?? value?.failedAt ?? 0;
    entries.push({ key, ts });
  }
  if (entries.length <= COLORS_CACHE_LIMIT) return;
  entries.sort((a, b) => a.ts - b.ts);
  const toRemove = entries.slice(0, entries.length - COLORS_CACHE_LIMIT).map(e => e.key);
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
