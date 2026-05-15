/**
 * Integration test: injected aoe4plus charts animate over multiple frames
 * instead of appearing fully rendered immediately.
 *
 * Run: node tests/integration/injected-chart-animation.test.cjs
 *
 * The regression being tested:
 *   attachTimelineHoverGuard installs mouseover/mouseout listeners on
 *   timeline.root. When those fire (which happens whenever the user moves
 *   the mouse near the timeline after selecting a chart), the guard calls
 *   drawTimelineCanvasChart() without preserveAnimation:true, which in turn
 *   calls cancelTimelineCanvasAnimation(), killing the RAF loop after at most
 *   one visible frame. The chart therefore appears fully-rendered immediately.
 *
 * Detection strategy:
 *   The animation changes over time. Resource charts rise from the y-baseline;
 *   other injected charts reveal left-to-right. Either way, the plotted series
 *   is visibly incomplete early.
 *
 *   With the BUG:
 *     The guard cancels the animation and draws the full chart immediately.
 *     The centre strip has high alpha at t=50ms (series lines visible).
 *
 *   With the FIX:
 *     The guard skips the redraw while animation is in progress.
 *     The centre strip differs at t=50ms because the resource series is still
 *     near the baseline rather than at its final shape.
 *     At t=950ms the animation is complete and the centre strip has full alpha.
 *
 * NOTE: Chrome extension content scripts run in an isolated world.  Expando
 * properties set by content scripts on DOM elements (e.g. __aoe4AnimationToken)
 * are NOT visible from page.evaluate() which runs in the main world.  All
 * assertions therefore rely on visible canvas pixel data (getImageData).
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { installReplayApiMock } = require('./replay-api-mock.cjs');
const { installAoe4WorldFixtureRoutes } = require('./aoe4world-fixtures.cjs');

const EXT_PATH = path.resolve(__dirname, '..', '..', 'chrome-extension');
const PROFILE_PATH = path.join(__dirname, '.pw-profile-anim');
const GAME_1V1 = 'https://aoe4world.com/players/24574510-spartain/games/233034826';

let ctx, bg, page;

async function setup() {
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
  ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  bg = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  // Disable recolorSwatches so that no async color-update re-renders interfere
  // with the animation timing. The only canvas changes will be from the chart
  // animation itself.
  await bg.evaluate((s) => new Promise(r => chrome.storage.local.set({ settings: s }, r)), {
    parseGameData: true, injectCharts: true, recolorSwatches: false, debugLogs: false,
  });
  await installReplayApiMock(bg);
  page = ctx.pages()[0] || await ctx.newPage();
  await installAoe4WorldFixtureRoutes(page);
}

async function teardown() {
  if (ctx) await ctx.close().catch(() => {});
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
}

async function navigate(url, waitMs = 14000) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
}

/**
 * Reads the alpha sum of the CENTRE VERTICAL STRIP of the injected canvas.
 *
 * Strip: x = [50%..60%] of canvas.width, full height.
  * The animation starts resource series near the y-baseline. During the early
  * rise-up reveal, this full-height strip contains only a small portion of the
  * final series pixels; at progress = 1 it contains the full final series — so
  * alphaSum is still lower and the hash differs.
 */
function getCentreStripAlpha() {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-aoe4-summary-canvas]');
    if (!canvas) return null;
    const w = canvas.width || 0;
    const h = canvas.height || 0;
    if (!w || !h) return { w, h, alphaSum: 0, hash: 'empty' };
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return { w, h, alphaSum: -1, hash: 'no-ctx' };
    const stripX = Math.floor(w * 0.5);
    const stripW = Math.max(1, Math.floor(w * 0.1));
    let data;
    try {
      data = ctx2d.getImageData(stripX, 0, stripW, h);
    } catch (_) {
      // canvas may be tainted; fall back to full hash
      const url = canvas.toDataURL();
      let hash = 2166136261;
      for (let i = 0; i < url.length; i++) {
        hash ^= url.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return { w, h, alphaSum: -2, hash: hash.toString(16) };
    }
    let alphaSum = 0;
    let hashV = 2166136261;
    for (let i = 0; i < data.data.length; i++) {
      if (i % 4 === 3) alphaSum += data.data[i];
      hashV ^= data.data[i];
      hashV = Math.imul(hashV, 16777619) >>> 0;
    }
    return { w, h, alphaSum, hash: hashV.toString(16) };
  });
}

