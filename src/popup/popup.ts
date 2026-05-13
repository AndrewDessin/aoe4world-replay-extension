function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type PopupSettings = {
  recolorSwatches: boolean;
  injectCharts: boolean;
  debugLogs: boolean;
};

type FavoriteMeta = {
  team1?: string[];
  team2?: string[];
  players?: string[];
  pageUrl?: string;
  mode?: string;
  map?: string;
};

type FavoriteEntry = {
  savedAt?: number;
  meta?: FavoriteMeta;
};

type FavoritesById = Record<string, FavoriteEntry>;

type SettingsStorage = {
  settings?: Partial<PopupSettings>;
};

type GetFavoritesResponse = {
  favorites?: FavoritesById;
  count?: number;
  max?: number;
};

type LaunchReplayResponse = {
  success?: boolean;
};

const list = document.getElementById('list') as HTMLElement;
const countEl = document.getElementById('count') as HTMLElement;
let currentFavorites: FavoritesById = {};

const SETTINGS_DEFAULTS = Object.freeze<PopupSettings>({ recolorSwatches: false, injectCharts: true, debugLogs: false });
const settingsPanel = document.getElementById('settings') as HTMLElement;
const settingsToggle = document.getElementById('settings-toggle') as HTMLElement;
const optCharts = document.getElementById('opt-charts') as HTMLInputElement;
const optRecolor = document.getElementById('opt-recolor') as HTMLInputElement;
const optDebug = document.getElementById('opt-debug') as HTMLInputElement;
const reloadHint = document.getElementById('reload-hint') as HTMLElement;

settingsToggle.addEventListener('click', () => {
  const open = !settingsPanel.classList.contains('open');
  settingsPanel.classList.toggle('open', open);
  settingsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  settingsToggle.classList.toggle('active', open);
  settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

function loadSettingsIntoPanel(): void {
  chrome.storage.local.get('settings', ({ settings }: SettingsStorage): void => {
    const merged: PopupSettings = { ...SETTINGS_DEFAULTS, ...(settings || {}) };
    optCharts.checked = merged.injectCharts !== false;
    optRecolor.checked = merged.recolorSwatches === true;
    optDebug.checked = merged.debugLogs === true;
  });
}

async function updateOneSetting(key: keyof PopupSettings, value: boolean): Promise<void> {
  const { settings: existing } = await chrome.storage.local.get('settings') as SettingsStorage;
  const next: PopupSettings = { ...SETTINGS_DEFAULTS, ...(existing || {}), [key]: value };
  await chrome.storage.local.set({ settings: next });
  reloadHint.classList.add('show');
}

optCharts.addEventListener('change', () => updateOneSetting('injectCharts', optCharts.checked));
optRecolor.addEventListener('change', () => updateOneSetting('recolorSwatches', optRecolor.checked));
optDebug.addEventListener('change', () => updateOneSetting('debugLogs', optDebug.checked));
loadSettingsIntoPanel();

function render(favorites: FavoritesById, count: number, max: number): void {
  currentFavorites = favorites;
  countEl.textContent = `(${count}/${max})`;
  
  const ids = Object.keys(favorites).sort((a, b) => {
    return (favorites[b].savedAt || 0) - (favorites[a].savedAt || 0);
  });

  if (ids.length === 0) {
    list.innerHTML = '<div class="empty">No saved replays yet.<br>Click the star on a game page to save one.</div>';
    return;
  }

  list.innerHTML = '';
  for (const id of ids) {
    const fav = favorites[id];
    const meta = fav.meta || {};
    const date = fav.savedAt ? new Date(fav.savedAt).toLocaleDateString() : '';

    const item = document.createElement('div');
    item.className = 'fav-item';
    
    let playersStr: string;
    if (meta.team1?.length && meta.team2?.length) {
      playersStr = meta.team1.join(', ') + ' vs ' + meta.team2.join(', ');
    } else if (meta.players?.length) {
      playersStr = meta.players.join(' vs ');
    } else {
      playersStr = 'Game #' + id;
    }
    
    const pageUrl = meta.pageUrl || `https://aoe4world.com/api/v0/games/${id}`;
    item.innerHTML = `
      <button class="btn btn-fav" data-id="${esc(id)}" data-saved="true" title="Remove from saved" style="font-size:18px;cursor:pointer;background:none;border:none;color:#ffd43b;">&#9733;</button>
      <div class="fav-info">
        <div class="fav-header"><a href="#" data-url="${esc(pageUrl)}">${esc(playersStr)}</a></div>
        <div class="fav-sub">${esc(meta.mode || '')} &middot; ${esc(meta.map || '')}</div>
        <div class="fav-date">${esc(date)}</div>
      </div>
      <div class="fav-actions">
        <button class="btn btn-play" data-id="${esc(id)}" title="Launch replay">&#9654;</button>
      </div>
    `;
    list.appendChild(item);
  }

  list.querySelectorAll<HTMLAnchorElement>('.fav-header a').forEach((a) => {
    a.addEventListener('click', (e: MouseEvent): void => {
      e.preventDefault();
      const url = a.dataset.url;
      if (url && url !== '#') {
        window.open(url, '_blank');
      }
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.btn-play').forEach((btn) => {
    btn.addEventListener('click', (): void => {
      btn.textContent = '...';
      chrome.runtime.sendMessage({ type: 'launchReplay', matchId: btn.dataset.id }, (resp: LaunchReplayResponse | undefined): void => {
        btn.textContent = resp?.success ? '\u2713' : '\u2717';
        setTimeout(() => { btn.innerHTML = '&#9654;'; }, 3000);
      });
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.btn-fav').forEach((btn) => {
    btn.addEventListener('click', (): void => {
      const id = btn.dataset.id!;
      const isSaved = btn.dataset.saved === 'true';
      if (isSaved) {
        chrome.runtime.sendMessage({ type: 'removeFavorite', matchId: id });
        btn.innerHTML = '&#9734;';
        btn.style.color = '#6c757d';
        btn.dataset.saved = 'false';
        btn.title = 'Save replay';
      } else {
        chrome.runtime.sendMessage({ type: 'saveFavorite', matchId: id, meta: currentFavorites[id]?.meta || {} });
        btn.innerHTML = '&#9733;';
        btn.style.color = '#ffd43b';
        btn.dataset.saved = 'true';
        btn.title = 'Remove from saved';
      }
    });
  });
}

function loadFavorites(): void {
  chrome.runtime.sendMessage({ type: 'getFavorites' }, (resp: GetFavoritesResponse | undefined): void => {
    render(resp?.favorites || {}, resp?.count || 0, resp?.max || 10);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith('fav_') && change.newValue) { loadFavorites(); return; }
  }
});

loadFavorites();
