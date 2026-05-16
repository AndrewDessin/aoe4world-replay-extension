'use strict';

const fs = require('fs');
const path = require('path');

const REPLAY_FIXTURE_PATH = path.resolve(__dirname, '..', 'fixtures', 'replay', '1v1-spartain.gz');

function replayFixtureBase64() {
  return fs.readFileSync(REPLAY_FIXTURE_PATH).toString('base64');
}

async function installReplayApiMock(bg, options = {}) {
  await bg.evaluate(
    ({ replayB64, replayMetadataFails = false, replayMetadataFailsOnce = false, replayBlobFails = false, replayBlobFailsOnce = false }) => {
      const bytesFromBase64 = (b64) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      };

      const replayBytes = bytesFromBase64(replayB64);
      const originalFetch = globalThis.fetch.bind(globalThis);
      const state = {
        replayMetadataCalls: 0,
        blobReplayCalls: 0,
      };
      globalThis.__aoe4ReplayApiMockState = state;

      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        const href = String(url || '');

        if (href === 'https://aoe4world.com/api/v0/games?limit=5&state=finished') {
          return new Response(JSON.stringify({
            games: [
              { game_id: 233034826, patch: '4.0.0/8719' },
              { game_id: 233206284, patch: '4.0.0/8719' },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (href.includes('aoe-api.worldsedgelink.com') && href.includes('getReplayFiles')) {
          state.replayMetadataCalls++;
          if (replayMetadataFails || (replayMetadataFailsOnce && state.replayMetadataCalls === 1)) {
            return new Response('Bad Gateway', {
              status: 502,
              headers: { 'content-type': 'text/plain' },
            });
          }

          const decoded = decodeURIComponent(href);
          const idsText = decoded.match(/matchIDs=\[([^\]]*)\]/)?.[1] || '';
          const ids = idsText.split(',').map(s => s.trim()).filter(Boolean);
          const replayFiles = ids.map(id => ({
            datatype: 0,
            size: replayBytes.byteLength,
            matchhistory_id: Number(id),
            url: `https://fixture.test/cloudfiles/883212/aoelive_/age4/replay/windows/4.0.0/8719/M_${id}_fixture.gz`,
          }));

          return new Response(JSON.stringify({
            result: { code: 0, message: 'SUCCESS' },
            expiryUnix: Math.floor(Date.now() / 1000) + 3600,
            replayFiles,
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (href.startsWith('https://fixture.test/')) {
          state.blobReplayCalls++;
          if (replayBlobFails || (replayBlobFailsOnce && state.blobReplayCalls === 1)) {
            return new Response('Bad Gateway', {
              status: 502,
              headers: { 'content-type': 'text/plain' },
            });
          }

          return new Response(replayBytes.slice(), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          });
        }

        return originalFetch(input, init);
      };
    },
    {
      replayB64: replayFixtureBase64(),
      replayMetadataFails: options.replayMetadataFails === true,
      replayMetadataFailsOnce: options.replayMetadataFailsOnce === true,
      replayBlobFails: options.replayBlobFails === true,
      replayBlobFailsOnce: options.replayBlobFailsOnce === true,
    },
  );
}

module.exports = { installReplayApiMock };