/**
 * Select the first resource "gathered" chart option (a line chart — no async
 * army icon loading) and IMMEDIATELY dispatch a synthetic mouseover on the
 * timeline heading.
 *
 * The mouseover simulates real-user behaviour after clicking the dropdown:
 * the browser fires mouseover/mouseout events as the dropdown closes and
 * the mouse moves into the timeline area. This is precisely what triggers
 * the hover guard (attachTimelineHoverGuard) and exposes the animation bug.
 *
 * Returns the selected option value, or null if unavailable.
 */
function selectResourceChartAndTriggerGuard() {
  return page.evaluate(() => {
    const select = document.querySelector('select');
    if (!select) return null;
    const og = select.querySelector('optgroup[data-aoe4-summary-plus]');
    if (!og) return null;
    const opts = [...og.querySelectorAll('option')];
    // Prefer a "gathered" resource chart: pure line chart, no async operations.
    const opt = opts.find(o => o.value.includes('gathered') || o.value.includes('resource')) || opts[0];
    if (!opt) return null;

    select.value = opt.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // Trigger the hover guard by dispatching mouseover on the timeline heading.
    // The guard is attached with capture:true on timeline.root and fires for
    // any mouseover whose target is NOT the canvas itself.
    // We look for the heading AFTER the chart has been selected (its text is
    // now the chart title, e.g. "Food Gathered").
    const allH3 = [...document.querySelectorAll('h3')];
    const heading = allH3.find(h =>
      h.textContent.includes('Gathered') ||
      h.textContent.includes('Resource') ||
      h.textContent.includes('Food') ||
      h.textContent.includes('Wood') ||
      h.textContent.includes('Gold') ||
      h.textContent.includes('Army') ||
      h.textContent.includes('Destroyed') ||
      h.textContent.includes('Lead'),
    ) || allH3.find(h => !!h.closest('[data-aoe4-summary-plus-url]'));
    if (heading) {
      heading.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    }

    return opt.value;
  });
}

// --- Minimal isolated test harness ---

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

