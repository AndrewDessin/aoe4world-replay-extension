/**
 * Integration test: Macedonian Silver chart visibility
 *
 * Verifies that the extension does not relabel Macedonian scalar-only Silver as
 * Olive Oil, and does not invent a fake Silver time-series when aoe4world only
 * exposes a final scalar total.
 *
 * The summary API response is intercepted so the test is deterministic and does
 * not depend on live aoe4world behaviour.
 *
 * Game used: 233206284 (Twon LEGEND — macedonian_dynasty / byzantine_ha_mac)
 * Local artifact: tests/fixtures/summary-233206284.json
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { installReplayApiMock } = require('./replay-api-mock.cjs');
const { installAoe4WorldFixtureRoutes } = require('./aoe4world-fixtures.cjs');

const EXT_PATH = path.resolve(__dirname, '..', '..', 'chrome-extension');
const PROFILE_PATH = path.join(__dirname, '.pw-profile-mac-silver');

// The live game page — extension content scripts match aoe4world.com/* only.
const GAME_URL =
  'https://aoe4world.com/players/20431588-1-John-2-1/games/233206284?sig=018b32b1f8cdaacce4404d9e9107358aa01698ef';

let ctx, bg, page;

async function setup() {
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch (_) {}
  ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  bg = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  await bg.evaluate((s) => new Promise(r => chrome.storage.local.set({ settings: s }, r)), {
    parseGameData: true,
    injectCharts: true,
    recolorSwatches: false,
    debugLogs: false,
  });
  await installReplayApiMock(bg);
  page = ctx.pages()[0] || await ctx.newPage();
  await installAoe4WorldFixtureRoutes(page);
}

async function teardown() {
  if (ctx) await ctx.close().catch(() => {});
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch (_) {}
}

async function navigate(url, waitMs = 14000) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
}

// --- Minimal test harness ---

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// --- Tests ---

(async () => {
  console.log('\n=== Macedonian Silver Chart ===');
  await setup();
  await navigate(GAME_URL);

  await test('optgroup with custom chart options is injected', async () => {
    const count = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      return og ? og.querySelectorAll('option').length : 0;
    });
    assert(count >= 1, `expected custom chart options, got ${count}`);
  });

  await test('Silver chart option is absent when no Silver time-series exists', async () => {
    const silverOption = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      if (!og) return null;
      const opt = [...og.querySelectorAll('option')].find(o =>
        o.value.includes('resources-gathered-silver'),
      );
      return opt ? opt.textContent : null;
    });
    assert(
      silverOption === null,
      `Silver chart should not be synthesized without time-series data, got "${silverOption}"`,
    );
  });

  await test('Olive Oil chart option is absent for Macedonian game', async () => {
    const oliveOption = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      if (!og) return null;
      const opt = [...og.querySelectorAll('option')].find(o =>
        o.value.includes('resources-gathered-oliveoil'),
      );
      return opt ? opt.textContent : null;
    });
    assert(
      oliveOption === null,
      `Olive Oil option should not appear for a Macedonian game, got "${oliveOption}"`,
    );
  });

  await teardown();

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
