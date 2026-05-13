import { dbg } from './settings.ts';
import type { ReplayAvailabilityResult } from './types.ts';

const CACHE_TTL = 24 * 60 * 60 * 1000;

type PendingReplayCheck = (result: ReplayAvailabilityResult | false) => void;

interface ReplayCacheEntry {
  value: boolean | 'prev';
  time: number;
  permanent?: boolean;
  patch?: string | null;
}

interface CurrentPatchResponse {
  patch?: string | null;
  previousPatch?: string | null;
  patches?: Array<string | null>;
}

interface FavoriteReplayResponse {
  isFavorite?: boolean;
  patch?: string | null;
}

interface BatchReplayResponse {
  rateLimited?: boolean;
  available?: Record<string, boolean>;
  gamePatches?: Record<string, string | null>;
  currentPatch?: string | null;
  previousPatch?: string | null;
  knownPatches?: Array<string | null>;
}

const pendingChecks = new Map<string, PendingReplayCheck[]>();

async function getCached(gameId: string): Promise<ReplayAvailabilityResult | undefined> {
  try {
    const key = 'replay_v2_' + gameId;
    const result = await chrome.storage.local.get(key) as Record<string, ReplayCacheEntry | undefined>;
    const entry = result[key];
    if (!entry) return undefined;

    if (entry.patch && entry.value) {
      const patchResp = await new Promise<CurrentPatchResponse | undefined>(resolve => {
        chrome.runtime.sendMessage({ type: 'getCurrentPatch' }, (resp: CurrentPatchResponse | undefined) => resolve(resp));
      });
      const curPatch = patchResp?.patch;
      if (curPatch) {
        if (entry.patch === curPatch) return { available: true, prevPatch: false };
        const prevPatch = patchResp?.previousPatch;
        if (prevPatch && entry.patch === prevPatch) return { available: true, prevPatch: true };
        return { available: false, prevPatch: false };
      }
    }

    if (entry.permanent) {
      return entry.value ? { available: true, prevPatch: false } : { available: false, prevPatch: false };
    }
    if (Date.now() - entry.time > CACHE_TTL) {
      void chrome.storage.local.remove(key);
      return undefined;
    }
    if (entry.value === true) return { available: true, prevPatch: false };
    if (entry.value === 'prev') return { available: true, prevPatch: true };
    return { available: false, prevPatch: false };
  } catch {
    return undefined;
  }
}

function setCache(gameId: string, available: boolean | 'prev', permanent = false, patch: string | null = null): void {
  try {
    const key = 'replay_v2_' + gameId;
    void chrome.storage.local.set({ [key]: { value: available, time: Date.now(), permanent, patch } });
  } catch { }
}

let batchQueue: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchRunning = false;
let oldPatchCutoffDate: string | null = null;

export function getOldPatchCutoffDate(): string | null { return oldPatchCutoffDate; }

export async function checkReplay(gameId: string): Promise<ReplayAvailabilityResult | false> {
  const favResp = await new Promise<FavoriteReplayResponse | undefined>(resolve => {
    chrome.runtime.sendMessage({ type: 'isFavorite', matchId: gameId }, (resp: FavoriteReplayResponse | undefined) => resolve(resp));
  });
  if (favResp?.isFavorite) {
    const patchResp = await new Promise<CurrentPatchResponse | undefined>(resolve => {
      chrome.runtime.sendMessage({ type: 'getCurrentPatch' }, (resp: CurrentPatchResponse | undefined) => resolve(resp));
    });
    const curPatch = patchResp?.patch;
    const isPrev = curPatch && favResp.patch && favResp.patch !== curPatch;
    return { available: true, prevPatch: !!isPrev };
  }

  const cached = await getCached(gameId);
  if (cached !== undefined) return cached;

  return new Promise<ReplayAvailabilityResult | false>(resolve => {
    if (pendingChecks.has(gameId)) {
      pendingChecks.get(gameId)?.push(resolve);
      return;
    }
    pendingChecks.set(gameId, [resolve]);
    batchQueue.push(gameId);
    scheduleBatch();
  });
}

function scheduleBatch(): void {
  if (batchRunning) return;
  if (batchTimer) clearTimeout(batchTimer);
  dbg(`[replay] Scheduling batch in 500ms (queue: ${batchQueue.length})`);
  batchTimer = setTimeout(runBatch, 500);
}

export function getGameTimestamp(row: Element): string | null {
  const dateEl = row.querySelector('[title*="UTC"]');
  return dateEl?.getAttribute('title') || null;
}

export function getGameDateText(row: Element): string {
  const dateEl = row.querySelector('[aria-label="Game Date"], [title*="UTC"]');
  return dateEl?.textContent?.trim()?.toLowerCase() || '';
}

async function runBatch(): Promise<void> {
  batchTimer = null;
  if (batchRunning) return;
  batchRunning = true;
  dbg(`[replay] Batch starting (queue: ${batchQueue.length})`);

  while (batchQueue.length > 0) {
    const batch = [...new Set(batchQueue.splice(0, 10))];
    dbg(`[replay] Sending batch of ${batch.length}, remaining: ${batchQueue.length}`);

    try {
      const resp = await new Promise<BatchReplayResponse | undefined>(resolve => {
        chrome.runtime.sendMessage({ type: 'checkReplays', gameIds: batch }, (r: BatchReplayResponse | undefined) => resolve(r));
      });

      if (resp?.rateLimited) {
        batchQueue.unshift(...batch);
        await new Promise<void>(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const available = resp?.available || {};
      const gamePatches = resp?.gamePatches || {};

      for (const id of batch) {
        const has = !!available[id];
        const gamePatch = gamePatches[id] || null;

        if (has) {
          setCache(id, true, false, gamePatch);
        }

        let result: ReplayAvailabilityResult = { available: false, prevPatch: false };
        if (has) {
          const curPatch = resp?.currentPatch || null;
          const prevPatch = resp?.previousPatch || null;

          if (!curPatch || !gamePatch || gamePatch === curPatch) {
            result = { available: true, prevPatch: false };
          } else if (prevPatch && gamePatch === prevPatch) {
            result = { available: true, prevPatch: true };
          }
        }

        const cbs = pendingChecks.get(id) || [];
        pendingChecks.delete(id);
        cbs.forEach((cb: PendingReplayCheck) => cb(result));
      }
    } catch {
      for (const id of batch) {
        const cbs = pendingChecks.get(id) || [];
        pendingChecks.delete(id);
        cbs.forEach((cb: PendingReplayCheck) => cb(false));
      }
    }

    if (batchQueue.length > 0) {
      dbg(`[replay] Waiting 5s before next batch (remaining: ${batchQueue.length})`);
      await new Promise<void>(resolve => setTimeout(resolve, 5000));
    }
  }

  dbg('[replay] Batch complete');
  batchRunning = false;
}
