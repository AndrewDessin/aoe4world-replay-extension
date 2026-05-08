import { findAnchor } from './dom.ts';
import { checkReplay, getOldPatchCutoffDate, getGameTimestamp, getGameDateText } from './replay-availability.ts';
import type { ReplayAvailabilityResult } from './types.ts';

interface LaunchReplayResponse {
  needsInstall?: boolean;
  success?: boolean;
  error?: string;
}

type LoadingDiv = HTMLDivElement & {
  _interval?: ReturnType<typeof setInterval>;
};

function getGameIdFromRow(row: HTMLElement): string | null {
  return row.dataset?.gameId || null;
}

function createReplayDiv(gameId: string, prevPatch = false): HTMLDivElement {
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

function handleWatchClick(gameId: string, link: HTMLAnchorElement): (e: MouseEvent) => void {
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

function processRow(row: Element): void {
  const gameRow = row as HTMLElement;
  const gameId = getGameIdFromRow(gameRow);
  if (!gameId) return;
  if (gameRow.querySelector('.aoe4-replay-btn, .aoe4-replay-loading')) return;

  const anchor = findAnchor(gameRow) as HTMLElement | null;
  if (!anchor) return;

  const cutoff = getOldPatchCutoffDate();
  if (cutoff) {
    const gameDate = getGameTimestamp(gameRow);
    if (gameDate && gameDate <= cutoff) {
      return;
    }
  }

  const dateText = getGameDateText(gameRow);
  if (dateText.match(/year/)) {
    return;
  }

  const loading = createLoadingDiv(gameId);
  anchor.appendChild(loading);

  const timeout = setTimeout(() => removeLoading(loading), 60000);

  checkReplay(gameId).then((result: ReplayAvailabilityResult | false) => {
    const replay = result as ReplayAvailabilityResult;
    clearTimeout(timeout);
    removeLoading(loading);
    if (replay.available) {
      anchor.appendChild(createReplayDiv(gameId, replay.prevPatch));
    }
  });
}

const seen = new WeakSet<Element>();
const io = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const row = entry.target;
    io.unobserve(row);
    processRow(row);
  }
}, { rootMargin: '200px' });

export function scanGameRows(): void {
  const rows = document.querySelectorAll<HTMLElement>('[data-game-id]');
  for (const row of rows) {
    if (seen.has(row)) continue;
    seen.add(row);
    io.observe(row);
  }
}
