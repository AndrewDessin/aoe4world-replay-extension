// Fixture-based regression test for the AoE4 replay parsers.
//
// Usage:
//   node tests/check-fixtures.mjs              # checks all fixtures
//   node tests/check-fixtures.mjs --update     # regenerates .expected.json
//   node tests/check-fixtures.mjs --download <gameId> [<sig>] [<name>]
//                                                # downloads a fresh fixture
//
// Each fixture is a .gz replay file in chrome-extension/test-fixtures/ with
// a sibling .expected.json snapshot. The script runs BOTH parsers (heuristic
// and structural), diffs against the snapshot, and exits non-zero on any
// mismatch.
//
// We have no automated CI test harness. This script is the manual-ish
// equivalent — run it before every parser change.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'replay');
const REPLAY_API = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getReplayFiles';
const UA = 'AoE4ReplayLauncher-ChromeExt-tests/0.1 (https://github.com/spartain-aoe/aoe4world-replay-extension)';

// Polyfill DecompressionStream for Node — service worker has it natively.
// Node 18+ ships DecompressionStream as a global already; nothing to do.

const parserModuleUrl = pathToFileURL(
  path.join(REPO_ROOT, 'src', 'background', 'replay-parser.ts')
).href;
const parser = await import(parserModuleUrl);

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--download') {
    const gameId = args[1];
    const sig = args[2] || '';
    const name = args[3] || gameId;
    if (!gameId) {
      console.error('Usage: --download <gameId> [<sig>] [<name>]');
      process.exit(2);
    }
    await downloadFixture(gameId, name);
    return;
  }
  const update = args.includes('--update');
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const entries = await fs.readdir(FIXTURES_DIR);
  const fixtures = entries.filter(e => e.endsWith('.gz')).sort();

  if (fixtures.length === 0) {
    console.log('No fixtures found in', FIXTURES_DIR);
    console.log('Add some with: node tests/check-fixtures.mjs --download <gameId>');
    return;
  }

  let pass = 0;
  let fail = 0;
  for (const name of fixtures) {
    const result = await checkFixture(name, update);
    if (result.ok) {
      pass++;
      console.log(`  PASS  ${name.padEnd(40)} ${result.summary}`);
    } else {
      fail++;
      console.error(`  FAIL  ${name.padEnd(40)} ${result.summary}`);
      for (const line of result.detail) console.error(`        ${line}`);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

async function checkFixture(filename, update) {
  const gzPath = path.join(FIXTURES_DIR, filename);
  const expectedPath = gzPath.replace(/\.gz$/, '.expected.json');
  const buf = await fs.readFile(gzPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  let heuristic = null;
  let heuristicErr = null;
  try {
    heuristic = await parser.extractPlayerColors(arrayBuffer);
  } catch (e) {
    heuristicErr = e.message;
  }

  let structural = null;
  let structuralErr = null;
  try {
    structural = await parser.extractPlayerColorsStructural(arrayBuffer);
  } catch (e) {
    structuralErr = e.message;
  }

  const snapshot = {
    chunkVersion: heuristic?.chunkVersion ?? structural?.chunkVersion ?? null,
    headerPlayerCount: heuristic?.headerPlayerCount ?? structural?.headerPlayerCount ?? null,
    heuristic: heuristic?.players ?? null,
    heuristicError: heuristicErr,
    structural: structural?.players ?? null,
    structuralError: structuralErr,
    structuralWarnings: structural?.warnings ?? null,
  };

  if (update) {
    await fs.writeFile(expectedPath, JSON.stringify(snapshot, null, 2));
    return { ok: true, summary: `(updated, players=${snapshot.heuristic?.length ?? '?'})`, detail: [] };
  }

  let expected;
  try {
    expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
  } catch {
    return {
      ok: false,
      summary: 'no .expected.json snapshot — run with --update',
      detail: [],
    };
  }

  const detail = [];
  let ok = true;
  if (snapshot.chunkVersion !== expected.chunkVersion) {
    ok = false; detail.push(`chunkVersion: ${expected.chunkVersion} → ${snapshot.chunkVersion}`);
  }
  if (snapshot.headerPlayerCount !== expected.headerPlayerCount) {
    ok = false; detail.push(`headerPlayerCount: ${expected.headerPlayerCount} → ${snapshot.headerPlayerCount}`);
  }
  if (JSON.stringify(snapshot.heuristic) !== JSON.stringify(expected.heuristic)) {
    ok = false; detail.push(`heuristic players differ`);
    detail.push(`  expected: ${JSON.stringify(expected.heuristic)}`);
    detail.push(`  actual:   ${JSON.stringify(snapshot.heuristic)}`);
  }
  if (JSON.stringify(snapshot.structural) !== JSON.stringify(expected.structural)) {
    ok = false; detail.push(`structural players differ`);
    detail.push(`  expected: ${JSON.stringify(expected.structural)}`);
    detail.push(`  actual:   ${JSON.stringify(snapshot.structural)}`);
  }
  if (snapshot.structuralError !== expected.structuralError) {
    ok = false; detail.push(`structural error: ${expected.structuralError} → ${snapshot.structuralError}`);
  }

  // Cross-parser agreement check (independent of the snapshot)
  if (snapshot.heuristic && snapshot.structural) {
    const playerStr = (p) => `slot=${p.slot} color=${p.color} name=${p.name} id=${p.playerId}`;
    if (snapshot.heuristic.length !== snapshot.structural.length) {
      ok = false; detail.push(`parsers disagree on player count: heuristic=${snapshot.heuristic.length} structural=${snapshot.structural.length}`);
    } else {
      for (let i = 0; i < snapshot.heuristic.length; i++) {
        const h = snapshot.heuristic[i];
        const s = snapshot.structural[i];
        if (h.color !== s.color || h.name !== s.name || h.playerId !== s.playerId || h.civilization !== s.civilization) {
          ok = false;
          detail.push(`slot ${i} disagrees:`);
          detail.push(`  heuristic:  ${playerStr(h)} civ=${h.civilization}`);
          detail.push(`  structural: ${playerStr(s)} civ=${s.civilization}`);
        }
      }
    }
  }

  const summary = ok
    ? `chunkV=${snapshot.chunkVersion} players=${snapshot.heuristic?.length ?? snapshot.structural?.length ?? '?'}`
    : `chunkV=${snapshot.chunkVersion}`;
  return { ok, summary, detail };
}

async function downloadFixture(gameId, fixtureName) {
  console.log(`Downloading replay for game ${gameId}...`);
  const url = `${REPLAY_API}?matchIDs=[${gameId}]&title=age4`;
  const apiResp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!apiResp.ok) throw new Error(`API ${apiResp.status}`);
  const data = await apiResp.json();
  const replayFile = data.replayFiles?.find(f => f.datatype === 0 && f.size > 0 && f.url);
  if (!replayFile) throw new Error('no replay file in API response');
  const blob = await fetch(replayFile.url);
  if (!blob.ok) throw new Error(`blob ${blob.status}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const dest = path.join(FIXTURES_DIR, `${fixtureName}.gz`);
  await fs.writeFile(dest, buf);
  console.log(`Saved ${dest} (${buf.length} bytes)`);
  console.log(`Now run: node tests/check-fixtures.mjs --update`);
}

await main();