(async () => {
  console.log('\n=== Injected Chart Animation ===');
  await setup();
  await navigate(GAME_1V1);

  // Scroll timeline into view so the canvas has real layout dimensions.
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Timeline'));
    if (h3) h3.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(1000);

  // Prerequisite: charts are injected.
  await test('injected chart options are present', async () => {
    const count = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      return og ? og.querySelectorAll('option').length : 0;
    });
    assert(count >= 7, `expected >=7 chart options, got ${count}`);
  });

  /**
   * PRIMARY TEST — centre strip differs during early animation phase.
   *
   * Trigger the hover guard immediately after chart selection.  If the guard
   * cancels the animation (bug), the full chart is drawn at once and the
   * centre strip has HIGH alpha at t=50ms.  If the guard correctly skips the
    * redraw while animation is running (fix), the resource line is still near
    * the baseline at t=50ms, so this strip is visibly different from the final
    * frame. After 900ms the animation is complete and the strip is full.
   *
    * Assertion: earlyAlpha < lateAlpha × 0.95 and early hash differs.
    *   Bug: full redraw immediately → same hash and near-identical alpha.
    *   Fix: animated frame → different hash and lower alpha.
    */
  await test('centre strip changes during animation (guard does not cancel it)', async () => {
    await page.mouse.move(50, 50);
    await page.waitForTimeout(100);

    const selectedValue = await selectResourceChartAndTriggerGuard();
    assert(selectedValue, 'could not select a resource chart option');
    assert(selectedValue.startsWith('aoe4plus:'), `expected aoe4plus: prefix, got ${selectedValue}`);

    // Allow 2–3 RAF cycles for the guard RAF callback to fire.
    await page.waitForTimeout(50);
    const earlySnap = await getCentreStripAlpha();

    // Wait well past the 750ms animation duration.
    await page.waitForTimeout(900);
    const lateSnap = await getCentreStripAlpha();

    assert(earlySnap, 'injected canvas not found at early snapshot');
    assert(lateSnap, 'injected canvas not found at late snapshot');
    assert(earlySnap.w > 0 && earlySnap.h > 0,
      `injected canvas has no dimensions: ${JSON.stringify(earlySnap)}`);
    assert(lateSnap.alphaSum > 0,
      `late canvas centre strip is empty — chart never rendered. ${JSON.stringify(lateSnap)}`);

    const threshold = lateSnap.alphaSum * 0.95;
    assert(
      earlySnap.alphaSum < threshold,
      `centre strip alpha at 50ms (${earlySnap.alphaSum}) is NOT lower than 95% of the` +
      ` final alpha (${lateSnap.alphaSum} × 0.95 = ${Math.round(threshold)}) — ` +
      `animation was cancelled by the hover guard (full chart drawn immediately). ` +
      `early=${JSON.stringify(earlySnap)}, late=${JSON.stringify(lateSnap)}`,
    );
    assert(
      earlySnap.hash !== lateSnap.hash,
      `early and late canvas strip hashes are identical — animation likely completed immediately. ` +
      `early=${JSON.stringify(earlySnap)}, late=${JSON.stringify(lateSnap)}`,
    );

    console.log(`    early (50ms):  alphaSum=${earlySnap.alphaSum} (${earlySnap.w}×${earlySnap.h})`);
    console.log(`    late  (950ms): alphaSum=${lateSnap.alphaSum} threshold=${Math.round(threshold)}`);
  });

  /**
   * SECONDARY TEST — switching charts multiple times each produces animation.
   * Re-selects a different chart, re-triggers the guard, and verifies the
   * same alpha-ratio property holds for the second animation.
   */
  await test('animation also runs on subsequent chart switches', async () => {
    // Switch back to native.
    await page.mouse.move(50, 50);
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const select = document.querySelector('select');
      if (!select) return;
      select.value = 'army';
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    // Re-select the custom chart and trigger the guard again.
    await page.mouse.move(50, 50);
    await page.waitForTimeout(50);

    const selectedValue = await selectResourceChartAndTriggerGuard();
    assert(selectedValue, 'could not re-select a resource chart option');

    await page.waitForTimeout(50);
    const earlySnap = await getCentreStripAlpha();

    await page.waitForTimeout(900);
    const lateSnap = await getCentreStripAlpha();

    assert(earlySnap && lateSnap, 'canvas snapshots missing on second switch');
    assert(earlySnap.w > 0, `canvas has no width: ${JSON.stringify(earlySnap)}`);
    assert(lateSnap.alphaSum > 0,
      `late canvas empty after second switch. ${JSON.stringify(lateSnap)}`);

    const threshold = lateSnap.alphaSum * 0.95;
    assert(
      earlySnap.alphaSum < threshold,
      `second switch: early alpha (${earlySnap.alphaSum}) not below threshold ` +
      `(${Math.round(threshold)}) — animation cancelled again. ` +
      `early=${JSON.stringify(earlySnap)}, late=${JSON.stringify(lateSnap)}`,
    );
    assert(
      earlySnap.hash !== lateSnap.hash,
      `second switch: early and late hashes are identical — animation likely completed immediately. ` +
      `early=${JSON.stringify(earlySnap)}, late=${JSON.stringify(lateSnap)}`,
    );

    console.log(`    early (50ms):  alphaSum=${earlySnap.alphaSum}`);
    console.log(`    late  (950ms): alphaSum=${lateSnap.alphaSum} threshold=${Math.round(threshold)}`);
  });

  await teardown();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
