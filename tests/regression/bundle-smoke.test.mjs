// Smoke: the bundled IIFE evaluates against a real fixture page without
// throwing, and produces the expected DOM artifacts (favorite star).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootBundle, loadFixture } from '../helpers/boot-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

test('bundle exists and is under 256 KB', () => {
  const stats = statSync(path.join(ROOT, 'chrome-extension', 'content.js'));
  assert.ok(stats.size > 1000, 'bundle too small to be valid');
  assert.ok(stats.size < 256 * 1024, `bundle ${stats.size}B exceeds 256KB budget`);
});

test('bundle evaluates against detail page without throwing', async () => {
  let threw = null;
  try {
    bootBundle({
      html: loadFixture('detail-1v1-spartain.html'),
      url: 'https://aoe4world.com/players/883212-Spartain/games/230521696?sig=x',
      sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
    });
  } catch (e) { threw = e; }
  assert.equal(threw, null, threw?.stack || 'no error');
});

test('bundle injects favorite star on detail page', async () => {
  const env = bootBundle({
    html: loadFixture('detail-1v1-spartain.html'),
    url: 'https://aoe4world.com/players/883212-Spartain/games/230521696?sig=x',
    sendMessageImpl: (msg) => msg.type === 'isFavorite' ? { isFavorite: false } : { ok: true },
  });
  await env.waitForScan();
  const star = env.document.querySelector('.aoe4-fav-star');
  assert.ok(star, 'star should mount on detail page');
});

test('bundle does not inject favorite star on profile/listing page', async () => {
  const env = bootBundle({
    html: loadFixture('profile-spartain.html'),
    url: 'https://aoe4world.com/players/883212-Spartain',
    sendMessageImpl: () => ({ ok: true }),
  });
  await env.waitForScan();
  const star = env.document.querySelector('.aoe4-fav-star');
  assert.equal(star, null, 'no star on profile page (no Game # heading)');
});

test('bundle is wrapped as IIFE (not ESM export)', () => {
  const code = readFileSync(path.join(ROOT, 'chrome-extension', 'content.js'), 'utf8');
  const head = code.slice(0, 200).replace(/\s+/g, ' ');
  assert.ok(/^\(?(?:"use strict";?\s*)?\(\s*\(\)\s*=>\s*\{|^\(function/.test(head),
    `bundle should be IIFE; got: ${head.slice(0,80)}`);
});
