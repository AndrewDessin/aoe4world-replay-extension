import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeChromeMock } from '../helpers/chrome-mock.mjs';

const originalFetch = globalThis.fetch;
const replayFixture = readFileSync(new URL('../fixtures/replay/1v1-spartain.gz', import.meta.url));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installBaseFetchMock(handler) {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('aoe4world.com/api/v0/games')) {
      return new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handler(href, init);
  };
}

describe('background color cache', () => {
  it('soft-caches replay API 5xx failures even when a profile id is available', async () => {
    const { chrome, storageData } = makeChromeMock({
      initial: { settings: { parseGameData: true, recolorSwatches: true, injectCharts: true } },
    });
    globalThis.chrome = chrome;

    const replayRequests = [];
    installBaseFetchMock(async (href) => {
      if (href.includes('getReplayFiles')) {
        replayRequests.push(href);
        return new Response('Bad Gateway', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    const mod = await import(`../../src/background/background.ts?t=${Math.random()}`);
    await new Promise(resolve => setTimeout(resolve, 0));

    const first = await mod.handleGetPlayerColors('233034826', { profileId: '24574510' });
    assert.equal(first.success, false);
    assert.equal(first.error, 'replay_api_502');
    assert.equal(replayRequests.length, 1);
    assert.equal(storageData.colors_v5_233034826?.softFailure, true);

    const cached = await mod.handleGetPlayerColors('233034826', { profileId: '24574510' });
    assert.equal(cached.success, false);
    assert.equal(cached.cached, true);
    assert.equal(replayRequests.length, 1);
  });

  it('soft-caches replay blob failures instead of using an extra-origin fallback', async () => {
    const { chrome, storageData } = makeChromeMock({
      initial: { settings: { parseGameData: true, recolorSwatches: true, injectCharts: true } },
    });
    globalThis.chrome = chrome;

    const replayRequests = [];
    const blobRequests = [];
    installBaseFetchMock(async (href) => {
      if (href.includes('getReplayFiles')) {
        replayRequests.push(href);
        return new Response(JSON.stringify({
          result: { code: 0, message: 'SUCCESS' },
          replayFiles: [{
            datatype: 0,
            size: replayFixture.byteLength,
            matchhistory_id: 233034826,
            url: 'https://fixture.test/replay.gz',
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (href.startsWith('https://fixture.test/')) {
        blobRequests.push(href);
        return new Response('Bad Gateway', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    const mod = await import(`../../src/background/background.ts?t=${Math.random()}`);
    await new Promise(resolve => setTimeout(resolve, 0));

    const result = await mod.handleGetPlayerColors('233034826', { profileId: '24574510' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'blob_fetch_502');
    assert.equal(replayRequests.length, 1);
    assert.equal(blobRequests.length, 1);
    assert.equal(storageData.colors_v5_233034826?.softFailure, true);

    const cached = await mod.handleGetPlayerColors('233034826', { profileId: '24574510' });
    assert.equal(cached.success, false);
    assert.equal(cached.cached, true);
    assert.equal(cached.error, 'blob_fetch_502');
    assert.equal(replayRequests.length, 1);
    assert.equal(blobRequests.length, 1);
  });

  it('does not bypass replay metadata backoff with a profile id', async () => {
    const { chrome } = makeChromeMock({
      initial: { settings: { parseGameData: true, recolorSwatches: true, injectCharts: true } },
    });
    globalThis.chrome = chrome;

    const replayRequests = [];
    installBaseFetchMock(async (href) => {
      if (href.includes('getReplayFiles')) {
        replayRequests.push(href);
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'content-type': 'text/plain' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    const mod = await import(`../../src/background/background.ts?t=${Math.random()}`);
    await new Promise(resolve => setTimeout(resolve, 0));

    const limited = await mod.handleGetPlayerColors('233034826');
    assert.equal(limited.success, false);
    assert.equal(limited.rateLimited, true);
    assert.equal(replayRequests.length, 1);

    const stillLimited = await mod.handleGetPlayerColors('233034826', { profileId: '24574510' });
    assert.equal(stillLimited.success, false);
    assert.equal(stillLimited.rateLimited, true);
    assert.equal(replayRequests.length, 1, 'backoff should avoid a second replay metadata call');
  });
});
