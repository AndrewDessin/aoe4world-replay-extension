// --- Cache (chrome.storage.local, 24h TTL for hits, permanent for old patch misses) ---
const CACHE_TTL = 24 * 60 * 60 * 1000;
const pendingChecks = new Map();

async function getCached(gameId) {
  try {
    const key = 'replay_' + gameId;
    const result = await chrome.storage.local.get(key);
    const entry = result[key];
    if (!entry) return undefined;
    
    // If we have a patch, evaluate against current known patches
    if (entry.patch && entry.value) {
      const patchResp = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'getCurrentPatch' }, resp => resolve(resp));
      });
    const curPatch = patchResp?.patch;
    if (curPatch) {
      if (entry.patch === curPatch) return { available: true, prevPatch: false };
      // Check if it's the previous patch (knownPatches[1])
      const patches = patchResp?.patches || [];
      const prevPatch = patches[1] || null;
      if (prevPatch && entry.patch === prevPatch) return { available: true, prevPatch: true };
      // 2+ behind
      return { available: false, prevPatch: false };
    }
  }
  
  if (entry.permanent) {
    return entry.value ? { available: true, prevPatch: false } : { available: false, prevPatch: false };
  }
  if (Date.now() - entry.time > CACHE_TTL) {
    chrome.storage.local.remove(key);
    return undefined;
  }
  if (entry.value === true) return { available: true, prevPatch: false };
  if (entry.value === 'prev') return { available: true, prevPatch: true };
  return { available: false, prevPatch: false };
  } catch (e) {
    // Extension context invalidated (e.g. after idle/reload)
    return undefined;
  }
}

function setCache(gameId, available, permanent = false, patch = null) {
  try {
    const key = 'replay_' + gameId;
    chrome.storage.local.set({ [key]: { value: available, time: Date.now(), permanent, patch } });
  } catch (e) { /* context invalidated */ }
}

// Batched check with dedup — collects IDs for 100ms then fires one request
let batchQueue = [];
let batchTimer = null;

async function checkReplay(gameId) {
  // Favorited games — check patch for warning
  const favResp = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'isFavorite', matchId: gameId }, resp => resolve(resp));
  });
  if (favResp?.isFavorite) {
    const patchResp = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'getCurrentPatch' }, resp => resolve(resp));
    });
    const curPatch = patchResp?.patch;
    const isPrev = curPatch && favResp.patch && favResp.patch !== curPatch;
    return { available: true, prevPatch: isPrev };
  }

  const cached = await getCached(gameId);
  if (cached !== undefined) return cached;

  return new Promise(resolve => {
    if (pendingChecks.has(gameId)) {
      pendingChecks.get(gameId).push(resolve);
      return;
    }
    pendingChecks.set(gameId, [resolve]);
    batchQueue.push(gameId);
    scheduleBatch();
  });
}

let batchRunning = false;

function scheduleBatch() {
  if (batchRunning) return;
  if (batchTimer) clearTimeout(batchTimer);
  console.log(`[replay] Scheduling batch in 500ms (queue: ${batchQueue.length})`);
  batchTimer = setTimeout(runBatch, 500);
}

