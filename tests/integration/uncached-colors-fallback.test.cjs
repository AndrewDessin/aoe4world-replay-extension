/**
 * Integration test: uncached replay colors fail softly when WorldsEdge data is unavailable.
 *
 * No extra-origin legacy fallback is available, so metadata/blob failures should
 * produce cacheable soft failures without requesting any extra origin.
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { installReplayApiMock } = require('./replay-api-mock.cjs');

const EXT_PATH = path.resolve(__dirname, '..', '..', 'chrome-extension');
const PROFILE_BASE_PATH = path.join(__dirname, '.pw-profile-color-fallback');

let ctx, bg, page;

async function setup(profilePath, replayMockOptions) {
  try { fs.rmSync(profilePath, { recursive: true, force: true }); } catch {}
  ctx = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  bg = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  await bg.evaluate((s) => new Promise(r => chrome.storage.local.set({ settings: s }, r)), {
    parseGameData: true,
    injectCharts: true,
    recolorSwatches: true,
    debugLogs: false,
  });
  await installReplayApiMock(bg, replayMockOptions);
  const extensionId = new URL(bg.url()).host;
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
}

async function teardown(profilePath) {
  if (ctx) await ctx.close().catch(() => {});
  try { fs.rmSync(profilePath, { recursive: true, force: true }); } catch {}
  ctx = null;
  bg = null;
  page = null;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

async function requestColors() {
  return page.evaluate(() => new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'getPlayerColors',
      matchId: '233034826',
      profileId: '24574510',
    }, resolve);
  }));
}

async function runFailureScenario({ profileSuffix, replayMockOptions, verifyResponse, verifyState, successMessage }) {
  const profilePath = `${PROFILE_BASE_PATH}-${profileSuffix}`;
  await setup(profilePath, replayMockOptions);
  try {
    const response = await requestColors();

    verifyResponse(response);

    const state = await bg.evaluate(() => globalThis.__aoe4ReplayApiMockState);
    verifyState(state);

    const cacheEntry = await bg.evaluate(() => new Promise(resolve => {
      chrome.storage.local.get('colors_v5_233034826', result => resolve(result.colors_v5_233034826));
    }));
    assert(cacheEntry?.softFailure === true, `expected soft failure cache entry, got ${JSON.stringify(cacheEntry)}`);
    assert(!cacheEntry?.players, `did not expect parsed replay players, got ${JSON.stringify(cacheEntry)}`);

    console.log(`  ✓ ${successMessage}`);
  } finally {
    await teardown(profilePath);
  }
}

(async () => {
  console.log('\n=== Uncached Color Soft Failure ===');
  await runFailureScenario({
    profileSuffix: 'metadata',
    replayMockOptions: { replayMetadataFails: true },
    verifyResponse: (response) => {
      assert(response?.success === false, `expected metadata failure, got ${JSON.stringify(response)}`);
      assert(response.error === 'replay_api_502', `expected replay_api_502, got ${JSON.stringify(response)}`);
    },
    verifyState: (state) => {
      assert(state.replayMetadataCalls >= 1, `expected replay metadata call, got ${JSON.stringify(state)}`);
      assert(state.blobReplayCalls === 0, `expected no blob call after metadata failure, got ${JSON.stringify(state)}`);
    },
    successMessage: 'metadata 502 is cached as an uncached-color soft failure',
  });
  await runFailureScenario({
    profileSuffix: 'blob',
    replayMockOptions: { replayBlobFails: true },
    verifyResponse: (response) => {
      assert(response?.success === false, `expected blob failure, got ${JSON.stringify(response)}`);
      assert(response.error === 'blob_fetch_502', `expected blob_fetch_502, got ${JSON.stringify(response)}`);
    },
    verifyState: (state) => {
      assert(state.replayMetadataCalls === 1, `expected one replay metadata call, got ${JSON.stringify(state)}`);
      assert(state.blobReplayCalls === 1, `expected one blob replay call, got ${JSON.stringify(state)}`);
    },
    successMessage: 'blob 502 is cached as an uncached-color soft failure',
  });
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
