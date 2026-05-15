/**
 * Integration test: Army Composition area icons appear without mouse interaction.
 *
 * Regression for: icons failing to draw until mouseout-of-legend or unit-highlight
 * fires a direct drawTimelineCanvasChart call.
 *
 * Strategy: compare canvas pixel signatures before and after a simulated hover.
 * The old bug only drew icons after that hover-triggered redraw, so the signature
 * changed. Fixed behavior has already drawn icons, so the signature is stable.
 * The test also checks the injected legend unit icons before any hover, proving
 * icons actually rendered rather than merely checking a stable canvas.
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const { installReplayApiMock } = require('./replay-api-mock.cjs');
const { installAoe4WorldFixtureRoutes } = require('./aoe4world-fixtures.cjs');

const EXT_PATH = path.resolve(__dirname, '..', '..', 'chrome-extension');
const PROFILE_PATH = path.join(__dirname, '.pw-profile-army-icons');
const GAME_1V1 = 'https://aoe4world.com/players/24574510-spartain/games/233034826';

let ctx, bg, page;

async function setup() {
  const fs = require('fs');
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
  ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
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
  await installReplayApiMock(bg);
  page = ctx.pages()[0] || await ctx.newPage();
  await installAoe4WorldFixtureRoutes(page);
}

async function teardown() {
  if (ctx) await ctx.close().catch(() => {});
  const fs = require('fs');
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
}

// --- Test runner ---
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

async function canvasSignature() {
  return page.evaluate(() => {
    const c = document.querySelector('canvas[data-aoe4-summary-canvas]');
    if (!c) return null;
    const data = c.toDataURL();
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return { length: data.length, hash: hash.toString(16) };
  });
}

async function selectArmyComposition() {
  return page.evaluate(() => {
    const select = document.querySelector('select');
    const armyOpt = [...(select?.querySelectorAll('option') || [])].find(
      o => o.value && o.value.includes('army-composition')
    );
    if (!armyOpt || !select) return false;
    select.value = armyOpt.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
}

async function armyLegendIconState() {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.aoe4-army-unit-row')];
    const images = rows.flatMap(row => [...row.querySelectorAll('img.aoe4-army-unit-icon')]);
    const placeholders = rows.flatMap(row => [...row.querySelectorAll('.aoe4-army-unit-icon-placeholder')]);
    return {
      rows: rows.length,
      images: images.length,
      loadedImages: images.filter(img => img.complete && img.naturalWidth > 0).length,
      placeholders: placeholders.length,
    };
  });
}

async function triggerTimelineHoverGuard() {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-aoe4-summary-canvas]');
    const root = canvas?.closest('[data-aoe4-summary-plus-url]');
    const target = root?.querySelector('h3') || root;
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    return true;
  });
}

(async () => {
  console.log('\n=== Army Composition Icon Auto-Load ===');
  await setup();

  // Navigate and wait for charts to inject
  await page.goto(GAME_1V1, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(12000);

  // Ensure custom chart options are present
  const chartCount = await page.evaluate(() => {
    const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
    return og ? og.querySelectorAll('option').length : 0;
  });
  assert(chartCount > 0, 'no custom chart options found; extension may not have loaded');

  await test('army composition legend icons appear without mouse interaction', async () => {
    // Park the mouse in a neutral corner before anything else so no hover events fire.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    // Switch to army composition.
    const switched = await selectArmyComposition();
    assert(switched, 'could not find / select army-composition option');

    // Do NOT move the mouse or interact with the page at all.
    // Wait long enough for: animation (750 ms) + unit-icon HTTP loads + area-icon HTTP loads.
    await page.waitForTimeout(5000);

    // Verify summary canvas exists and is connected.
    const canvasPresent = await page.evaluate(() => {
      return !!document.querySelector('canvas[data-aoe4-summary-canvas]');
    });
    assert(canvasPresent, 'aoe4 summary canvas not found in DOM after 5 s');

    const iconStateBeforeMouse = await armyLegendIconState();
    assert(iconStateBeforeMouse.rows > 0, 'expected injected army unit legend rows');
    assert(iconStateBeforeMouse.images > 0, `expected legend unit icon images, got ${JSON.stringify(iconStateBeforeMouse)}`);
    assert(
      iconStateBeforeMouse.placeholders === 0,
      `legend still has unit icon placeholders before mouse interaction: ${JSON.stringify(iconStateBeforeMouse)}`
    );
    assert(
      iconStateBeforeMouse.loadedImages === iconStateBeforeMouse.images,
      `not all legend unit icons finished loading before mouse interaction: ${JSON.stringify(iconStateBeforeMouse)}`
    );

    // Capture canvas pixel signature BEFORE any mouse interaction.
    const sigBeforeMouse = await canvasSignature();
    assert(sigBeforeMouse !== null, 'could not read summary canvas toDataURL before mouse move');

    // Trigger the hover guard from the timeline heading/root, not a player row,
    // so this checks redraw stability without legend highlight side effects.
    assert(await triggerTimelineHoverGuard(), 'could not trigger timeline hover guard');
    await page.waitForTimeout(500);

    // Capture canvas pixel signature AFTER mouse interaction.
    const sigAfterMouse = await canvasSignature();
    const iconStateAfterMouse = await armyLegendIconState();

    const sigStr = (s) => s ? `${s.length}:${s.hash}` : 'null';
    console.log(`    legend icons before mouse: ${JSON.stringify(iconStateBeforeMouse)}`);
    console.log(`    legend icons after mouse:  ${JSON.stringify(iconStateAfterMouse)}`);
    console.log(`    before-mouse: ${sigStr(sigBeforeMouse)}`);
    console.log(`    after-mouse:  ${sigStr(sigAfterMouse)}`);
    assert(
      iconStateAfterMouse.placeholders === 0 && iconStateAfterMouse.images === iconStateBeforeMouse.images,
      `legend icon state changed after hover: before=${JSON.stringify(iconStateBeforeMouse)}, after=${JSON.stringify(iconStateAfterMouse)}`
    );

    // KEY assertion: if the chart were waiting for hover-driven redraw work, the hover
    // guard's drawTimelineCanvasChart call would add them, making the canvas DIFFERENT.
    // If icons were already drawn (the fixed behaviour), the canvas is UNCHANGED by hover.
    assert(
      sigBeforeMouse !== null && sigAfterMouse !== null &&
      sigBeforeMouse.hash === sigAfterMouse.hash,
      `canvas changed after mouse interaction, meaning icons were NOT drawn automatically — ` +
      `before=${sigStr(sigBeforeMouse)}, after=${sigStr(sigAfterMouse)}`
    );
  });

  await test('army composition canvas signature is stable after icons load (no mouse)', async () => {
    // Switch away then back to army-composition to get a clean render.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const select = document.querySelector('select');
      if (!select) return;
      select.value = 'army';
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(1000);

    assert(await selectArmyComposition(), 'could not re-select army-composition option');

    // Wait long enough for icons to load and the retry mechanism to draw them.
    await page.waitForTimeout(3000);

    const sigA = await canvasSignature();

    // Wait a further 4 s (no mouse), then sample again.
    await page.waitForTimeout(4000);

    const sigB = await canvasSignature();

    // Trigger hover and sample again.
    assert(await triggerTimelineHoverGuard(), 'could not trigger timeline hover guard');
    await page.waitForTimeout(500);

    const sigC = await canvasSignature();

    const sigStr = (s) => s ? `${s.length}:${s.hash}` : 'null';
    console.log(`    at-3s:         ${sigStr(sigA)}`);
    console.log(`    at-7s:         ${sigStr(sigB)}`);
    console.log(`    after-hover:   ${sigStr(sigC)}`);

    assert(sigA !== null, 'summary canvas not found at 3 s');
    assert(sigB !== null, 'summary canvas not found at 7 s');
    assert(sigC !== null, 'summary canvas not found after hover');

    // The canvas should be stable (icons drawn) before any mouse interaction.
    assert(
      sigA.hash === sigC.hash,
      `canvas changed after hover — icons were not pre-drawn without mouse interaction: ` +
      `3s=${sigStr(sigA)}, after-hover=${sigStr(sigC)}`
    );
  });

  await teardown();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
