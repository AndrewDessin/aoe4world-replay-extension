const list = document.getElementById('list');
const countEl = document.getElementById('count');
let currentFavorites = {}; // keep reference for re-star

function render(favorites, count, max) {
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
    
    // Format players as "Team1 vs Team2" or fallback to flat list
    let playersStr;
    if (meta.team1?.length && meta.team2?.length) {
      playersStr = meta.team1.join(', ') + ' vs ' + meta.team2.join(', ');
    } else if (meta.players?.length) {
      playersStr = meta.players.join(' vs ');
    } else {
      playersStr = 'Game #' + id;
    }
    
    const pageUrl = meta.pageUrl || `https://aoe4world.com/api/v0/games/${id}`;
    item.innerHTML = `
      <button class="btn btn-fav" data-id="${id}" data-saved="true" title="Remove from saved" style="font-size:18px;cursor:pointer;background:none;border:none;color:#ffd43b;">&#9733;</button>
      <div class="fav-info">
        <div class="fav-header"><a href="#" data-url="${pageUrl}">${playersStr}</a></div>
        <div class="fav-sub">${meta.mode || ''} &middot; ${meta.map || ''}</div>
        <div class="fav-date">${date}</div>
      </div>
      <div class="fav-actions">
        <button class="btn btn-play" data-id="${id}" title="Launch replay">&#9654;</button>
      </div>
    `;
    list.appendChild(item);
  }

  list.querySelectorAll('.fav-header a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const url = a.dataset.url;
      if (url && url !== '#') {
        window.open(url, '_blank');
      }
    });
  });

  list.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.textContent = '...';
      chrome.runtime.sendMessage({ type: 'launchReplay', matchId: btn.dataset.id }, resp => {
        btn.textContent = resp?.success ? '\u2713' : '\u2717';
        setTimeout(() => { btn.innerHTML = '&#9654;'; }, 3000);
      });
    });
  });

  list.querySelectorAll('.btn-fav').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const isSaved = btn.dataset.saved === 'true';
      if (isSaved) {
        chrome.runtime.sendMessage({ type: 'removeFavorite', matchId: id });
        btn.innerHTML = '&#9734;'; // outline star
        btn.style.color = '#6c757d';
        btn.dataset.saved = 'false';
        btn.title = 'Save replay';
      } else {
        chrome.runtime.sendMessage({ type: 'saveFavorite', matchId: id, meta: currentFavorites[id]?.meta || {} });
        btn.innerHTML = '&#9733;'; // solid star
        btn.style.color = '#ffd43b';
        btn.dataset.saved = 'true';
        btn.title = 'Remove from saved';
      }
    });
  });
}

function loadFavorites() {
  chrome.runtime.sendMessage({ type: 'getFavorites' }, resp => {
    render(resp?.favorites || {}, resp?.count || 0, resp?.max || 10);
  });
}

// Refresh popup when favorites are ADDED (e.g. from game page star)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith('fav_') && change.newValue) { loadFavorites(); return; }
  }
});

loadFavorites();
