import { extractPlayerColors, extractPlayerColorsStructural, setDebug as setParserDebug, type ExtractPlayerColorsResult, type PlayerColorInfo } from './replay-parser.ts';
interface Settings {
    parseGameData: boolean;
    recolorSwatches: boolean;
    injectCharts: boolean;
    debugLogs: boolean;
}
interface PatchInfo {
    current: string | null;
    previous: string | null;
    patches: string[];
    time: number;
}
interface ReplayFile {
    datatype: number;
    size: number;
    url?: string;
    matchhistory_id?: string | number;
}
interface ReplayApiResponse {
    result?: {
        code?: number;
    };
    expiryUnix?: number;
    replayFiles?: ReplayFile[];
    patch?: string | number;
}
interface FavoriteEntry {
    matchId?: string | number;
    meta?: Record<string, unknown>;
    replayData?: string;
    patch?: string | null;
    savedAt?: number;
}
interface UnitDataItem {
    id: string;
    baseId: string;
    name: string;
    age: number;
    pbgid: number;
    attribName: string;
    icon: string;
    classes: string[];
    costs: unknown;
}
interface ColorCacheEntry {
    players?: PlayerColorInfo[];
    savedAt?: number;
    failedAt?: number;
    error?: string;
    softFailure?: boolean;
}
interface UnitDataCacheEntry {
    units?: UnitDataItem[];
    savedAt?: number;
    failedAt?: number;
    error?: string;
}
interface CheckReplaysMessage {
    type: 'checkReplays';
    gameIds: Array<string | number>;
}
interface LaunchReplayMessage {
    type: 'launchReplay';
    matchId: string | number;
}
interface SaveFavoriteMessage {
    type: 'saveFavorite';
    matchId: string | number;
    meta?: Record<string, unknown>;
}
interface RemoveFavoriteMessage {
    type: 'removeFavorite';
    matchId: string | number;
}
interface GetFavoritesMessage {
    type: 'getFavorites';
}
interface IsFavoriteMessage {
    type: 'isFavorite';
    matchId: string | number;
}
interface GetCurrentPatchMessage {
    type: 'getCurrentPatch';
}
interface GetPlayerColorsMessage {
    type: 'getPlayerColors';
    matchId: string | number;
    profileId?: string | number | null;
}
interface GetUnitDataMessage {
    type: 'getUnitData';
    civSlugs?: unknown[];
}
type BackgroundMessage = CheckReplaysMessage | LaunchReplayMessage | SaveFavoriteMessage | RemoveFavoriteMessage | GetFavoritesMessage | IsFavoriteMessage | GetCurrentPatchMessage | GetPlayerColorsMessage | GetUnitDataMessage;
type ChromeMessageResponder = (response?: unknown) => void;
type StorageItems = Record<string, unknown>;
interface CheckReplaysResponse {
    available: Record<string, boolean>;
    rateLimited?: boolean;
    gamePatches?: Record<string, string>;
    currentPatch?: string | null;
    previousPatch?: string | null;
    knownPatches?: string[];
}
type GetPlayerColorsResponse = {
    success: true;
    players: PlayerColorInfo[];
    cached: boolean;
} | {
    success: false;
    error: string;
    cached?: boolean;
    rateLimited?: boolean;
    disabled?: boolean;
};
type GetUnitDataResponse = {
    success: true;
    units: Record<string, UnitDataItem[]>;
} | {
    success: false;
    error: string;
    disabled?: boolean;
};
interface PlayerStringDiff {
    playerId: string;
    field: 'name' | 'civilization';
    heuristic: string | null;
    structural: string | null;
}
const SETTINGS_DEFAULTS: Readonly<Settings> = Object.freeze({ parseGameData: false, recolorSwatches: false, injectCharts: false, debugLogs: false });
let SETTINGS: Settings = { ...SETTINGS_DEFAULTS };
let __settingsReadyResolve: (() => void) | undefined;
const settingsReady: Promise<void> = new Promise<void>(r => { __settingsReadyResolve = r; });
function applySettings(stored?: Partial<Settings> | null): void {
    SETTINGS = { ...SETTINGS_DEFAULTS, ...(stored || {}) };
    setParserDebug(SETTINGS.debugLogs);
}
chrome.storage.local.get('settings', ({ settings }: {
    settings?: Partial<Settings>;
}) => {
    applySettings(settings);
    __settingsReadyResolve!();
});
chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes.settings)
        return;
    applySettings(changes.settings.newValue as Partial<Settings> | undefined);
});
const dbg = (...args: unknown[]): void => { if (SETTINGS.debugLogs)
    console.log(...args); };
