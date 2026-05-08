// Regression for: clicking favorite-star scraped only {gameId, pageUrl}
// instead of {map, mode, team1, team2}. Root cause: star.dataset.gameId
// caused scrapeGameMeta's `[data-game-id="X"]` selector to match the star
// (sibling of the row, lower in document order than the row's wrapper but
// matched first by querySelector) instead of the row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBundle, loadFixture } from '../helpers/boot-bundle.mjs';

const GAME_ID = '230521696';
const URL = `https://aoe4world.com/players/883212-Spartain/games/${GAME_ID}?sig=05fdb0fcce309a6b8cc5d7d3dc616e7e0f79d683`;

test('Bug B: saveFavorite carries map/teams when row is in DOM', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => {
      if (msg.type === 'isFavorite') return { isFavorite: false };
      if (msg.type === 'saveFavorite') return { success: true };
      return { ok: true };
    },
  });

  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  assert.ok(star, 'favorite star should mount on detail page');

  star.dispatchEvent(new env.window.Event('click', { bubbles: true, cancelable: true }));
  await env.tick();

  const save = env.messages.find(m => m.type === 'saveFavorite');
  assert.ok(save, 'saveFavorite message should be sent');
  assert.equal(save.matchId, GAME_ID);
  assert.equal(save.meta.gameId, GAME_ID);
  assert.equal(save.meta.map, 'Dry Arabia', 'map should be scraped from row');
  assert.match(save.meta.mode, /RM/, 'mode should be scraped from row');
  assert.ok(Array.isArray(save.meta.team1) && save.meta.team1.length > 0, 'team1 must be populated');
  assert.ok(Array.isArray(save.meta.team2) && save.meta.team2.length > 0, 'team2 must be populated');
  assert.ok(save.meta.team1.includes('Spartain'), 'Spartain should be in team1');
});

test('Bug B: star uses data-aoe4-fav-game-id, not data-game-id', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
  });

  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  assert.ok(star, 'star mounted');
  assert.equal(star.dataset.aoe4FavGameId, GAME_ID, 'star should use namespaced attribute');
  assert.equal(star.dataset.gameId, undefined, 'star MUST NOT use data-game-id (collides with rows)');
});

test('Bug B: scrapeGameMeta selector skips our star even if both attrs present', async () => {
  // Defense-in-depth: even if a future change re-adds data-game-id to the
  // star, scrapeGameMeta should still hit the rowgroup. The :not selector
  // and the [role="rowgroup"] preferred selector both protect against it.
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => {
      if (msg.type === 'isFavorite') return { isFavorite: false };
      if (msg.type === 'saveFavorite') return { success: true };
      return { ok: true };
    },
  });

  await env.waitForScan();
  const star = env.document.querySelector('.aoe4-fav-star');
  star.dataset.gameId = GAME_ID;

  star.dispatchEvent(new env.window.Event('click', { bubbles: true, cancelable: true }));
  await env.tick();

  const save = env.messages.find(m => m.type === 'saveFavorite');
  assert.ok(save?.meta?.map, 'BUG B regression: scrapeGameMeta picked up the star instead of row');
  assert.equal(save.meta.map, 'Dry Arabia');
});
