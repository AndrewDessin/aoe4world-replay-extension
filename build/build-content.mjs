#!/usr/bin/env node
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => path.join(root, 'chrome-extension', ...p);
const src = (...p) => path.join(root, 'src', ...p);

const ENTRIES = [
  { in: src('content', 'entry.ts'),          out: out('content.js'),         format: 'iife',   budget: 262144 },
  { in: src('content', 'early-hide.ts'),      out: out('early-hide.js'),      format: 'iife' },
  { in: src('content', 'chart-injector.ts'),  out: out('chart-injector.js'),  format: 'iife' },
  { in: src('background', 'background.ts'),   out: out('background.js'),      format: 'esm' },
  { in: src('popup', 'popup.ts'),             out: out('popup.js'),           format: 'iife' },
];

const shared = {
  bundle: true,
  target: 'chrome120',
  platform: 'browser',
  charset: 'utf8',
  keepNames: true,
  legalComments: 'none',
  logLevel: 'info',
  write: true,
};

const watch = process.argv.includes('--watch');

async function run() {
  let failed = false;
  for (const e of ENTRIES) {
    const result = await build({ ...shared, entryPoints: [e.in], outfile: e.out, format: e.format });
    const bytes = fs.statSync(e.out).size;
    const label = path.basename(e.out);
    console.log(`  ${label}: ${(bytes / 1024).toFixed(1)} KB`);
    if (e.budget && bytes > e.budget) {
      console.error(`  ${label} exceeds ${e.budget} byte budget`);
      failed = true;
    }
    if (result.warnings?.length) result.warnings.forEach(w => console.warn(w));
  }
  if (failed) process.exit(1);
}

if (watch) {
  const ctx = await context({
    ...shared,
    entryPoints: ENTRIES.map(e => e.in),
    outdir: out(),
    format: 'esm',
    sourcemap: 'linked',
  });
  await ctx.watch();
  console.log('watching src/...');
} else {
  await run();
}
