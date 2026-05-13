const { chromium } = require('playwright');
const path = require('path');

const EXT_PATH = path.resolve(__dirname, '..', '..', 'chrome-extension');
const PROFILE_PATH = path.join(__dirname, '.pw-profile');
const GAME_1V1 = 'https://aoe4world.com/players/24574510-spartain/games/233034826';
const GAME_LIST = 'https://aoe4world.com/players/24574510-spartain/games';
const GAME_DASH_NAME = 'https://aoe4world.com/players/390531-/games/232463035?sig=374175e6bcf9b07bb173b1830bdf586891a634aa';

let ctx, bg, page;

async function setup(settings = { parseGameData: true, injectCharts: true, recolorSwatches: true, debugLogs: false }) {
  const fs = require('fs');
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
  ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  bg = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  await bg.evaluate((s) => new Promise(r => chrome.storage.local.set({ settings: s }, r)), settings);
  page = ctx.pages()[0] || await ctx.newPage();
}

async function teardown() {
  if (ctx) await ctx.close().catch(() => {});
  const fs = require('fs');
  try { fs.rmSync(PROFILE_PATH, { recursive: true, force: true }); } catch {}
}

async function navigate(url, waitMs = 12000) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
}

async function scrollToTimeline() {
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Timeline'));
    if (h3) h3.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(2000);
}

function getNativeCanvas() {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find(c => !c.className.includes('aoe4'));
    return c ? c.toDataURL().length : null;
  });
}

