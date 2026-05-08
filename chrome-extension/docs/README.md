# AoE4 Replay Format Templates (Vendored)

These `.bt` files are 010 Editor binary templates documenting the AoE4 replay
file format. They are the **authoritative spec** for our structural parser
in `chrome-extension/replay-parser.js`.

## Source

Vendored from https://github.com/aoe4world/replays-api at commit
`efc391296451da352c3660daf814403e37e787e8` (see `PINNED_SHA.txt`).

Author: Taloth Saldono and the aoe4world team.

## Files

- `replayData.bt` — datatype=0 (the playable replay file). Documents the
  Relic Chunky container, FOLD:INFO/DATA:DATA player setup section, and the
  per-player `DataGameSetupPlayer` record we use for color extraction.
- `replaySummary.bt` — datatype=1 (the stats/telemetry file). Reference for
  future timeline-extraction features. NOT currently consumed by this
  extension.

## Why we vendor instead of fetch on demand

Service-worker constraints: the chrome extension can't depend on a network
fetch at parser-init time. Pinning a SHA also gives us a stable spec to
write parser tests against — when upstream bumps a chunk version we update
the SHA + parser together, validate against fixture replays, and ship a
patch.

## Usage in the parser

The structural parser in `replay-parser.js` (`extractPlayerColorsStructural`)
iterates `headerPlayerCount` slots and reads each `DataGameSetupPlayer`
record positionally. All field offsets are derived from `replayData.bt`,
not from heuristic regex matching against UTF-16 byte patterns.

## Maintenance

When a future patch shifts the player record layout:

1. Compare new replays against the vendored `.bt` to identify the diff.
2. Update the upstream `.bt` if needed (PR to aoe4world/replays-api).
3. Re-vendor with the new SHA and update `replay-parser.js` accordingly.
4. Run `scripts/check-fixtures.mjs` to verify all known fixtures still
   parse correctly.
