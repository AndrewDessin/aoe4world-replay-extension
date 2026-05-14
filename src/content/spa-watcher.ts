import { getGameIdFromUrl } from './dom.ts';
import { settingsReady } from './settings.ts';
import { scanGameRows } from './replay-button.ts';
import { tryAddFavoriteStar, setStarStateSaved, setStarStateUnsaved } from './favorites-star.ts';
import { tryAddSummaryCharts } from './chart-controller.ts';

function scanForRows(): void {
  scanGameRows();
  tryAddFavoriteStar();
  tryAddSummaryCharts();
}

chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('fav_')) continue;
    const gameId = key.slice(4);
    if (getGameIdFromUrl(window.location.href) !== gameId) continue;

    const star = document.querySelector<HTMLElement>(`.aoe4-fav-star[data-aoe4-fav-game-id="${gameId}"]`);
    if (!star) continue;

    if (change.newValue) setStarStateSaved(star);
    else setStarStateUnsaved(star, undefined);
  }
});

let lastUrl = '';
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleScan(delayMs: number, replacePending = false): void {
  if (scanTimer) {
    if (!replacePending) return;
    clearTimeout(scanTimer);
  }
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanForRows();
  }, delayMs);
}

const observer = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    scheduleScan(500, true);
  } else {
    scheduleScan(0);
  }
});

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});

lastUrl = window.location.href;
settingsReady.then(() => scheduleScan(800));