async function runBatch() {
  batchTimer = null;
  if (batchRunning) return;
  batchRunning = true;
  console.log(`[replay] Batch starting (queue: ${batchQueue.length})`);

  while (batchQueue.length > 0) {
    const batch = [...new Set(batchQueue.splice(0, 10))];
    console.log(`[replay] Sending batch of ${batch.length}, remaining: ${batchQueue.length}`);

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'checkReplays', gameIds: batch }, r => resolve(r));
      });

      if (resp?.rateLimited) {
        batchQueue.unshift(...batch);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const available = resp?.available || {};
      const gamePatches = resp?.gamePatches || {};
      
      for (const id of batch) {
        const has = !!available[id];
        const gamePatch = gamePatches[id] || null;
        
        // Store with patch — classification happens at read time in getCached
        if (has) {
          setCache(id, true, false, gamePatch);
        }
        
        // Build result for immediate display
        let result = { available: false, prevPatch: false };
        if (has) {
          const curPatch = resp?.currentPatch || null;
          const patches = resp?.knownPatches || [];
          const prevPatch = patches[1] || null;
          
          if (!curPatch || !gamePatch || gamePatch === curPatch) {
            result = { available: true, prevPatch: false };
          } else if (prevPatch && gamePatch === prevPatch) {
            result = { available: true, prevPatch: true };
          } else {
            // 2+ behind — record cutoff date
            result = { available: false, prevPatch: false };
            const row = document.querySelector(`[data-game-id="${id}"]`);
            if (row) {
              const ts = getGameTimestamp(row);
              if (ts && (!oldPatchCutoffDate || ts > oldPatchCutoffDate)) {
                oldPatchCutoffDate = ts;
                console.log(`[replay] Old patch cutoff set: ${oldPatchCutoffDate}`);
              }
            }
          }
        }
        
        const cbs = pendingChecks.get(id) || [];
        pendingChecks.delete(id);
        cbs.forEach(cb => cb(result));
      }
    } catch (e) {
      for (const id of batch) {
        const cbs = pendingChecks.get(id) || [];
        pendingChecks.delete(id);
        cbs.forEach(cb => cb(false));
      }
    }

    if (batchQueue.length > 0) {
      console.log(`[replay] Waiting 5s before next batch (remaining: ${batchQueue.length})`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('[replay] Batch complete');
  batchRunning = false;
}

// --- Extract game ID from URL ---
function getGameIdFromUrl(url) {
  const m = url.match(/\/players\/\d+(?:-[^/]+)?\/games\/(\d+)/);
  return m ? m[1] : null;
}

function getGameIdFromRow(row) {
  return row.dataset?.gameId || null;
}

// --- Create the replay link (no star — star is separate on game detail page) ---
function createReplayDiv(gameId, prevPatch = false) {
  const div = document.createElement('div');
  div.className = 'aoe4-replay-btn text-gray-200 mt-0';
  div.dataset.gameId = gameId;

  const link = document.createElement('a');
  link.className = 'hover:underline hover:text-white';
  link.href = '#';
  
  if (prevPatch) {
    link.title = 'Download and launch this replay in AoE4';
    link.innerHTML = 'Watch Replay <i class="fas fa-play text-xs ml-1 text-green-500" aria-hidden="true"></i> <span class="aoe4-patch-warn" title="This replay is from a previous patch. To watch it, switch to the older branch in Steam: right-click AoE4 → Properties → Betas → select the previous version." style="cursor:help;color:#ffd43b;margin-left:4px;">&#9888;</span>';
  } else {
    link.title = 'Download and launch this replay in AoE4';
    link.innerHTML = 'Watch Replay <i class="fas fa-play text-xs ml-1 text-green-500" aria-hidden="true"></i>';
  }

  link.addEventListener('click', handleWatchClick(gameId, link));
  div.appendChild(link);
  return div;
}

function scrapeGameMeta(gameId) {
  const row = document.querySelector(`[data-game-id="${gameId}"]`);
  const gameLink = row?.querySelector('a[href*="/games/"]');
  const pageUrl = gameLink ? 'https://aoe4world.com' + gameLink.getAttribute('href') : window.location.href;
  if (!row) return { gameId, pageUrl };
  const map = row.querySelector('h3')?.textContent?.trim() || '';
  const mode = row.querySelector('[class*="text-sm"]')?.textContent?.trim() || '';
  
  // Scrape teams separately
  const teamEl = row.querySelector('[aria-label="Team"]');
  const opponentEl = row.querySelector('[aria-label="Opponent Team"]');
  const team1 = teamEl ? [...teamEl.querySelectorAll('a[href*="/players/"]')].map(a => a.textContent.trim()).filter(Boolean) : [];
  const team2 = opponentEl ? [...opponentEl.querySelectorAll('a[href*="/players/"]')].map(a => a.textContent.trim()).filter(Boolean) : [];
  
  // Fallback: all player links if team elements not found
  const players = (team1.length || team2.length) ? null : 
    [...row.querySelectorAll('a[href*="/players/"]')].map(a => a.textContent.trim()).filter(Boolean);
  
  return { gameId, map, mode, team1, team2, players, pageUrl };
}

function handleWatchClick(gameId, link) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    link.textContent = 'Launching...';
    link.style.pointerEvents = 'none';

    chrome.runtime.sendMessage({ type: 'launchReplay', matchId: gameId }, resp => {
      if (resp?.needsInstall) {
        // Show install prompt — stays until clicked
        link.innerHTML = 'Install launcher first <i class="fas fa-download text-xs ml-1" aria-hidden="true"></i>';
        link.className = 'text-red-400 hover:underline';
        link.style.pointerEvents = '';
        link.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.open('https://github.com/spartain-aoe/aoe4world-replay-extension/releases/latest', '_blank');
          // After opening install page, prompt to retry
          link.innerHTML = 'Retry <i class="fas fa-redo text-xs ml-1" aria-hidden="true"></i>';
          link.className = 'text-yellow-400 hover:underline';
          link.onclick = (ev2) => {
            ev2.preventDefault();
            ev2.stopPropagation();
            // Try launching again
            link.textContent = 'Launching...';
            link.style.pointerEvents = 'none';
            chrome.runtime.sendMessage({ type: 'launchReplay', matchId: gameId }, resp2 => {
              if (resp2?.success) {
                link.innerHTML = 'Launched! <i class="fas fa-check text-xs ml-1 text-green-500"></i>';
                link.className = 'hover:underline hover:text-white';
                setTimeout(() => {
                  link.innerHTML = 'Watch Replay <i class="fas fa-play text-xs ml-1 text-green-500" aria-hidden="true"></i>';
                  link.style.pointerEvents = '';
                }, 5000);
              } else {
                link.innerHTML = 'Install launcher first <i class="fas fa-download text-xs ml-1" aria-hidden="true"></i>';
                link.className = 'text-red-400 hover:underline';
                link.style.pointerEvents = '';
              }
            });
          };
        };
      } else if (resp?.success) {
        link.innerHTML = 'Launched! <i class="fas fa-check text-xs ml-1 text-green-500"></i>';
        link.className = 'hover:underline hover:text-white';
        setTimeout(() => {
          link.innerHTML = 'Watch Replay <i class="fas fa-play text-xs ml-1 text-green-500" aria-hidden="true"></i>';
          link.style.pointerEvents = '';
        }, 5000);
      } else {
        const errMsg = resp?.error || 'unknown';
        const friendly = errMsg.includes('No replay') ? 'Replay no longer available' : 'Error: ' + errMsg;
        link.textContent = friendly;
        setTimeout(() => {
          link.innerHTML = 'Watch Replay <i class="fas fa-play text-xs ml-1 text-green-500" aria-hidden="true"></i>';
          link.className = 'hover:underline hover:text-white';
          link.style.pointerEvents = '';
        }, 5000);
      }
    });
  };
}

