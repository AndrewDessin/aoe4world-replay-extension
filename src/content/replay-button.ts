import { findAnchor, getGameIdFromUrl } from './dom.ts';
import { checkReplay, getGameDateText } from './replay-availability.ts';
import type { ReplayAvailabilityResult } from './types.ts';
import { SUMMARY_REPLAY_OVERRIDE_KEY } from '../shared/storage-keys.ts';

interface LaunchReplayResponse {
  needsInstall?: boolean;
  success?: boolean;
  error?: string;
}

type LoadingDiv = HTMLDivElement & {
  _interval?: ReturnType<typeof setInterval>;
};

let allowSummaryHiddenReplays = false;
let scrollScanTimer: ReturnType<typeof setTimeout> | null = null;

chrome.storage.local.get(SUMMARY_REPLAY_OVERRIDE_KEY, (result: Record<string, unknown>) => {
  allowSummaryHiddenReplays = result[SUMMARY_REPLAY_OVERRIDE_KEY] === true;
  if (allowSummaryHiddenReplays) scanGameRows(true);
});

chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area !== 'local') return;
  const change = changes[SUMMARY_REPLAY_OVERRIDE_KEY];
  if (!change || change.newValue !== true) return;
  allowSummaryHiddenReplays = true;
  scanGameRows(true);
});

window.addEventListener('scroll', () => {
  if (scrollScanTimer) return;
  scrollScanTimer = setTimeout(() => {
    scrollScanTimer = null;
    scanGameRows();
  }, 100);
}, { passive: true });

function getGameIdFromRow(row: HTMLElement): string | null {
  return row.dataset?.gameId || null;
}

function createReplayDiv(gameId: string, prevPatch = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'aoe4-replay-btn text-gray-200 mt-0';
  div.dataset.gameId = gameId;

  const link = document.createElement('span');
  link.className = 'hover:underline hover:text-white';
  link.style.cursor = 'pointer';
  link.setAttribute('role', 'button');

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

function handleWatchClick(gameId: string, link: HTMLElement): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    link.textContent = 'Launching...';
    link.style.pointerEvents = 'none';

    chrome.runtime.sendMessage({ type: 'launchReplay', matchId: gameId }, (resp: LaunchReplayResponse | undefined) => {
      if (resp?.needsInstall) {
        link.innerHTML = 'Install launcher first <i class="fas fa-download text-xs ml-1" aria-hidden="true"></i>';
        link.className = 'text-red-400 hover:underline';
        link.style.pointerEvents = '';
        link.onclick = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.open('https://github.com/spartain-aoe/aoe4world-replay-extension/releases/latest', '_blank');
          link.innerHTML = 'Retry <i class="fas fa-redo text-xs ml-1" aria-hidden="true"></i>';
          link.className = 'text-yellow-400 hover:underline';
          link.onclick = (ev2: MouseEvent) => {
            ev2.preventDefault();
            ev2.stopPropagation();
            link.textContent = 'Launching...';
            link.style.pointerEvents = 'none';
            chrome.runtime.sendMessage({ type: 'launchReplay', matchId: gameId }, (resp2: LaunchReplayResponse | undefined) => {
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

function createLoadingDiv(gameId: string): LoadingDiv {
  const div = document.createElement('div') as LoadingDiv;
  div.className = 'aoe4-replay-loading text-gray-400 text-sm mt-0';
  div.dataset.gameId = gameId;
  div.textContent = '.';
  let dots = 1;
  div._interval = setInterval(() => {
    dots = (dots % 3) + 1;
    div.textContent = '.'.repeat(dots);
  }, 400);
  return div;
}

function removeLoading(el: LoadingDiv): void {
  if (el._interval) clearInterval(el._interval);
  el.remove();
}

function removeReplayControls(row: HTMLElement): void {
  row.querySelectorAll<HTMLElement>('.aoe4-replay-btn, .aoe4-replay-loading, .aoe4-replay-unavailable')
    .forEach((el) => {
      if (el.classList.contains('aoe4-replay-loading')) {
        const loading = el as LoadingDiv;
        if (loading._interval) clearInterval(loading._interval);
      }
      el.remove();
    });
}

function hasReplayControls(row: HTMLElement): boolean {
  row.querySelectorAll<HTMLElement>('.aoe4-replay-btn').forEach((btn) => {
    if (!btn.firstElementChild) btn.remove();
  });
  return !!row.querySelector('.aoe4-replay-btn, .aoe4-replay-loading, .aoe4-replay-unavailable');
}

function createUnavailableDiv(): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'aoe4-replay-unavailable';
  div.style.cssText = 'color:#6b7280;font-size:0.8rem;cursor:default;';
  div.textContent = 'Replay Unavailable';
  div.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  return div;
}

function rowHasViewSummary(anchor: HTMLElement): boolean {
  const clone = anchor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.aoe4-replay-btn, .aoe4-replay-loading, .aoe4-replay-unavailable')
    .forEach(el => el.remove());
  return /\bview\s+summary\b/i.test(clone.textContent || '');
}

function shouldRenderReplayControls(anchor: HTMLElement): boolean {
  return allowSummaryHiddenReplays || rowHasViewSummary(anchor);
}

function rowViewportPriority(row: HTMLElement): number {
  const rect = row.getBoundingClientRect?.();
  if (!rect || typeof window.innerHeight !== 'number') return 0;
  if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
    return Math.max(0, rect.top);
  }
  const distance = rect.bottom < 0 ? Math.abs(rect.bottom) : Math.abs(rect.top - window.innerHeight);
  return 100000 + distance;
}

function processRow(row: Element): void {
  const gameRow = row as HTMLElement;
  const gameId = getGameIdFromRow(gameRow);
  if (!gameId) return;

  const anchor = findAnchor(gameRow) as HTMLElement | null;
  if (!anchor) return;
  if (!shouldRenderReplayControls(anchor)) {
    removeReplayControls(gameRow);
    return;
  }
  if (hasReplayControls(gameRow)) return;

  const dateText = getGameDateText(gameRow);
  if (dateText.match(/year/)) {
    anchor.appendChild(createUnavailableDiv());
    return;
  }

  const loading = createLoadingDiv(gameId);
  anchor.appendChild(loading);

  const timeout = setTimeout(() => removeLoading(loading), 60000);

  checkReplay(gameId).then((result: ReplayAvailabilityResult | false) => {
    const replay = result as ReplayAvailabilityResult;
    clearTimeout(timeout);
    removeLoading(loading);
    if (!gameRow.isConnected || !anchor.isConnected) {
      scanGameRows(true);
      return;
    }
    if (!shouldRenderReplayControls(anchor)) {
      removeReplayControls(gameRow);
      return;
    }
    if (replay?.available) {
      anchor.appendChild(createReplayDiv(gameId, replay.prevPatch));
    } else {
      anchor.appendChild(createUnavailableDiv());
    }
  });
}

export function scanGameRows(force = false): void {
  const detailGameId = getGameIdFromUrl(window.location?.href || '');
  const rows = [...document.querySelectorAll<HTMLElement>('[data-game-id]')]
    .sort((a, b) => rowViewportPriority(a) - rowViewportPriority(b));
  for (const row of rows) {
    if (detailGameId && row.dataset.gameId !== detailGameId) continue;
    const anchor = findAnchor(row) as HTMLElement | null;
    if (!anchor) continue;
    if (anchor && !shouldRenderReplayControls(anchor)) {
      removeReplayControls(row);
      continue;
    }
    const hasControls = hasReplayControls(row);
    if (!hasControls || force) {
      processRow(row);
    }
  }
}