const dbgWarn = (...args: unknown[]): void => { if (SETTINGS.debugLogs)
    console.warn(...args); };
const REPLAY_API = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getReplayFiles';
const UA = 'AoE4ReplayLauncher-ChromeExt/1.0 (https://github.com/spartain-aoe/aoe4world-replay-extension, discord:591850595498065931)';
async function parseReplayApiJson(response: Response, what = 'replay API'): Promise<ReplayApiResponse> {
    if (response.status === 429) {
        recordBackoff(what);
        throw new Error('Rate limited');
    }
    if (!response.ok)
        throw new Error(`HTTP ${response.status} from ${what}`);
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('json')) {
        try {
            await response.text();
        }
        catch (_) { }
        throw new Error(`Non-JSON response from ${what} (likely an error page)`);
    }
    const json = await response.json() as ReplayApiResponse;
    recordBackoffSuccess();
    return json;
}
const NATIVE_HOST = 'com.aoe4.replay_launcher';
const MAX_FAVORITES = 10;
const COLORS_CACHE_KEY_PREFIX = 'colors_v5_';
const COLORS_CACHE_LIMIT = 50;
const COLORS_NEGATIVE_TTL_MS = 60 * 60 * 1000;
const COLORS_SOFT_FAILURE_TTL_MS = 10 * 60 * 1000;
const inFlightColorRequests = new Map<string, Promise<GetPlayerColorsResponse>>();
interface CachedReplayUrl { url: string; expiry: number; }
const replayUrlCache = new Map<string, CachedReplayUrl>();
const REPLAY_URL_CACHE_LIMIT = 50;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;
let backoffUntil = 0;
let backoffStreak = 0;
function recordBackoff(what = 'replay API'): number {
    backoffStreak++;
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, backoffStreak - 1), BACKOFF_MAX_MS);
    backoffUntil = Date.now() + delay;
    console.warn(`[replay] 429 from ${what} — backing off ${Math.round(delay / 1000)}s (streak ${backoffStreak})`);
    return delay;
}
function recordBackoffSuccess(): void {
    if (backoffStreak > 0) {
        dbg(`[replay] Backoff cleared after ${backoffStreak} 429(s)`);
        backoffStreak = 0;
    }
}
function comparePatchVersions(a: string, b: string): number {
    const partsA = a.split(/[./]/).map(Number);
    const partsB = b.split(/[./]/).map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const va = partsA[i] ?? 0;
        const vb = partsB[i] ?? 0;
        if (va !== vb) return va - vb;
    }
    return 0;
}

