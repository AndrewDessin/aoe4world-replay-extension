#!/usr/bin/env node
// Bundle src/content/entry.js into chrome-extension/content.js.
// IIFE format because MV3 content scripts cannot use ES modules at load time.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src', 'content', 'entry.ts');
const outfile = path.join(root, 'chrome-extension', 'content.js');

const watch = process.argv.includes('--watch');
const sizeBudget = 262144;

async function run() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
    charset: 'utf8',
    keepNames: true,
    legalComments: 'none',
    logLevel: 'info',
    write: true,
  });
  const bytes = fs.statSync(outfile).size;
  console.log(`bundle: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
  if (bytes > sizeBudget) {
    console.error(`bundle exceeds ${sizeBudget} byte budget`);
    process.exit(1);
  }
  if (result.warnings?.length) {
    for (const w of result.warnings) console.warn(w);
  }
}

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
    charset: 'utf8',
    keepNames: true,
    legalComments: 'none',
    logLevel: 'info',
    sourcemap: 'linked',
  });
  await ctx.watch();
  console.log('watching src/content/...');
} else {
  await run();
}
