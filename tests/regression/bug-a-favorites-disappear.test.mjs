// Regression for: clicking the favorite star made it disappear visually
// on the detail page. Root cause hypothesis: the FontAwesome SVG kit
// auto-replaces any <i class="fa-..."> in the document, detaching our
// element. Fix: use a <span> with Unicode glyphs (no FA classes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBundle, loadFixture } from '../helpers/boot-bundle.mjs';

const GAME_ID = '230521696';
const URL = `https://aoe4world.com/players/883212-Spartain/games/${GAME_ID}?sig=05fdb0fcce309a6b8cc5d7d3dc616e7e0f79d683`;

test('Bug A: star is a <span> with Unicode glyph (not FA <i>)', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
  });
  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  assert.ok(star, 'star mounted');
  assert.equal(star.tagName.toLowerCase(), 'span', 'star must be <span>, not <i> (FA SVG kit replaces <i>)');
  assert.match(star.className, /^aoe4-fav-star$/, 'no FA classes that would trigger auto-replace');
  assert.ok(!/\bfa-/.test(star.className), 'no fa-* class names');
  assert.equal(star.textContent, '\u2606', 'unsaved state shows hollow star ☆');
  assert.equal(star.dataset.state, 'unsaved');
});

test('Bug A: clicking star toggles to saved state and stays in DOM', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => {
      if (msg.type === 'isFavorite') return { isFavorite: false };
      if (msg.type === 'saveFavorite') return { success: true };
      if (msg.type === 'removeFavorite') return { success: true };
      return { ok: true };
    },
  });
  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  assert.ok(star, 'star mounted');

  star.dispatchEvent(new env.window.Event('click', { bubbles: true, cancelable: true }));
  await env.tick();

  const after = env.document.querySelector('.aoe4-fav-star');
  assert.ok(after, 'BUG A: star vanished from DOM after click');
  assert.equal(after, star, 'star reference is stable across click');
  assert.equal(after.dataset.state, 'saved', 'state flipped to saved');
  assert.equal(after.textContent, '\u2605', 'saved state shows filled star ★');
  assert.equal(after.dataset.busy, undefined, 'busy flag cleared');
  assert.equal(after.title, 'Remove from saved');
});

test('Bug A: state probe uses dataset.state, not className', async () => {
  // Old impl used `star.classList.contains('fas')` to decide save-vs-remove.
  // With the new <span> + Unicode design there are no fas/far classes, so
  // any leftover className-based probe would always read "unsaved" and
  // re-save on every click. Verify a second click flips back to unsaved.
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => {
      if (msg.type === 'isFavorite') return { isFavorite: false };
      if (msg.type === 'saveFavorite') return { success: true };
      if (msg.type === 'removeFavorite') return { success: true };
      return { ok: true };
    },
  });
  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  star.dispatchEvent(new env.window.Event('click', { bubbles: true, cancelable: true }));
  await env.tick();
  assert.equal(star.dataset.state, 'saved');

  star.dispatchEvent(new env.window.Event('click', { bubbles: true, cancelable: true }));
  await env.tick();
  assert.equal(star.dataset.state, 'unsaved', 'second click should remove');

  const types = env.messages.filter(m => m.type === 'saveFavorite' || m.type === 'removeFavorite').map(m => m.type);
  assert.deepEqual(types, ['saveFavorite', 'removeFavorite'], 'click sequence: save then remove');
});

test('Bug A: storage.onChanged echo updates star state across tabs', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
  });
  await env.waitForScan();

  const star = env.document.querySelector('.aoe4-fav-star');
  assert.equal(star.dataset.state, 'unsaved');

  env.fanout({
    [`fav_${GAME_ID}`]: { oldValue: undefined, newValue: { matchId: GAME_ID, time: Date.now() } },
  });
  await env.tick();
  assert.equal(star.dataset.state, 'saved', 'storage echo should flip star to saved');

  env.fanout({
    [`fav_${GAME_ID}`]: { oldValue: { matchId: GAME_ID }, newValue: undefined },
  });
  await env.tick();
  assert.equal(star.dataset.state, 'unsaved', 'storage removal echo should flip star to unsaved');
});

test('Bug A: tryAddFavoriteStar is idempotent (no duplicate stars)', async () => {
  const html = loadFixture('detail-1v1-spartain.html');
  const env = bootBundle({
    html, url: URL,
    sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
  });
  await env.waitForScan();

  const initial = env.document.querySelectorAll('.aoe4-fav-star').length;
  assert.equal(initial, 1, 'exactly one star at boot');

  await env.tick(50);
  await env.tick(50);

  const final = env.document.querySelectorAll('.aoe4-fav-star').length;
  assert.equal(final, 1, 'still exactly one star after re-scans');
});