let currentPatch: string | null = null;
let previousPatch: string | null = null;
let knownPatches: string[] = [];
let lastRefreshTime = 0;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
async function ensureCurrentPatch(): Promise<string | null> {
    if (currentPatch && Date.now() - lastRefreshTime < REFRESH_INTERVAL_MS)
        return currentPatch;
    if (!currentPatch) {
        const cached = await chrome.storage.local.get('patchInfo_v2') as {
            patchInfo_v2?: PatchInfo;
        };
        if (cached.patchInfo_v2) {
            const isFullVersion = (v: string) => v.includes('/');
            currentPatch = cached.patchInfo_v2.current ?? null;
            if (currentPatch && !isFullVersion(currentPatch)) currentPatch = null;
            previousPatch = cached.patchInfo_v2.previous ?? null;
            if (previousPatch && !isFullVersion(previousPatch)) previousPatch = null;
            knownPatches = (cached.patchInfo_v2.patches || []).filter(isFullVersion);
        }
    }
    await refreshCurrentPatch();
    return currentPatch;
}
async function refreshCurrentPatch(): Promise<void> {
    try {
        const data = await fetch('https://aoe4world.com/api/v0/games?limit=5&state=finished', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json()) as { games?: Array<{ game_id?: number; patch?: number | string }> };
        const games = data.games || [];
        const gameIds = games.filter(g => g.game_id).map(g => g.game_id!).slice(0, 5);
        if (!gameIds.length) return;
        const replayData = await fetch(`${REPLAY_API}?matchIDs=[${gameIds.join(',')}]&title=age4`, { headers: { 'User-Agent': UA } })
            .then(r => r.json()) as ReplayApiResponse;
        const file = replayData.replayFiles?.find((f: ReplayFile) => f.url);
        if (file?.url) {
            updatePatchFromUrl(file.url);
            const m = file.url.match(/\/([\d.]+\/\d+)\/M_/);
            if (m) currentPatch = m[1];
        }
        if (!currentPatch && games[0]?.patch) currentPatch = String(games[0].patch);
    } catch { }
    lastRefreshTime = Date.now();
    dbg(`[replay] Patches: ${knownPatches.join(', ')} (current: ${currentPatch}, previous: ${previousPatch})`);
}
function recomputePreviousPatch(): void {
    if (!currentPatch || knownPatches.length < 2) { previousPatch = null; return; }
    const sorted = [...knownPatches].sort((a, b) => comparePatchVersions(b, a));
    const curIdx = sorted.indexOf(currentPatch);
    previousPatch = sorted[curIdx + 1] ?? null;
}
function savePatchInfo(): void {
    chrome.storage.local.set({ patchInfo_v2: { current: currentPatch, previous: previousPatch, patches: knownPatches, time: Date.now() } });
}
function updatePatchFromUrl(url: string): void {
    const m = url.match(/\/([\d.]+\/\d+)\/M_/);
    if (m) {
        const fullVersion = m[1];
        const build = fullVersion.split('/').pop()!;
        if (!knownPatches.includes(fullVersion)) {
            knownPatches.push(fullVersion);
            recomputePreviousPatch();
        }
        if (currentPatch === build) {
            currentPatch = fullVersion;
            recomputePreviousPatch();
        } else if (currentPatch && comparePatchVersions(fullVersion, currentPatch) > 0) {
            previousPatch = currentPatch;
            currentPatch = fullVersion;
            recomputePreviousPatch();
        }
        savePatchInfo();
    }
}
(async () => {
    try {
        const all = await chrome.storage.local.get(null) as StorageItems;
        const stale = Object.keys(all).filter(k => k.startsWith('colors_') && !k.startsWith(COLORS_CACHE_KEY_PREFIX));
        if (stale.length) {
            await chrome.storage.local.remove(stale);
            dbg(`[replay] Removed ${stale.length} stale color cache entries`);
        }
    }
    catch (e) {
        console.warn('[replay] Color cache cleanup failed:', (e as {
            message?: string;
        })?.message || String(e));
    }
})();
chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: ChromeMessageResponder): boolean | void => {
    if (msg.type === 'checkReplays') {
        const now = Date.now();
        if (now < backoffUntil) {
            dbg(`[replay] Backoff active, skipping (${Math.round((backoffUntil - now) / 1000)}s left)`);
            sendResponse({ available: {}, rateLimited: true } satisfies CheckReplaysResponse);
            return true;
        }
        const ids = msg.gameIds.slice(0, 10);
        ensureCurrentPatch().then(() => {
            const url = `${REPLAY_API}?matchIDs=[${ids.join(',')}]&title=age4`;
            dbg(`[replay] Fetching ${ids.length} IDs: ${ids.join(',')}`);
            return fetch(url, { headers: { 'User-Agent': UA } })
                .then(r => parseReplayApiJson(r, 'replay metadata'))
                .then(data => {
                    const available: Record<string, boolean> = {};
                    const gamePatches: Record<string, string> = {};
                    const expiry = (data.expiryUnix ? data.expiryUnix * 1000 : Date.now() + 3 * 60 * 1000) - 60_000;
                    if (data.result?.code === 0 && data.replayFiles) {
                        for (const file of data.replayFiles) {
                            const mid = String(file.matchhistory_id);
                            if (file.datatype === 0 && file.size > 0) {
                                available[mid] = true;
                            }
                            if (file.url) {
                                updatePatchFromUrl(file.url);
                                const pm = file.url.match(/\/([\d.]+\/\d+)\/M_/);
                                if (pm) gamePatches[mid] = pm[1];
                                if (file.datatype === 0 && file.size > 0) {
                                    replayUrlCache.set(mid, { url: file.url, expiry });
                                    if (replayUrlCache.size > REPLAY_URL_CACHE_LIMIT) {
                                        const oldest = replayUrlCache.keys().next().value;
                                        if (oldest) replayUrlCache.delete(oldest);
                                    }
                                }
                            }
                        }
                    }
                    dbg(`[replay] Got ${Object.keys(available).length} available out of ${ids.length}`);
                    sendResponse({ available, gamePatches, currentPatch, previousPatch, knownPatches });
                });
        }).catch((e: unknown) => {
            const message = (e as { message?: string })?.message || String(e);
            console.warn('[replay] Error:', message);
            sendResponse({ available: {}, rateLimited: message.includes('Rate limited') } satisfies CheckReplaysResponse);
        });
        return true;
    }
    if (msg.type === 'launchReplay') {
        const favKey = 'fav_' + msg.matchId;
        chrome.storage.local.get(favKey, (result: Record<string, FavoriteEntry | undefined>) => {
            const fav = result[favKey];
            if (fav?.replayData) {
                chrome.runtime.sendNativeMessage(NATIVE_HOST, {
                    action: 'launchReplayData',
                    matchId: msg.matchId,
                    replayB64: fav.replayData
                }, (response: unknown) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message, needsInstall: true });
                    }
                    else {
                        sendResponse(response);
                    }
                });
            }
            else {
                chrome.runtime.sendNativeMessage(NATIVE_HOST, {
                    action: 'launchReplay',
                    matchId: msg.matchId
                }, (response: unknown) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message, needsInstall: true });
                    }
                    else {
                        sendResponse(response);
                    }
                });
            }
        });
        return true;
    }
    if (msg.type === 'saveFavorite') {
        if (Date.now() < backoffUntil) {
            const remainMs = backoffUntil - Date.now();
            sendResponse({
                success: false,
                error: `Rate limited — try again in ${Math.ceil(remainMs / 1000)}s`,
                rateLimited: true,
            });
            return false;
        }
        const url = `${REPLAY_API}?matchIDs=[${msg.matchId}]&title=age4`;
        chrome.storage.local.get(null, (allData: StorageItems) => {
            const favCount = Object.keys(allData).filter(k => k.startsWith('fav_')).length;
            if (favCount >= MAX_FAVORITES) {
                sendResponse({ success: false, error: `Maximum ${MAX_FAVORITES} favorites reached` });
                return;
            }
            fetch(url, { headers: { 'User-Agent': UA } })
                .then(r => parseReplayApiJson(r, 'replay metadata'))
                .then(data => {
                if (data.result?.code !== 0 || !data.replayFiles)
                    throw new Error('No replay data');
                const file = data.replayFiles.find((f: ReplayFile) => f.datatype === 0 && f.size > 0);
                if (!file)
                    throw new Error('No replay file');
                const replayUrl = file.url as string;
                const pm = replayUrl.match(/\/([\d.]+\/\d+)\/M_/);
                const patch = pm ? pm[1] : null;
                return fetch(replayUrl).then(async (r) => {
                    if (!r.ok)
                        throw new Error(`HTTP ${r.status} downloading replay`);
                    return { arrayBuffer: r.arrayBuffer(), patch };
                });
            })
                .then(async ({ arrayBuffer, patch }: {
                arrayBuffer: Promise<ArrayBuffer>;
                patch: string | null;
            }) => {
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
                    dbg(`[replay] Saved favorite ${msg.matchId} (${Math.round(b64.length / 1024)}KB, patch ${patch})`);
                    sendResponse({ success: true });
                });
            })
                .catch((e: unknown) => {
                const message = (e as {
                    message?: string;
                })?.message || String(e);
                console.warn('[replay] Save failed:', message);
                sendResponse({ success: false, error: message });
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
        chrome.storage.local.get(null, (allData: StorageItems) => {
            const favs: Record<string, {
                meta: Record<string, unknown> | undefined;
                savedAt: number | undefined;
            }> = {};
            for (const [key, val] of Object.entries(allData)) {
                if (key.startsWith('fav_')) {
                    const favorite = val as FavoriteEntry;
                    favs[key.slice(4)] = { meta: favorite.meta, savedAt: favorite.savedAt };
                }
            }
            sendResponse({ favorites: favs, count: Object.keys(favs).length, max: MAX_FAVORITES });
        });
        return true;
    }
    if (msg.type === 'isFavorite') {
        chrome.storage.local.get('fav_' + msg.matchId, (result: Record<string, FavoriteEntry | undefined>) => {
            const fav = result['fav_' + msg.matchId];
            sendResponse({ isFavorite: !!fav, patch: fav?.patch || null });
        });
        return true;
    }
    if (msg.type === 'getCurrentPatch') {
        ensureCurrentPatch().then(() => {
            sendResponse({ patch: currentPatch || null, previousPatch: previousPatch || null, patches: knownPatches });
        });
        return true;
    }
    if (msg.type === 'getPlayerColors') {
        const matchId = String(msg.matchId);
        if (!matchId) {
            sendResponse({ success: false, error: 'matchId required' });
            return false;
        }
        settingsReady.then(() => {
            if (!SETTINGS.parseGameData || !SETTINGS.recolorSwatches) {
                sendResponse({ success: false, error: 'disabled', disabled: true });
                return;
            }
            handleGetPlayerColors(matchId, { profileId: msg.profileId })
                .then(payload => sendResponse(payload))
                .catch((error: unknown) => sendResponse({ success: false, error: (error as {
                    message?: string;
                })?.message || String(error) }));
        });
        return true;
    }
    if (msg.type === 'getUnitData') {
        settingsReady.then(() => {
            if (!SETTINGS.parseGameData || !SETTINGS.injectCharts) {
                sendResponse({ success: false, error: 'disabled', disabled: true });
                return;
            }
            const slugs = Array.isArray(msg.civSlugs) ? msg.civSlugs : [];
            handleGetUnitData(slugs)
                .then(payload => sendResponse(payload))
                .catch((error: unknown) => sendResponse({ success: false, error: (error as {
                    message?: string;
                })?.message || String(error) }));
        });
        return true;
    }
});
const UNIT_DATA_CACHE_PREFIX = 'unit_data_v2_';
async function handleGetUnitData(civSlugs: readonly unknown[]): Promise<GetUnitDataResponse> {
    const valid = [...new Set(civSlugs.filter((s: unknown): s is string => /^[a-z0-9_-]+$/i.test(String(s))).map(String))];
    if (!valid.length)
        return { success: true, units: {} };
    const units: Record<string, UnitDataItem[]> = {};
    await Promise.all(valid.map(async (slug) => {
        const cacheKey = UNIT_DATA_CACHE_PREFIX + slug;
        const cached = await chrome.storage.local.get(cacheKey) as Record<string, UnitDataCacheEntry | undefined>;
        const entry = cached[cacheKey];
        if (entry && !Array.isArray(entry.units) && entry.failedAt) {
            await chrome.storage.local.remove(cacheKey);
        }
        units[slug] = Array.isArray(entry?.units) ? entry.units : [];
    }));
    return { success: true, units };
}
export interface GetPlayerColorsOptions {
    profileId?: string | number | null;
}
export async function handleGetPlayerColors(matchId: string, options: GetPlayerColorsOptions = {}): Promise<GetPlayerColorsResponse> {
    const cacheKey = COLORS_CACHE_KEY_PREFIX + matchId;
    const cached = await chrome.storage.local.get(cacheKey) as Record<string, ColorCacheEntry | undefined>;
    const entry = cached[cacheKey];
    if (entry?.players) {
        return { success: true, players: entry.players, cached: true };
    }
    if (entry?.failedAt) {
        const ttl = entry.softFailure ? COLORS_SOFT_FAILURE_TTL_MS : COLORS_NEGATIVE_TTL_MS;
        if (Date.now() - entry.failedAt < ttl) {
            return { success: false, error: entry.error || 'cached_failure', cached: true };
        }
    }
    if (inFlightColorRequests.has(matchId)) {
        return inFlightColorRequests.get(matchId)!;
    }
    const inflight: Promise<GetPlayerColorsResponse> = (async () => {
        try {
            if (Date.now() < backoffUntil) {
                return { success: false, error: 'rate_limited', rateLimited: true };
            }
            const players = await fetchAndParsePlayerColors(matchId);
            await storeColorEntry(cacheKey, { players, savedAt: Date.now() });
            return { success: true, players, cached: false };
        }
        catch (err) {
            const message = (err as {
                message?: string;
            })?.message || String(err);
            if (message === 'rate_limited') {
                return { success: false, error: 'rate_limited', rateLimited: true };
            }
            if (isPermanentFailure(message)) {
                await storeColorEntry(cacheKey, { failedAt: Date.now(), error: message });
            }
            else if (isSoftFailure(message)) {
                await storeColorEntry(cacheKey, {
                    failedAt: Date.now(),
                    error: message,
                    softFailure: true,
                });
            }
            return { success: false, error: message };
        }
    })();
    inFlightColorRequests.set(matchId, inflight);
    try {
        return await inflight;
    }
    finally {
        inFlightColorRequests.delete(matchId);
    }
}
export function isPermanentFailure(message: string | null | undefined): boolean {
    if (!message)
        return false;
    if (message === 'no_replay_file')
        return true;
    if (message === 'replay_api_no_data')
        return true;
    if (message.startsWith('parse_'))
        return true;
    if (/^replay_api_4\d\d$/.test(message))
        return true;
    return false;
}
export function isSoftFailure(message: string | null | undefined): boolean {
    if (!message)
        return false;
    if (/Failed to fetch/i.test(message))
        return true;
    if (/NetworkError/i.test(message))
        return true;
    if (/ERR_BLOCKED/i.test(message))
        return true;
    if (/^blob_fetch_/.test(message))
        return true;
    if (/^replay_api_5\d\d$/.test(message))
        return true;
    if (/HTTP \d+ downloading replay/i.test(message))
        return true;
    return false;
}
async function fetchAndParsePlayerColors(matchId: string): Promise<PlayerColorInfo[]> {
    const cached = replayUrlCache.get(matchId);
    let replayUrl = (cached && Date.now() < cached.expiry) ? cached.url : null;
    replayUrlCache.delete(matchId);
    if (!replayUrl) {
        replayUrl = await fetchReplayFileUrl(matchId);
    }
    updatePatchFromUrl(replayUrl);
    const blobResponse = await fetch(replayUrl);
    if (!blobResponse.ok)
        throw new Error(`blob_fetch_${blobResponse.status}`);
    const arrayBuffer = await blobResponse.arrayBuffer();
    return parseReplayPlayersFromArrayBuffer(arrayBuffer, matchId);
}
async function fetchReplayFileUrl(matchId: string): Promise<string> {
    const apiUrl = `${REPLAY_API}?matchIDs=[${matchId}]&title=age4`;
    const apiResponse = await fetch(apiUrl, { headers: { 'User-Agent': UA } });
    let data: ReplayApiResponse;
    try {
        data = await parseReplayApiJson(apiResponse, 'replay metadata');
    }
    catch (e) {
        const message = (e as { message?: string })?.message || String(e);
        if (message === 'Rate limited') throw new Error('rate_limited');
        const m = message.match(/HTTP (\d+)/);
        if (m) throw new Error(`replay_api_${m[1]}`);
        throw new Error('replay_api_no_data');
    }
    if (data.result?.code !== 0 || !Array.isArray(data.replayFiles)) {
        throw new Error('replay_api_no_data');
    }
    const replayFile = data.replayFiles.find((f: ReplayFile) => f.datatype === 0 && f.size > 0 && f.url);
    if (!replayFile) throw new Error('no_replay_file');
    return replayFile.url as string;
}
async function parseReplayPlayersFromArrayBuffer(arrayBuffer: ArrayBuffer, matchId: string): Promise<PlayerColorInfo[]> {
    let players: PlayerColorInfo[];
    try {
        const result = await extractPlayerColors(arrayBuffer);
        const shouldHydrateStrings = result.players.some((p: PlayerColorInfo) => !p.name || !p.civilization);
        if (shouldHydrateStrings) {
            try {
                const structural = await extractPlayerColorsStructural(arrayBuffer);
                if (playersAgree(result.players, structural.players)) {
                    players = mergeStructuralPlayerStrings(result.players, structural.players);
                }
                else {
                    players = result.players;
                    console.warn('[parse-shadow] structural ≠ heuristic', {
                        matchId,
                        chunkVersion: result.chunkVersion,
                        heuristic: result.players.map((p: PlayerColorInfo) => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
                        structural: structural.players.map((p: PlayerColorInfo) => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
                        structuralWarnings: structural.warnings,
                        structuralDiagnostic: structural.diagnostic,
                    });
                }
            }
            catch (err) {
                players = result.players;
                console.warn('[parse-shadow] structural hydrate threw', {
                    matchId,
                    chunkVersion: result.chunkVersion,
                    error: (err as { message?: string })?.message || String(err),
                });
            }
        }
        else {
            players = result.players;
            shadowValidateStructural(arrayBuffer, result, matchId).catch((err: unknown) => {
                console.warn('[parse-shadow] outer threw', { matchId, error: (err as { message?: string })?.message || String(err) });
            });
        }
    } catch (heuristicErr) {
        dbg('[parse] heuristic failed, falling back to structural', { matchId, error: (heuristicErr as { message?: string })?.message });
        const structural = await extractPlayerColorsStructural(arrayBuffer);
        players = structural.players;
    }
    return players.map(p => ({
        slot: p.slot,
        name: p.name,
        civilization: p.civilization,
        playerId: p.playerId,
        color: p.color,
        colorName: p.colorName,
    }));
}
async function shadowValidateStructural(arrayBuffer: ArrayBuffer, heuristicResult: ExtractPlayerColorsResult, matchId: string): Promise<void> {
    try {
        const structural = await extractPlayerColorsStructural(arrayBuffer);
        const agree = playersAgree(heuristicResult.players, structural.players);
        if (agree) {
            const stringDiffs = playersStringDiff(heuristicResult.players, structural.players);
            dbg('[parse-shadow] structural agrees', {
                matchId,
                chunkVersion: heuristicResult.chunkVersion,
                playerCount: structural.players.length,
                warnings: structural.warnings,
                stringDiffs,
                diagnostic: structural.diagnostic,
            });
        }
        else {
            console.warn('[parse-shadow] structural ≠ heuristic', {
                matchId,
                chunkVersion: heuristicResult.chunkVersion,
                heuristic: heuristicResult.players.map((p: PlayerColorInfo) => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
                structural: structural.players.map((p: PlayerColorInfo) => ({ slot: p.slot, name: p.name, color: p.color, playerId: p.playerId })),
                structuralWarnings: structural.warnings,
                structuralDiagnostic: structural.diagnostic,
            });
        }
    }
    catch (err) {
        console.warn('[parse-shadow] structural threw', {
            matchId,
            chunkVersion: heuristicResult.chunkVersion,
            error: (err as {
                message?: string;
            })?.message || String(err),
        });
    }
}
function playersAgree(heuristic: PlayerColorInfo[], structural: PlayerColorInfo[]): boolean {
    if (!Array.isArray(heuristic) || !Array.isArray(structural))
        return false;
    if (heuristic.length !== structural.length)
        return false;
    const norm = (s: string | null | undefined): string | null => (s == null ? null : String(s));
    const h = new Map<string, PlayerColorInfo>();
    let hNullCount = 0;
    for (const p of heuristic) {
        const key = norm(p.playerId);
        if (key == null) {
            hNullCount++;
            continue;
        }
        if (h.has(key))
            return false;
        h.set(key, p);
    }
    const s = new Map<string, PlayerColorInfo>();
    let sNullCount = 0;
    for (const p of structural) {
        const key = norm(p.playerId);
        if (key == null) {
            sNullCount++;
            continue;
        }
        if (s.has(key))
            return false;
        s.set(key, p);
    }
    if (hNullCount !== sNullCount)
        return false;
    if (h.size !== s.size)
        return false;
    for (const [pid, sp] of s) {
        const hp = h.get(pid);
        if (!hp)
            return false;
        if (sp.color !== hp.color)
            return false;
    }
    return true;
}
function playersStringDiff(heuristic: PlayerColorInfo[], structural: PlayerColorInfo[]): PlayerStringDiff[] {
    const diffs: PlayerStringDiff[] = [];
    const norm = (s: string | null | undefined): string | null => (s == null ? null : String(s));
    const sByPid = new Map<string, PlayerColorInfo>(structural.filter((p: PlayerColorInfo) => !!p.playerId).map((p: PlayerColorInfo) => [norm(p.playerId) as string, p]));
    for (const hp of heuristic) {
        const playerId = norm(hp.playerId);
        if (playerId == null)
            continue;
        const sp = sByPid.get(playerId);
        if (!sp)
            continue;
        if ((hp.name ?? null) !== (sp.name ?? null))
            diffs.push({ playerId: hp.playerId, field: 'name', heuristic: hp.name, structural: sp.name });
        if ((hp.civilization ?? null) !== (sp.civilization ?? null))
            diffs.push({ playerId: hp.playerId, field: 'civilization', heuristic: hp.civilization, structural: sp.civilization });
    }
    return diffs;
}
function mergeStructuralPlayerStrings(heuristic: PlayerColorInfo[], structural: PlayerColorInfo[]): PlayerColorInfo[] {
    const norm = (s: string | null | undefined): string | null => (s == null ? null : String(s));
    const structuralByPid = new Map<string, PlayerColorInfo>(structural.filter((p: PlayerColorInfo) => !!p.playerId).map((p: PlayerColorInfo) => [norm(p.playerId) as string, p]));
    return heuristic.map((player: PlayerColorInfo): PlayerColorInfo => {
        const structuralPlayer = player.playerId ? structuralByPid.get(String(player.playerId)) : undefined;
        if (!structuralPlayer) return player;
        return {
            ...player,
            name: player.name || structuralPlayer.name,
            civilization: player.civilization || structuralPlayer.civilization,
        };
    });
}
async function storeColorEntry(cacheKey: string, value: ColorCacheEntry): Promise<void> {
    await chrome.storage.local.set({ [cacheKey]: value });
    await pruneColorCache();
}
async function pruneColorCache(): Promise<void> {
    const all = await chrome.storage.local.get(null) as StorageItems;
    const entries: Array<{
        key: string;
        ts: number;
    }> = [];
    for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(COLORS_CACHE_KEY_PREFIX))
            continue;
        const cacheValue = value as ColorCacheEntry;
        const ts = cacheValue.savedAt ?? cacheValue.failedAt ?? 0;
        entries.push({ key, ts });
    }
    if (entries.length <= COLORS_CACHE_LIMIT)
        return;
    entries.sort((a, b) => a.ts - b.ts);
    const toRemove = entries.slice(0, entries.length - COLORS_CACHE_LIMIT).map(e => e.key);
    if (toRemove.length)
        await chrome.storage.local.remove(toRemove);
}
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