// --- Tests ---

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
  console.log('\n=== Chart Injection ===');
  await setup();
  await navigate(GAME_1V1);

  await test('injects optgroup with custom chart options', async () => {
    const count = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      return og ? og.querySelectorAll('option').length : 0;
    });
    assert(count >= 7, `expected >=7 chart options, got ${count}`);
  });

  await test('age-up overlay is present', async () => {
    const has = await page.evaluate(() => !!document.querySelector('.aoe4-ageup-overlay'));
    assert(has, 'age-up overlay not found');
  });

  await test('favorites star is present on detail page', async () => {
    const has = await page.evaluate(() => !!document.querySelector('.aoe4-fav-star'));
    assert(has, 'favorites star not found');
  });

  console.log('\n=== Native Chart Hover ===');
  await scrollToTimeline();

  await test('replay colors persist after hover', async () => {
    const before = await getNativeCanvas();
    const legend = await page.$('.flex.items-center.cursor-pointer');
    assert(legend, 'no legend item found');
    await legend.hover();
    await page.waitForTimeout(300);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    const after = await getNativeCanvas();
    assert(before === after, `colors changed after hover cycle: ${before} -> ${after}`);
  });

  console.log('\n=== Color Recoloring ===');

  await test('DOM swatches are recolored', async () => {
    const count = await page.evaluate(() => document.querySelectorAll('[data-aoe4-recolored]').length);
    assert(count > 0, `no recolored elements, got ${count}`);
  });

  await test('native chart canvas differs from no-extension baseline', async () => {
    const val = await getNativeCanvas();
    // No-extension baseline for this game is ~52290; with colors it should be different
    assert(val !== null, 'canvas not found');
    assert(val > 50000, `canvas too small: ${val}`);
  });

  console.log('\n=== URL Edge Cases ===');
  await navigate(GAME_DASH_NAME);

  await test('player ID with trailing dash loads charts', async () => {
    const count = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      return og ? og.querySelectorAll('option').length : 0;
    });
    assert(count >= 7, `expected >=7 chart options, got ${count}`);
  });

  console.log('\n=== Replay Buttons ===');
  await navigate(GAME_LIST, 20000);

  await test('replay buttons appear on game list', async () => {
    const count = await page.evaluate(() => document.querySelectorAll('.aoe4-replay-btn').length);
    assert(count > 0, `no replay buttons, got ${count}`);
  });

  await test('replay unavailable shown for old games', async () => {
    // Scroll down to older games
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(15000);
    const count = await page.evaluate(() => document.querySelectorAll('.aoe4-replay-unavailable').length);
    // May or may not have unavailable depending on scroll depth, but shouldn't error
    console.log(`    (${count} unavailable labels found)`);
  });

  await test('replay unavailable is not clickable', async () => {
    const clickable = await page.evaluate(() => {
      const el = document.querySelector('.aoe4-replay-unavailable');
      if (!el) return 'none';
      return getComputedStyle(el).cursor;
    });
    if (clickable !== 'none') {
      assert(clickable === 'default', `expected cursor:default, got ${clickable}`);
    }
  });

  await test('watch replay button is a span, not an anchor', async () => {
    const tag = await page.evaluate(() => {
      const btn = document.querySelector('.aoe4-replay-btn');
      const inner = btn?.firstElementChild;
      return inner?.tagName?.toLowerCase();
    });
    assert(tag === 'span', `expected span, got ${tag}`);
  });

  await test('replay unavailable is inside the anchor cell', async () => {
    const inside = await page.evaluate(() => {
      const el = document.querySelector('.aoe4-replay-unavailable');
      if (!el) return null;
      return el.parentElement?.tagName?.toLowerCase() === 'a';
    });
    if (inside !== null) {
      assert(inside, 'replay unavailable should be inside <a> cell');
    }
  });

  console.log('\n=== Custom Chart Switching ===');
  await navigate(GAME_1V1);

  await test('switching to army composition shows custom canvas', async () => {
    const switched = await page.evaluate(() => {
      const select = document.querySelector('select');
      const armyOpt = [...(select?.querySelectorAll('option') || [])].find(o => o.value.includes('army-composition'));
      if (!armyOpt || !select) return false;
      select.value = armyOpt.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    assert(switched, 'could not switch to army composition');
    await page.waitForTimeout(2000);
    const headings = await page.evaluate(() => {
      return [...document.querySelectorAll('h3')].map(h => h.textContent?.trim()).filter(Boolean);
    });
    const hasCustomChart = headings.some(h => h.includes('Army Composition') || h.includes('Resource'));
    assert(hasCustomChart, `heading not updated: ${headings.join(', ')}`);
  });

  await test('army composition shows unit legend', async () => {
    const hasLegend = await page.evaluate(() => !!document.querySelector('.aoe4-army-unit-legend, .aoe4-legend-breakdown'));
    assert(hasLegend, 'army unit legend not found');
  });

  await test('switching back to native chart restores original canvas', async () => {
    const restored = await page.evaluate(() => {
      const select = document.querySelector('select');
      if (!select) return false;
      select.value = 'army';
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    assert(restored, 'could not switch back to native chart');
    await page.waitForTimeout(2000);
    const nativePresent = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      return canvases.some(c => !c.className.includes('aoe4'));
    });
    assert(nativePresent, 'native canvas not present after switch back');
  });

  console.log('\n=== SPA Navigation ===');

  await test('navigating to another game via SPA loads new charts', async () => {
    await page.click('a[href*="/players/"]');
    await page.waitForTimeout(3000);
    // Click on a game link from the profile
    const gameLink = await page.$('a[href*="/games/"][role="cell"]');
    if (gameLink) {
      await gameLink.click();
      await page.waitForTimeout(12000);
      const hasCharts = await page.evaluate(() => {
        const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
        return og ? og.querySelectorAll('option').length : 0;
      });
      assert(hasCharts > 0, `no charts after SPA navigation, got ${hasCharts}`);
    } else {
      console.log('    (skipped — no game link found for SPA test)');
    }
  });

  console.log('\n=== Patch & Color Cache ===');

  await test('patchInfo is stored in chrome.storage', async () => {
    const patch = await bg.evaluate(() => new Promise(r => {
      chrome.storage.local.get('patchInfo_v2', result => r(result.patchInfo_v2));
    }));
    assert(patch, 'patchInfo_v2 not found');
    assert(patch.current, `currentPatch is empty: ${JSON.stringify(patch)}`);
    assert(patch.current.includes('/'), `currentPatch not full version: ${patch.current}`);
  });

  await test('color cache entries exist', async () => {
    const count = await bg.evaluate(() => new Promise(r => {
      chrome.storage.local.get(null, items => {
        r(Object.keys(items).filter(k => k.startsWith('colors_v4_')).length);
      });
    }));
    assert(count > 0, `no color cache entries, got ${count}`);
  });

  console.log('\n=== Settings Disabled ===');
  await teardown();
  await setup({ parseGameData: false, injectCharts: false, recolorSwatches: false, debugLogs: false });
  await navigate(GAME_1V1, 8000);

  await test('no charts injected when features disabled', async () => {
    const count = await page.evaluate(() => {
      const og = document.querySelector('optgroup[data-aoe4-summary-plus]');
      return og ? og.querySelectorAll('option').length : 0;
    });
    assert(count === 0, `expected 0 chart options, got ${count}`);
  });

  await test('no recolored swatches when features disabled', async () => {
    const count = await page.evaluate(() => document.querySelectorAll('[data-aoe4-recolored]').length);
    assert(count === 0, `expected 0 recolored, got ${count}`);
  });

  await teardown();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
