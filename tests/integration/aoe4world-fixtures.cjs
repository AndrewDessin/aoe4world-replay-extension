'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures');
const STATIC_ROOT = path.join(FIXTURE_ROOT, 'static', 'vite', 'assets');
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax3pS8AAAAASUVORK5CYII=',
  'base64',
);

const pageFixtures = [
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/24574510[^/]*\/games\/233034826(?:\?.*)?$/,
    file: 'pages/detail-233034826.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/390531-\/games\/232463035(?:\?.*)?$/,
    file: 'pages/detail-232463035.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/20431588[^/]*\/games\/233206284(?:\?.*)?$/,
    file: 'pages/detail-233206284.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/883212[^/]*\/games\/230521696(?:\?.*)?$/,
    file: 'pages/detail-1v1-spartain.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/24574510[^/]*(?:\/games)?(?:\?.*)?$/,
    file: 'pages/profile-24574510.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/883212[^/]*(?:\/games)?(?:\?.*)?$/,
    file: 'pages/profile-spartain.html',
  },
  {
    pattern: /^https:\/\/aoe4world\.com\/players\/2942077[^/]*\/games(?:\?.*)?$/,
    file: 'pages/profile-valdy.html',
  },
];

const summaryFixtures = [
  {
    pattern: /\/players\/24574510[^/]*\/games\/233034826\/summary/,
    file: 'summary-233034826.json',
  },
  {
    pattern: /\/players\/390531-\/games\/232463035\/summary/,
    file: 'summary-232463035.json',
  },
  {
    pattern: /\/players\/20431588[^/]*\/games\/233206284\/summary/,
    file: 'summary-233206284.json',
  },
  {
    pattern: /\/players\/883212[^/]*\/games\/230521696\/summary/,
    file: 'summary-230521696.json',
  },
];

async function installAoe4WorldFixtureRoutes(page) {
  await page.route('https://data.aoe4world.com/images/units/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_1X1,
    });
  });

  await page.route('https://static.aoe4world.com/vite/assets/**', async (route) => {
    const url = new URL(route.request().url());
    const assetPath = path.join(STATIC_ROOT, path.basename(url.pathname));
    const ext = path.extname(assetPath);
    const contentType = ext === '.css' ? 'text/css' : 'application/javascript';
    if (fs.existsSync(assetPath)) {
      await route.fulfill({
        status: 200,
        contentType,
        body: fs.readFileSync(assetPath),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType,
      body: ext === '.css' ? '' : 'export {};',
    });
  });

  await page.route('https://aoe4world.com/**', async (route) => {
    const url = route.request().url();
    const summaryFixture = summaryFixtures.find((fixture) => fixture.pattern.test(url));
    if (summaryFixture) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fs.readFileSync(path.join(FIXTURE_ROOT, summaryFixture.file), 'utf8'),
      });
      return;
    }

    const pageFixture = pageFixtures.find((fixture) => fixture.pattern.test(url));
    if (pageFixture) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fs.readFileSync(path.join(FIXTURE_ROOT, pageFixture.file), 'utf8'),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: `No aoe4world fixture registered for ${url}`,
    });
  });
}

module.exports = { installAoe4WorldFixtureRoutes };
