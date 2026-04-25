const REPLAY_API = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getReplayFiles';
const PATCH_API = 'https://aoe4world.com/api/v0/stats/rm_solo/civilizations';
const UA = 'AoE4ReplayLauncher-ChromeExt/0.3 (https://github.com/spartain-aoe/aoe4world-replay-extension, discord:591850595498065931)';
const NATIVE_HOST = 'com.aoe4.replay_launcher';
const MAX_FAVORITES = 10;

let backoffUntil = 0;
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
      console.log(`[replay] Patches: ${knownPatches.join(', ')} (current: ${currentPatch})`);
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
      console.log(`[replay] Patch updated from replay URL: ${currentPatch}`);
    }
  }
}

ensureCurrentPatch();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'checkReplays') {
    const now = Date.now();
    if (now < backoffUntil) {
      console.log(`[replay] Backoff active, skipping (${Math.round((backoffUntil-now)/1000)}s left)`);
      sendResponse({ available: {}, rateLimited: true });
      return true;
    }

    const ids = msg.gameIds.slice(0, 10);
    const url = `${REPLAY_API}?matchIDs=[${ids.join(',')}]&title=age4`;
    console.log(`[replay] Fetching ${ids.length} IDs: ${ids.join(',')}`);

    fetch(url, { headers: { 'User-Agent': UA } })
      .then(r => {
        if (r.status === 429) {
          backoffUntil = Date.now() + 5000;
          console.warn(`[replay] 429 — backing off 5s`);
          throw new Error('Rate limited');
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error(`Non-JSON response: ${ct}`);
        return r.json();
      })
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
        console.log(`[replay] Got ${Object.keys(available).length} available out of ${ids.length}`);
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
    // Download the replay and store it
    const url = `${REPLAY_API}?matchIDs=[${msg.matchId}]&title=age4`;
    
    chrome.storage.local.get(null, allData => {
      const favCount = Object.keys(allData).filter(k => k.startsWith('fav_')).length;
      if (favCount >= MAX_FAVORITES) {
        sendResponse({ success: false, error: `Maximum ${MAX_FAVORITES} favorites reached` });
        return;
      }

      fetch(url, { headers: { 'User-Agent': UA } })
        .then(r => r.json())
        .then(data => {
          if (data.result?.code !== 0 || !data.replayFiles) throw new Error('No replay data');
          const file = data.replayFiles.find(f => f.datatype === 0 && f.size > 0);
          if (!file) throw new Error('No replay file');
          // Extract patch from URL
          const pm = file.url.match(/\/(\d{4,})\/M_/);
          const patch = pm ? Number(pm[1]) : null;
          return fetch(file.url).then(r => ({ arrayBuffer: r.arrayBuffer(), patch }));
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
            console.log(`[replay] Saved favorite ${msg.matchId} (${Math.round(b64.length/1024)}KB, patch ${patch})`);
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
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