function createLoadingDiv(gameId) {
  const div = document.createElement('div');
  div.className = 'aoe4-replay-loading text-gray-400 text-sm mt-0';
  div.dataset.gameId = gameId;
  div.textContent = '.';
  // Animate ellipsis
  let dots = 1;
  div._interval = setInterval(() => {
    dots = (dots % 3) + 1;
    div.textContent = '.'.repeat(dots);
  }, 400);
  return div;
}

function removeLoading(el) {
  if (el._interval) clearInterval(el._interval);
  el.remove();
}

// --- Find the anchor point in a game row (the date/summary cell) ---
function findAnchor(row) {
  // Game list rows: <a> with "View Summary" text, or <a> with date-only (game detail page)
  const dateCell = row.querySelector('a[role="cell"]');
  return dateCell || null;
}

// --- Process a single game row ---
let knownCurrentPatch = null;

async function getKnownPatch() {
  if (knownCurrentPatch) return knownCurrentPatch;
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'getCurrentPatch' }, resp => {
      knownCurrentPatch = resp?.patch || null;
      resolve(knownCurrentPatch);
    });
  });
}

let oldPatchCutoffDate = null; // ISO date string — games at or before this are too old

function getGameTimestamp(row) {
  // The date element has a title like "2026-04-24 02:32:47 UTC"
  const dateEl = row.querySelector('[title*="UTC"]');
  return dateEl?.getAttribute('title') || null;
}

function getGameDateText(row) {
  const dateEl = row.querySelector('[aria-label="Game Date"], [title*="UTC"]');
  return dateEl?.textContent?.trim()?.toLowerCase() || '';
}

