import { getGameIdFromUrl } from './dom.ts';

interface FavoriteGameMeta {
  gameId: string;
  map?: string;
  mode?: string;
  team1?: string[];
  team2?: string[];
  players?: string[] | null;
  pageUrl: string;
}

interface FavoriteResponse {
  isFavorite?: boolean;
  success?: boolean;
  error?: unknown;
}

function safeSendMessage<TResponse>(payload: unknown, cb?: (response: TResponse | null) => void): void {
  try {
    chrome.runtime.sendMessage(payload as any, cb as any);
  } catch {
    cb?.(null);
  }
}

function scrapeGameMeta(gameId: string): FavoriteGameMeta {
  const row = document.querySelector<HTMLElement>(`[data-game-id="${gameId}"][role="rowgroup"]`)
    || document.querySelector<HTMLElement>(`[data-game-id="${gameId}"]:not(.aoe4-fav-star)`);
  const gameLink = row?.querySelector<HTMLAnchorElement>('a[href*="/games/"]');
  const pageUrl = gameLink ? 'https://aoe4world.com' + gameLink.getAttribute('href') : window.location.href;
  if (!row) return { gameId, pageUrl };
  const map = row.querySelector('h3')?.textContent?.trim() || '';
  const mode = row.querySelector('[class*="text-sm"]')?.textContent?.trim() || '';

  const teamEl = row.querySelector('[aria-label="Team"]');
  const opponentEl = row.querySelector('[aria-label="Opponent Team"]');
  const team1 = teamEl ? [...teamEl.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]')].map(a => a.textContent!.trim()).filter(Boolean) : [];
  const team2 = opponentEl ? [...opponentEl.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]')].map(a => a.textContent!.trim()).filter(Boolean) : [];

  const players = (team1.length || team2.length) ? null
    : [...row.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]')].map(a => a.textContent!.trim()).filter(Boolean);

  return { gameId, map, mode, team1, team2, players, pageUrl };
}

export function setStarStateSaved(star: HTMLElement | null): void {
  if (!star) return;
  star.textContent = '\u2605';
  star.style.color = '#ffd43b';
  star.style.opacity = '1';
  star.title = 'Remove from saved';
  star.dataset.state = 'saved';
  delete star.dataset.busy;
}

export function setStarStateUnsaved(star: HTMLElement | null, errorTitle?: string): void {
  if (!star) return;
  star.textContent = '\u2606';
  star.style.color = '#6c757d';
  star.style.opacity = '1';
  star.title = errorTitle || 'Save replay';
  star.dataset.state = 'unsaved';
  delete star.dataset.busy;
}

function setStarStateBusy(star: HTMLElement, label: string): void {
  star.style.opacity = '0.5';
  star.title = label;
  star.dataset.busy = '1';
}

export function tryAddFavoriteStar(): void {
  const gameId = getGameIdFromUrl(window.location.href);
  if (!gameId) return;
  if (document.querySelector(`.aoe4-fav-star[data-aoe4-fav-game-id="${gameId}"]`)) return;

  const headings = document.querySelectorAll<HTMLElement>('h2, h3');
  let gameHeading: HTMLElement | null = null;
  for (const h of headings) {
    if (h.textContent!.match(/Game\s*#/)) {
      gameHeading = h;
      break;
    }
  }
  if (!gameHeading) return;

  const star = document.createElement('span');
  star.className = 'aoe4-fav-star';
  star.dataset.aoe4FavGameId = gameId;
  star.dataset.state = 'unsaved';
  star.textContent = '\u2606';
  star.style.cursor = 'pointer';
  star.style.fontSize = '20px';
  star.style.lineHeight = '1';
  star.style.color = '#6c757d';
  star.style.padding = '4px 6px';
  star.style.flex = '0 0 auto';
  star.style.userSelect = 'none';
  star.title = 'Save replay';

  const linkAncestor = gameHeading.closest('a') as HTMLAnchorElement | null;
  if (linkAncestor && linkAncestor.parentNode) {
    const parent = linkAncestor.parentNode as Node;
    const wrapper = document.createElement('div');
    wrapper.className = 'aoe4-fav-star-wrap';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.width = '100%';
    star.style.marginLeft = 'auto';
    parent.insertBefore(wrapper, linkAncestor);
    wrapper.appendChild(linkAncestor);
    wrapper.appendChild(star);
  } else {
    gameHeading.style.display = 'flex';
    gameHeading.style.alignItems = 'center';
    star.style.marginLeft = 'auto';
    gameHeading.appendChild(star);
  }

  safeSendMessage<FavoriteResponse>({ type: 'isFavorite', matchId: gameId }, (resp: FavoriteResponse | null) => {
    if (resp?.isFavorite) setStarStateSaved(star);
  });

  star.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (star.dataset.busy === '1') return;

    const isSaved = star.dataset.state === 'saved';
    if (isSaved) {
      setStarStateBusy(star, 'Removing…');
      safeSendMessage<FavoriteResponse>({ type: 'removeFavorite', matchId: gameId }, (resp: FavoriteResponse | null) => {
        if (resp?.success) setStarStateUnsaved(star);
        else setStarStateSaved(star);
      });
    } else {
      const meta = scrapeGameMeta(gameId);
      setStarStateBusy(star, 'Saving…');
      safeSendMessage<FavoriteResponse>({ type: 'saveFavorite', matchId: gameId, meta }, (resp: FavoriteResponse | null) => {
        if (resp?.success) setStarStateSaved(star);
        else setStarStateUnsaved(star, friendlyFavError(resp?.error));
      });
    }
  });
}

function friendlyFavError(raw: unknown): string {
  if (!raw) return 'Save failed (try again)';
  const s = String(raw);
  if (/^Rate limited/i.test(s)) return s;
  if (/Failed to fetch|NetworkError|ERR_BLOCKED|ERR_FAILED/i.test(s)) {
    return 'Network error or blocked by an extension';
  }
  if (/Unexpected token|not valid JSON|JSON\.parse/i.test(s)) {
    return 'Replay API returned an error page (try again later)';
  }
  if (/HTTP 429|rate.?limit/i.test(s)) return 'Rate limited — try again shortly';
  if (/HTTP 5\d\d/i.test(s)) return 'Replay API is unavailable — try again later';
  if (/No replay (data|file)/i.test(s)) return 'No replay available for this game';
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}