function processRow(row) {
  const gameId = getGameIdFromRow(row);
  if (!gameId) return;
  if (row.querySelector('.aoe4-replay-btn, .aoe4-replay-loading')) return;

  const anchor = findAnchor(row);
  if (!anchor) return;

  // Skip games older than the known N+2 cutoff
  if (oldPatchCutoffDate) {
    const gameDate = getGameTimestamp(row);
    if (gameDate && gameDate <= oldPatchCutoffDate) {
      return;
    }
  }

  // Skip very old games (years old — definitely stale patch)
  const dateText = getGameDateText(row);
  if (dateText.match(/year/)) {
    return;
  }

  const loading = createLoadingDiv(gameId);
  anchor.appendChild(loading);

  const timeout = setTimeout(() => removeLoading(loading), 60000);

  checkReplay(gameId).then(result => {
    clearTimeout(timeout);
    removeLoading(loading);
    if (result.available) {
      anchor.appendChild(createReplayDiv(gameId, result.prevPatch));
    }
  });
}

// --- IntersectionObserver for lazy loading ---
const seen = new WeakSet();
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const row = entry.target;
    io.unobserve(row);
    processRow(row);
  }
}, { rootMargin: '200px' });

function scanForRows() {
  const rows = document.querySelectorAll('[data-game-id]');
  for (const row of rows) {
    if (seen.has(row)) continue;
    seen.add(row);
    io.observe(row);
  }
  // On game detail page, add favorite star next to "Game #xxx" heading
  tryAddFavoriteStar();
}

function tryAddFavoriteStar() {
  // Only on game detail pages: URL like /players/{id}/games/{gameId}
  const gameId = getGameIdFromUrl(window.location.href);
  if (!gameId) return;
  if (document.querySelector('.aoe4-fav-star')) return;

  // Find the "Game #xxx" heading
  const headings = document.querySelectorAll('h2, h3');
  let gameHeading = null;
  for (const h of headings) {
    if (h.textContent.match(/Game\s*#/)) { gameHeading = h; break; }
  }
  if (!gameHeading) return;

  // Make heading flex so star can right-align
  gameHeading.style.display = 'flex';
  gameHeading.style.alignItems = 'center';

  const star = document.createElement('i');
  star.className = 'aoe4-fav-star far fa-star';
  star.style.cursor = 'pointer';
  star.style.fontSize = '20px';
  star.style.marginLeft = 'auto';
  star.style.color = '#6c757d';
  star.title = 'Save replay';

  // Check if already favorited
  chrome.runtime.sendMessage({ type: 'isFavorite', matchId: gameId }, resp => {
    if (resp?.isFavorite) {
      star.className = 'aoe4-fav-star fas fa-star';
      star.style.color = '#ffd43b';
      star.title = 'Remove from saved';
    }
  });

  star.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isSaved = star.classList.contains('fas');
    if (isSaved) {
      chrome.runtime.sendMessage({ type: 'removeFavorite', matchId: gameId }, resp => {
        if (resp?.success) {
          star.className = 'aoe4-fav-star far fa-star';
          star.style.color = '#6c757d';
          star.title = 'Save replay';
        }
      });
    } else {
      const meta = scrapeGameMeta(gameId);
      star.className = 'aoe4-fav-star fas fa-spinner fa-spin';
      star.style.color = '#6c757d';
      star.title = 'Saving...';
      chrome.runtime.sendMessage({ type: 'saveFavorite', matchId: gameId, meta }, resp => {
        if (resp?.success) {
          star.className = 'aoe4-fav-star fas fa-star';
          star.style.color = '#ffd43b';
          star.title = 'Remove from saved';
        } else {
          star.className = 'aoe4-fav-star far fa-star';
          star.style.color = '#6c757d';
          star.title = resp?.error || 'Save failed';
        }
      });
    }
  });

  gameHeading.appendChild(star);
}

// --- Sync star state when storage changes (e.g. from popup) ---
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('fav_')) continue;
    const gameId = key.slice(4);
    const star = document.querySelector(`.aoe4-fav-star`);
    if (!star) continue;
    const currentGameId = getGameIdFromUrl(window.location.href);
    if (currentGameId !== gameId) continue;
    
    if (change.newValue) {
      star.className = 'aoe4-fav-star fas fa-star';
      star.style.color = '#ffd43b';
      star.title = 'Remove from saved';
    } else {
      star.className = 'aoe4-fav-star far fa-star';
      star.style.color = '#6c757d';
      star.title = 'Save replay';
    }
  }
});

// --- SPA navigation watcher ---
let lastUrl = '';
const observer = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    setTimeout(scanForRows, 500);
  } else {
    scanForRows();
  }
});

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});

lastUrl = window.location.href;
setTimeout(scanForRows, 800);

