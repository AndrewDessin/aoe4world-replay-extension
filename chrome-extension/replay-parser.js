// Extract in-game player colors from an AoE4 replay file.
//
// Usage in service worker:
//   import { extractPlayerColors } from './replay-parser.js';
//   const players = await extractPlayerColors(arrayBufferOfGz);
//
// Returns an array of { slot, name, civilization, playerId, color, colorName }.
// `color` is 0..7 mapped to:
//   0 Blue, 1 Red, 2 Yellow, 3 Green, 4 Teal, 5 Purple, 6 Orange, 7 Pink
//
// Approach: locate the FOLD:INFO -> DATA:DATA chunk in the second Relic Chunky
// (player setup), find every prefixed UTF-16 digit string (player IDs — Steam
// SteamID64, Xbox XUID, PSN ID, or other 14..20-digit account formats), then
// read the color byte at a fixed offset past each player ID. Names and civs
// are walked backwards from each player ID. The struct layout shifts between
// game patches so we deliberately avoid a strict positional walk.
//
// Validated against 17 example replays spanning DATA:DATA versions 56..60.

// Debug flag controls noisy diagnostic logs (per-replay "unknown ID format",
// "permissive matcher chosen IDs" 8-line dumps, "player count short of header"
// for AI-only games). Real defects (`civ walkback failed`, parse_* throws)
// always surface regardless. Caller toggles via `setDebug(true|false)`.
let DEBUG = false;
export function setDebug(value) { DEBUG = !!value; }
const debugWarn = (...args) => { if (DEBUG) console.warn(...args); };

export const COLOR_NAMES = ['Blue', 'Red', 'Yellow', 'Green', 'Teal', 'Purple', 'Orange', 'Pink'];

// Hex codes roughly matching the in-game color palette.
export const COLOR_HEX = ['#3b82f6', '#ef4444', '#fbbf24', '#22c55e', '#06b6d4', '#a855f7', '#fb923c', '#ec4899'];

const MAX_STRING_LENGTH = 256;
const FILE_HEADER_SIZE = 0x4C;
const SECOND_CHUNKY_OFFSET = 0x90;
const CHUNKY_MAGIC = 'Relic Chunky\r\n\x1a\0';
const COLOR_OFFSET_AFTER_STEAMID = 14;

// Base civ slugs as they appear in replay file ASCII strings. Variant civs use
// a "_ha_xxx" suffix (e.g. abbasid_ha_01, sultanate_ha_tug, hre_ha_01) and are
// caught by the regex below — we only need to enumerate BASE civs here.
//
// Only entries verified against actual replay bytes. The console.warn at slot
// time surfaces any unrecognised civ slugs so newly-added base civs (e.g. a
// future post-Templar drop) can be added confidently rather than guessed.
const KNOWN_CIVS = new Set([
  'english', 'french', 'hre', 'rus', 'mongol', 'chinese', 'abbasid', 'delhi', 'malian', 'ottoman',
  'byzantine', 'japanese',
  'templar', // Knights Templar — only verified post-launch base civ as of 2026.
]);

function isPlausibleCiv(value) {
  if (KNOWN_CIVS.has(value)) return true;
  // Variant civs use a "_ha_xxx" suffix (e.g. abbasid_ha_01, sultanate_ha_tug,
  // japanese_ha_sen). This catches subfaction codes regardless of their base.
  if (/^[a-z][a-z0-9_]+_ha_[a-z0-9]+$/.test(value)) return true;
  return false;
}

// Player ID formats observed in replays:
//   SteamID64    : 17 decimal digits, starts with "76561" (Steam users)
//   Xbox XUID    : 16 decimal digits, decimal range 2533274790395904..2814749767106559
//                  i.e. hex 0x0009000000000000..0x0009FFFFFFFFFFFF
//                  (Microsoft Store / Game Pass / Xbox players)
//   PSN ID       : 19 decimal digits (PlayStation Network npid, decimal int64)
//                  Empirically observed in Microsoft cross-play replays; the
//                  shape matches Sony's published account-id format.
//   Other        : Any 14..20 digit string is plausible as an account-id; we
//                  fall back to this only when strict matchers don't account
//                  for the full headerPlayerCount (two-pass scan, see below).
const XUID_MIN = 2533274790395904n;
const XUID_MAX = 2814749767106559n;

function isStrictPlayerId(value) {
  if (value.length === 17 && /^76561\d{12}$/.test(value)) return true;
  if (value.length === 16 && /^\d{16}$/.test(value)) {
    const n = BigInt(value);
    if (n >= XUID_MIN && n <= XUID_MAX) return true;
  }
  return false;
}

function isPermissivePlayerId(value) {
  if (isStrictPlayerId(value)) return true;
  // Any 14..20 digit string is plausibly an account-id from a yet-unseen
  // platform (e.g. PSN's 19-digit npid). uint64 max is 20 digits so anything
  // longer can't be a real account-id. The slot-time structural check
  // (sanity byte 0x01 + color byte 0..7) rejects false positives from
  // numeric player names.
  if (value.length >= 14 && value.length <= 20 && /^\d+$/.test(value)) return true;
  return false;
}

function isPlausibleName(value) {
  if (value.length === 0 || value.length > 64) return false;
  // Reject anything that *looks like a real account-ID* during name walkback —
  // the strict shapes (SteamID64, Xbox XUID, PSN 19-digit). We deliberately do
  // NOT reject the broader 14..20 digit class here, because rejecting it would
  // also clobber legitimate numeric Steam display names (rare but observed).
  // The strict shapes catch ~all real IDs; permissive-only shapes that slip
  // through as a name are confined to the surrounding ID-walkback window
  // anyway and won't masquerade as the player's real display name.
  if (isStrictPlayerId(value)) return false;
  // Pure 19-digit (PSN range) — also reject as a name. These are dense enough
  // in real cross-play replays that they'd otherwise leak into walkbacks.
  if (value.length === 19 && /^\d{19}$/.test(value)) return false;
  return true;
}

async function gunzip(arrayBuffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available');
  }
  const stream = new Response(arrayBuffer).body.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

function readU16LE(buf, p) { return buf[p] | (buf[p + 1] << 8); }
function readU32LE(buf, p) { return (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0; }
function readI32LE(buf, p) { return (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) | 0; }

function asciiSlice(buf, start, length) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(buf[start + i]);
  return s;
}

function utf16leSlice(buf, start, charCount) {
  let s = '';
  for (let i = 0; i < charCount; i++) {
    s += String.fromCharCode(buf[start + i * 2] | (buf[start + i * 2 + 1] << 8));
  }
  return s;
}

function indexOfBytes(buf, needle, start) {
  outer: for (let i = start; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function readChunkHeader(buf, offset) {
  if (offset < 0 || offset + 20 > buf.length) return null;
  const type = asciiSlice(buf, offset, 4);
  const id = asciiSlice(buf, offset + 4, 4);
  if (type !== 'FOLD' && type !== 'DATA') return null;
  const version = readU32LE(buf, offset + 8);
  const length = readU32LE(buf, offset + 12);
  const nameLen = readU32LE(buf, offset + 16);
  if (length < 0 || nameLen < 0 || nameLen > MAX_STRING_LENGTH) return null;
  const dataOffset = offset + 20 + nameLen;
  const endOffset = dataOffset + length;
  if (endOffset > buf.length) return null;
  return { type, id, version, length, dataOffset, endOffset };
}

function findGameSetupPayload(buf) {
  if (buf.length < SECOND_CHUNKY_OFFSET + 24) return null;
  if (asciiSlice(buf, SECOND_CHUNKY_OFFSET, 16) !== CHUNKY_MAGIC) return null;
  const infoOff = indexOfBytes(buf, 'FOLDINFO', FILE_HEADER_SIZE);
  if (infoOff < 0) return null;
  const info = readChunkHeader(buf, infoOff);
  if (!info || info.type !== 'FOLD' || info.id !== 'INFO') return null;
  const child = readChunkHeader(buf, info.dataOffset);
  if (!child || child.type !== 'DATA' || child.id !== 'DATA' || child.endOffset > info.endOffset) return null;
  return { payloadStart: child.dataOffset, payloadEnd: child.endOffset, chunkVersion: child.version };
}

function tryReadUtf16At(buf, offset, end) {
  if (offset + 4 > end) return null;
  const len = readI32LE(buf, offset);
  if (len <= 0 || len > MAX_STRING_LENGTH) return null;
  const strStart = offset + 4;
  const byteLength = len * 2;
  if (strStart + byteLength > end) return null;
  for (let i = 0; i < byteLength; i += 2) {
    const codeUnit = buf[strStart + i] | (buf[strStart + i + 1] << 8);
    // Reject control chars (incl. NUL); names contain printable code units only.
    if (codeUnit < 0x20) return null;
    if (codeUnit === 0x7F) return null;
    // Reject Unicode noncharacters and BOM-shaped values which never appear
    // mid-string in a real player name.
    if (codeUnit >= 0xFDD0 && codeUnit <= 0xFDEF) return null;
    if (codeUnit === 0xFFFE || codeUnit === 0xFFFF) return null;
  }
  return { value: utf16leSlice(buf, strStart, len), end: strStart + byteLength };
}

function tryReadAsciiAt(buf, offset, end) {
  if (offset + 4 > end) return null;
  const len = readI32LE(buf, offset);
  if (len <= 0 || len > MAX_STRING_LENGTH) return null;
  const strStart = offset + 4;
  if (strStart + len > end) return null;
  for (let i = 0; i < len; i++) {
    const c = buf[strStart + i];
    if (c < 0x20 || c > 0x7E) return null;
  }
  return { value: asciiSlice(buf, strStart, len), end: strStart + len };
}

export async function extractPlayerColors(arrayBuffer) {
  const buf = await gunzip(arrayBuffer);

  const setup = findGameSetupPayload(buf);
  if (!setup) throw new Error('FOLD:INFO -> DATA:DATA chunk not found');
  const { payloadStart, payloadEnd, chunkVersion } = setup;
  if (payloadStart + 14 > payloadEnd) throw new Error('DATA:DATA payload too short');

  const headerPlayerCount = readU32LE(buf, payloadStart + 10);
  if (headerPlayerCount === 0 || headerPlayerCount > 16) {
    throw new Error(`Implausible playerCount: ${headerPlayerCount}`);
  }

  // Find every prefixed UTF-16 digit string in the payload — those are player IDs.
  // Two-pass scan:
  //   1. Strict: SteamID64 (17 digits, "76561...") OR Xbox XUID (16 digits in
  //      the documented Xbox Live decimal-XUID range). Covers ~99% of replays.
  //   2. Permissive (only if pass-1 came up short): any 14..20 digit string.
  //      Catches PSN-style 19-digit npid and any future platform ID format.
  //      The slot-time structural sanity check (sanity byte 0x01 + color 0..7)
  //      filters false-positives from numeric player names.
  let playerIds = scanPlayerIds(buf, payloadStart, payloadEnd, isStrictPlayerId);
  let usedPermissive = false;
  if (playerIds.length < headerPlayerCount) {
    const permissive = scanPlayerIds(buf, payloadStart, payloadEnd, isPermissivePlayerId);
    if (permissive.length > playerIds.length) {
      // Surface unknown ID formats with chunkVersion + offset so that future
      // patches can build out the strict matchers from real-world signal.
      for (const candidate of permissive) {
        if (!isStrictPlayerId(candidate.value)) {
          debugWarn(
            `[replay-parser] unknown player ID format`,
            { value: candidate.value, length: candidate.value.length, offset: candidate.offset, chunkVersion }
          );
        }
      }
      playerIds = permissive;
      usedPermissive = true;
    }
  }
  if (playerIds.length === 0) throw new Error('parse_no_player_ids: empty player setup');

  // Throw on OVERSHOOT (true ambiguity = false positives in permissive scan).
  // For UNDERSHOOT (count < headerPlayerCount) we degrade gracefully: the
  // header may include AI/bot slots that have no UTF-16 ID, so a hard throw
  // would break vs-AI replays. We log a warn so a genuine missed-human-ID
  // (the original PSN bug class) still surfaces in user consoles.
  if (playerIds.length > headerPlayerCount) {
    throw new Error(
      `parse_player_count_overshoot: header=${headerPlayerCount} parsed=${playerIds.length} (likely false-positive in permissive scan)`
    );
  }
  if (playerIds.length < headerPlayerCount) {
    // Common for vs-AI replays where bot slots have no UTF-16 ID. Debug-only
    // because it fires on every AI game and isn't actionable for the user.
    debugWarn(
      `[replay-parser] player count short of header — likely AI/bot slots, but verify if a human is missing`,
      { headerCount: headerPlayerCount, parsedCount: playerIds.length, usedPermissive, chunkVersion }
    );
  }
  if (usedPermissive) {
    // Fires on every PSN-mixed game (the common case in 2026). Useful for
    // diagnosing parser drift but spammy for users — debug-only.
    debugWarn(
      `[replay-parser] used permissive ID matcher — chosen IDs:`,
      playerIds.map((p, i) => ({ slot: i, value: p.value, length: p.value.length, offset: p.offset }))
    );
  }

  const players = [];
  for (let slot = 0; slot < playerIds.length; slot++) {
    const pid = playerIds[slot];
    const colorOffset = pid.end + COLOR_OFFSET_AFTER_STEAMID;
    // Structural sanity: throw with diagnostic context instead of silently
    // skipping. A failure here means COLOR_OFFSET_AFTER_STEAMID has shifted
    // (new chunk version) — fail loud so we notice and fix it, rather than
    // silently caching wrong colors.
    if (colorOffset >= payloadEnd) {
      throw new Error(
        `parse_slot_color_oob: slot=${slot} colorOffset=${colorOffset} payloadEnd=${payloadEnd} chunkVersion=${chunkVersion}`
      );
    }
    const color = buf[colorOffset];
    if (color > 7) {
      throw new Error(
        `parse_slot_color_invalid: slot=${slot} color=${color} (expected 0..7) playerId=${pid.value} chunkVersion=${chunkVersion}`
      );
    }
    if (buf[colorOffset - 1] !== 0x01) {
      throw new Error(
        `parse_slot_sanity_byte_invalid: slot=${slot} prevByte=0x${buf[colorOffset - 1].toString(16)} (expected 0x01) playerId=${pid.value} chunkVersion=${chunkVersion}`
      );
    }

    // Walk backwards for civ + profile (ASCII strings) within 200 bytes.
    let civ = null;
    let profile = null;
    const civSearchStart = Math.max(payloadStart, pid.offset - 200);
    for (let p = pid.offset - 4; p >= civSearchStart; p--) {
      const r = tryReadAsciiAt(buf, p, pid.offset);
      if (!r) continue;
      if (r.value === 'default') {
        if (!profile) profile = { offset: p, ...r };
      } else if (isPlausibleCiv(r.value)) {
        civ = { offset: p, ...r };
        break;
      }
    }
    if (!civ) {
      // Civ walkback failed. Name walkback now has to start from the player ID
      // offset which can scavenge garbled bytes from adjacent records. Surface
      // this so missing-civ patches show up in extension logs.
      console.warn(
        `[replay-parser] civ walkback failed`,
        { slot, playerId: pid.value, chunkVersion }
      );
    }

    // Walk backwards from civ (or playerId) for the player name (UTF-16) within 200 bytes.
    let name = null;
    const nameSearchEnd = civ ? civ.offset : pid.offset;
    const nameSearchStart = Math.max(payloadStart, nameSearchEnd - 200);
    for (let p = nameSearchEnd - 4; p >= nameSearchStart; p--) {
      const r = tryReadUtf16At(buf, p, nameSearchEnd);
      if (!r) continue;
      if (!isPlausibleName(r.value)) continue;
      name = r;
      break;
    }

    players.push({
      slot,
      name: name?.value ?? null,
      civilization: civ?.value ?? null,
      playerId: pid.value,
      color,
      colorName: COLOR_NAMES[color],
    });
  }

  // Belt-and-suspenders: per-slot guards above all throw, but if a future code
  // change introduces a silent skip path, this catches it before we cache
  // wrong-coloured records. Note: with the soft undershoot in the count guard
  // above, players.length may legitimately be < headerPlayerCount (AI slots).
  // Only throw if production produced FEWER players than parsed IDs.
  if (players.length !== playerIds.length) {
    throw new Error(
      `parse_player_count_drift: parsedIds=${playerIds.length} produced=${players.length}`
    );
  }
  return { chunkVersion, headerPlayerCount, players };
}

function scanPlayerIds(buf, payloadStart, payloadEnd, predicate) {
  const ids = [];
  for (let p = payloadStart; p <= payloadEnd - 4; p++) {
    const r = tryReadUtf16At(buf, p, payloadEnd);
    if (!r) continue;
    if (!predicate(r.value)) continue;
    if (ids.length > 0 && p < ids[ids.length - 1].end) continue;
    ids.push({ offset: p, end: r.end, value: r.value });
  }
  return ids;
}

// ============================================================================
// STRUCTURAL PARSER (v2)
// ============================================================================
//
// Iterates DataGameSetupPlayer records by structural position rather than
// by content shape. Spec: docs/replayData.bt (vendored from
// aoe4world/replays-api at commit efc3912). The relevant struct layout is
// reproduced inline below; see DataGameSetupPlayer (line 121 of the .bt).
//
// Why this is more stable than the heuristic parser:
//   - Player ID is read from its structural position, not by digit-shape regex.
//     PSN/Switch/Epic/EA/future platforms "just work" regardless of ID format.
//   - Color byte position is part of the documented struct, not a magic offset
//     scanned-from a heuristic ID match.
//   - AI vs human is the FIRST byte of each record (isHuman 0|1), so vs-AI
//     replays parse cleanly without any "header may include AI slots" guard.
//   - Numeric in-game display names cannot collide with the ID slot since each
//     field is read by position, not by content matching.
//
// Why we still keep the heuristic parser:
//   - Shadow-validation period: structural runs alongside heuristic, with
//     disagreements logged via console.warn. After zero-diff bake-in, the
//     heuristic becomes the fallback (and eventually deleted entirely).
//
// Vendored spec: chrome-extension/docs/replayData.bt (PINNED_SHA.txt)

// Skip a length-prefixed string (uint32 length + length*charSize bytes)
// without validating the contents. Used for fields we don't need to inspect
// (e.g. unknown11 = "default", unknown284Atttributes). Returns the new offset
// after the skip, or throws if the length is implausible or runs off the end.
function skipLengthPrefixedString(buf, p, end, charSize, fieldName) {
  if (p + 4 > end) {
    throw new Error(`parse_struct_oob_length: field=${fieldName} offset=${p} end=${end}`);
  }
  const len = readI32LE(buf, p);
  if (len < 0 || len > MAX_STRING_LENGTH) {
    throw new Error(`parse_struct_invalid_length: field=${fieldName} length=${len} offset=${p}`);
  }
  const next = p + 4 + len * charSize;
  if (next > end) {
    throw new Error(`parse_struct_oob_payload: field=${fieldName} length=${len} charSize=${charSize} offset=${p} end=${end}`);
  }
  return next;
}

// Read a UString that we EXPECT to contain printable text (player name, civ).
// Throws on validation failure — used as a slot-drift detector.
function readValidatedUString(buf, p, end, fieldName) {
  if (p + 4 > end) {
    throw new Error(`parse_struct_oob_length: field=${fieldName} offset=${p} end=${end}`);
  }
  const len = readI32LE(buf, p);
  if (len < 0 || len > MAX_STRING_LENGTH) {
    throw new Error(`parse_struct_invalid_length: field=${fieldName} length=${len} offset=${p}`);
  }
  if (len === 0) return { value: '', end: p + 4 };
  const strStart = p + 4;
  const byteLength = len * 2;
  if (strStart + byteLength > end) {
    throw new Error(`parse_struct_oob_payload: field=${fieldName} length=${len} offset=${p} end=${end}`);
  }
  for (let i = 0; i < byteLength; i += 2) {
    const cu = buf[strStart + i] | (buf[strStart + i + 1] << 8);
    if (cu < 0x20 || cu === 0x7F) {
      throw new Error(`parse_struct_invalid_utf16: field=${fieldName} codeUnit=0x${cu.toString(16)} offset=${strStart + i}`);
    }
    if (cu >= 0xFDD0 && cu <= 0xFDEF) {
      throw new Error(`parse_struct_noncharacter_utf16: field=${fieldName} codeUnit=0x${cu.toString(16)} offset=${strStart + i}`);
    }
    if (cu === 0xFFFE || cu === 0xFFFF) {
      throw new Error(`parse_struct_noncharacter_utf16: field=${fieldName} codeUnit=0x${cu.toString(16)} offset=${strStart + i}`);
    }
  }
  return { value: utf16leSlice(buf, strStart, len), end: strStart + byteLength };
}

// Read an ASCII String that we EXPECT to contain printable text (civ slug).
// Throws on validation failure.
function readValidatedString(buf, p, end, fieldName) {
  if (p + 4 > end) {
    throw new Error(`parse_struct_oob_length: field=${fieldName} offset=${p} end=${end}`);
  }
  const len = readI32LE(buf, p);
  if (len < 0 || len > MAX_STRING_LENGTH) {
    throw new Error(`parse_struct_invalid_length: field=${fieldName} length=${len} offset=${p}`);
  }
  if (len === 0) return { value: '', end: p + 4 };
  const strStart = p + 4;
  if (strStart + len > end) {
    throw new Error(`parse_struct_oob_payload: field=${fieldName} length=${len} offset=${p} end=${end}`);
  }
  for (let i = 0; i < len; i++) {
    const c = buf[strStart + i];
    if (c < 0x20 || c > 0x7E) {
      throw new Error(`parse_struct_invalid_ascii: field=${fieldName} byte=0x${c.toString(16)} offset=${strStart + i}`);
    }
  }
  return { value: asciiSlice(buf, strStart, len), end: strStart + len };
}

// Parse a single DataGameSetupPlayer record per docs/replayData.bt.
// See line 121 of the .bt template for the field-by-field layout.
//
// IMPORTANT: only fields up through `color` are parsed deterministically.
// The post-color trailer (.bt: unknown26[15] + extraDataFlags + conditional
// blocks) is NOT a stable schema across replay file versions — empirically,
// chunkVersion 60 (April 2026 patch 8719) emits trailers of variable size
// (144-301 bytes) that don't match the v0.1 template's expected layout.
// To stay robust to future schema drift, callers locate the next slot via
// `findNextSlotAnchor` rather than trying to consume the trailer.
//
// We assert several pre-color invariants observed across all 28 fixture
// slots of chunkVersion 60:
//   unknown7  === 1
//   unknown8  === 0
//   unknown9  === 34
//   unknown15 === slotIndex      (this is the strongest drift detector)
//   unknown17 === 0
// These are validated for HUMANS only — AI slots may differ (no AI fixtures
// yet). When isHuman === 0 we relax the unknown7/10/11 checks since the .bt
// notes "127=human, 1=AI ?" for unknown10Count and AI may have empty unknown11.
function readGameSetupPlayer(buf, offset, payloadEnd, slotIndex, chunkVersion) {
  const recordStart = offset;
  let p = offset;

  // ubyte isHuman (1 = human, 0 = AI)
  if (p + 1 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=isHuman`);
  const isHuman = buf[p++];
  if (isHuman !== 0 && isHuman !== 1) {
    throw new Error(`parse_struct_invalid_isHuman: slot=${slotIndex} value=${isHuman} offset=${recordStart} chunkVersion=${chunkVersion}`);
  }

  // UString playerName — validated (must be printable; strong slot-drift detector).
  // Both human and AI slots may have empty names — the validator allows length 0.
  const name = readValidatedUString(buf, p, payloadEnd, 'playerName');
  p = name.end;

  // uint32 team, uint32 playerId (small int, e.g. 1,7,0,3,5), ubyte unknown7
  if (p + 9 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=team/playerId/unknown7`);
  const team = readU32LE(buf, p); p += 4;
  const playerId = readU32LE(buf, p); p += 4;
  const unknown7 = buf[p++];
  // For humans, unknown7 is empirically always 1. For AI we have no fixture
  // data — accept any value but record it in case it later becomes a signal.
  if (isHuman === 1 && unknown7 !== 1) {
    throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown7 expected=1 actual=${unknown7} chunkVersion=${chunkVersion}`);
  }

  // String civ — validated (printable ASCII civ slug, e.g. "hre", "japanese_ha_sen").
  // Length 0 is permitted (AI may have empty civ).
  const civ = readValidatedString(buf, p, payloadEnd, 'civ');
  p = civ.end;

  // ushort unknown8 (==0), ushort unknown9 (==34), uint32 unknown10Count
  if (p + 8 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown8/9/10`);
  const unknown8 = readU16LE(buf, p);
  const unknown9 = readU16LE(buf, p + 2);
  const unknown10Count = readU32LE(buf, p + 4);
  if (unknown8 !== 0) {
    throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown8 expected=0 actual=${unknown8} chunkVersion=${chunkVersion}`);
  }
  if (unknown9 !== 34) {
    throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown9 expected=34 actual=${unknown9} chunkVersion=${chunkVersion}`);
  }
  // For humans unknown10Count is always 127 in our fixture set; AI is documented
  // as 1 in the .bt template. Accept 1 or 127, reject anything else as drift.
  if (unknown10Count !== 1 && unknown10Count !== 127) {
    throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown10Count expected=1|127 actual=${unknown10Count} chunkVersion=${chunkVersion}`);
  }
  p += 8;

  // String unknown11 (typically "default" for humans, may be empty for AI)
  p = skipLengthPrefixedString(buf, p, payloadEnd, 1, 'unknown11');

  // float unknown12, uint32 unknown13, uint32 unknown14[5] = 28 bytes before unknown15
  if (p + 28 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown12-14`);
  p += 28;

  // uint32 unknown15 — empirically equals slotIndex for every slot of every
  // fixture (28/28 with chunkVersion 60). This is the strongest pre-color
  // drift detector: if our cursor has slipped, this number won't match.
  if (p + 4 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown15`);
  const unknown15 = readU32LE(buf, p); p += 4;
  if (unknown15 !== slotIndex) {
    throw new Error(`parse_struct_slot_index_mismatch: slot=${slotIndex} unknown15=${unknown15} offset=${recordStart} chunkVersion=${chunkVersion}`);
  }

  // uint32 hostComputerId, uint32 unknown17 (== 0), uint32 unknown18, ubyte unknown19[5]
  // = 4 + 4 + 4 + 5 = 17 bytes
  if (p + 17 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown16-19`);
  p += 4; // hostComputerId
  const unknown17 = readU32LE(buf, p); p += 4;
  if (unknown17 !== 0) {
    throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown17 expected=0 actual=${unknown17} chunkVersion=${chunkVersion}`);
  }
  p += 4; // unknown18 (varies; tracks profile id-ish but not strictly)
  p += 5; // unknown19[5]

  // UString steamId — the platform account ID (Steam/Xbox/PSN/Switch/etc.).
  // Read by position, not by shape — this is the whole point of the structural
  // parser. AI slots may have empty steamId (validator allows length 0).
  const steamIdRes = readValidatedUString(buf, p, payloadEnd, 'steamId');
  const platformId = steamIdRes.value;
  p = steamIdRes.end;

  // uint32 unknown20, uint32 unknown21, ushort unknown22, ushort unknown23,
  // ubyte unknown24, ubyte unknown25 = 14 bytes (matches the heuristic +14 magic)
  if (p + 15 > payloadEnd) throw new Error(`parse_struct_oob: slot=${slotIndex} field=color`);
  p += 14;

  // ubyte color (0..7)
  const colorPos = p;
  const color = buf[p++];
  if (color > 7) {
    throw new Error(`parse_struct_invalid_color: slot=${slotIndex} color=${color} platformId=${platformId} chunkVersion=${chunkVersion}`);
  }

  return {
    slot: slotIndex,
    isHuman,
    name: name.value,
    civilization: civ.value,
    playerId: platformId, // platform account id (steamId/xuid/psn/etc.)
    color,
    colorName: COLOR_NAMES[color],
    team,
    internalPlayerId: playerId, // small int 0..7 (DataGameSetupPlayer.playerId)
    recordStart,
    colorPos,
    postColor: p, // first byte AFTER color — caller must scan forward to next slot
  };
}

// Scan forward from `from` looking for the next DataGameSetupPlayer anchor.
// Anchor pattern: [ubyte isHuman 0|1][uint32 nameLen 0-64][validUTF16 name]
//                 [uint32 team 0-15][uint32 playerId 0-15][ubyte unknown7]
//                 [uint32 civLen 0-24][validASCII civ slug]
//                 [ushort unknown8 ==0][ushort unknown9 ==34]
//                 [uint32 unknown10Count ∈ {1, 127}].
// Returns the absolute byte offset of the anchor, or -1 if not found before
// `payloadEnd`. The civ slug is restricted to lowercase letters, digits, and
// underscore — current AOE4 civs match this pattern (e.g. "hre", "rus",
// "japanese_ha_sen", "chinese_ha_01").
//
// This compensates for the post-color trailer being non-stable across replay
// file versions. As long as the per-slot prefix layout (name + team + civ +
// unknown8/9/10) stays stable, this scan finds the next slot reliably even
// if Relic adds new fields to the trailer. The unknown8/9/10 invariants give
// 32 bits of effective discrimination beyond the structural prefix and rule
// out essentially all false positives in trailer ASCII strings.
// CIV_MIN_LEN=3: every shipping AOE4 civ slug is >= 3 chars (rus, hre, abb…).
// Allowing length 0 weakens anchor entropy materially because the inner
// civ-slug ASCII validation loop is skipped — see committee round-2 finding
// xhigh N3. If a future fixture proves AI civs can be empty, raise NAME or
// tighten unknown7/unknown10Count discrimination to compensate before relaxing.
const CIV_MIN_LEN = 3;
const CIV_MAX_LEN = 24; // longest observed: "sultanate_ha_tug" (16); 24 = headroom
// NAME_MIN_LEN=1: every slot must have at least one name char. All 28 fixture
// slots have name length >= 3. The .bt template doesn't constrain AI names but
// in practice AI slots are labeled (e.g. "Easy AI", "Hardest AI"). Allowing
// nameLen=0 created a real attack vector: a NUL-name corruption inside slot N
// can cause the scan to land on a "ghost AI anchor" composed of NUL+random
// bytes — see scripts/check-adversarial.mjs T1. If we ever hit a fixture
// where AI nameLen===0, we'll need to revisit this with that fixture's real
// invariants instead of guessing.
const NAME_MIN_LEN = 1;
const NAME_MAX_LEN = 64; // matches isPlausibleName in the heuristic
const TEAM_MAX = 15;
const PLAYER_ID_MAX = 15;

function findNextSlotAnchor(buf, from, payloadEnd) {
  const limit = payloadEnd - 30; // need at least header bytes
  for (let scan = from; scan < limit; scan++) {
    const isHuman = buf[scan];
    if (isHuman !== 0 && isHuman !== 1) continue;
    if (scan + 5 > payloadEnd) break;
    const nameLen = readI32LE(buf, scan + 1);
    if (nameLen < NAME_MIN_LEN || nameLen > NAME_MAX_LEN) continue;
    const nameEnd = scan + 5 + nameLen * 2;
    if (nameEnd + 9 > payloadEnd) continue;
    // Validate UTF-16 name chars: printable Unicode, exclude C0/C1 controls
    // INCLUDING NUL (matches readValidatedUString — committee finding C1).
    let bad = false;
    for (let i = 0; i < nameLen; i++) {
      const lo = buf[scan + 5 + i * 2];
      const hi = buf[scan + 5 + i * 2 + 1];
      const cp = lo | (hi << 8);
      if (cp < 0x20) { bad = true; break; }
      if (cp === 0x7F) { bad = true; break; }
      if (cp >= 0xFDD0 && cp <= 0xFDEF) { bad = true; break; }
      if (cp === 0xFFFE || cp === 0xFFFF) { bad = true; break; }
    }
    if (bad) continue;
    // team (4) + playerId (4) + unknown7 (1)
    const team = readU32LE(buf, nameEnd);
    const playerId = readU32LE(buf, nameEnd + 4);
    if (team > TEAM_MAX || playerId > PLAYER_ID_MAX) continue;
    const unknown7 = buf[nameEnd + 8];
    // Humans always have unknown7=1; AI is unknown but unlikely to share the
    // exact bit pattern. Accept any value here and let readGameSetupPlayer's
    // stricter human-only check catch drift.
    if (unknown7 > 1) continue;
    // civLen (4) + civ bytes
    const civLenOff = nameEnd + 9;
    if (civLenOff + 4 > payloadEnd) continue;
    const civLen = readI32LE(buf, civLenOff);
    if (civLen < CIV_MIN_LEN || civLen > CIV_MAX_LEN) continue;
    const civEnd = civLenOff + 4 + civLen;
    if (civEnd + 8 > payloadEnd) continue;
    let civBad = false;
    for (let i = 0; i < civLen; i++) {
      const c = buf[civLenOff + 4 + i];
      // Lowercase letter, digit, or underscore. AOE4 civ slugs match this.
      if (!((c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c === 0x5F)) {
        civBad = true;
        break;
      }
    }
    if (civBad) continue;
    // ushort unknown8 (== 0) + ushort unknown9 (== 34) — hard invariants
    // observed across all 28 fixture slots. Together with civ this makes the
    // anchor essentially unfakable inside a trailer's ASCII payload.
    const unknown8 = readU16LE(buf, civEnd);
    const unknown9 = readU16LE(buf, civEnd + 2);
    if (unknown8 !== 0 || unknown9 !== 34) continue;
    // uint32 unknown10Count ∈ {1, 127}
    const unknown10Count = readU32LE(buf, civEnd + 4);
    if (unknown10Count !== 1 && unknown10Count !== 127) continue;
    return scan;
  }
  return -1;
}

// Empirically-derived bounds on inter-slot trailer size for chunkVersion 60:
//   min observed: 144 bytes, max observed: 301 bytes
// Bounds below give ~30% headroom on each side. If a future patch shifts
// trailer sizes outside this range, we throw loudly rather than silently
// jump to a wrong anchor — diagnostic.trailerSizes shows the actual values
// for forensics.
const ANCHOR_MIN_GAP = 100;
const ANCHOR_MAX_GAP = 400;

// Empirically-derived bounds on tail gap (last slot's postColor to payloadEnd).
// The DataGameSetup struct has trailing fields (unknown4/5/6 + sub-structs)
// after the players[] array, so this gap is much larger than an inter-slot
// trailer. Observed range across fixtures: 708-743 bytes. Bounds give ~70%
// headroom on the high side to absorb future field additions.
const TAIL_MIN_GAP = 400;
const TAIL_MAX_GAP = 1500;

export async function extractPlayerColorsStructural(arrayBuffer) {
  const buf = await gunzip(arrayBuffer);

  const setup = findGameSetupPayload(buf);
  if (!setup) throw new Error('parse_struct_no_setup_payload');
  const { payloadStart, payloadEnd, chunkVersion } = setup;
  if (payloadStart + 14 > payloadEnd) throw new Error('parse_struct_payload_too_short');

  // DataGameSetup header: uint32 unknown1, uint32 unknown2, ushort unknown3, uint32 playerCount.
  // (Bytes 0-9 are header, playerCount is at offset 10, players start at offset 14.)
  const headerPlayerCount = readU32LE(buf, payloadStart + 10);
  if (headerPlayerCount === 0 || headerPlayerCount > 16) {
    throw new Error(`parse_struct_implausible_player_count: ${headerPlayerCount}`);
  }

  const players = [];
  const trailerSizes = []; // diagnostic: gap between this slot's postColor and the next slot's anchor
  let p = payloadStart + 14;
  for (let slot = 0; slot < headerPlayerCount; slot++) {
    const record = readGameSetupPlayer(buf, p, payloadEnd, slot, chunkVersion);
    players.push(record);
    if (slot < headerPlayerCount - 1) {
      // Anchor-scan to the next slot. The post-color trailer has variable size
      // across replay file versions, so we don't try to parse it field-by-field.
      const nextSlot = findNextSlotAnchor(buf, record.postColor, payloadEnd);
      if (nextSlot < 0) {
        throw new Error(`parse_struct_no_anchor_found: after slot=${slot} from=${record.postColor} payloadEnd=${payloadEnd} chunkVersion=${chunkVersion}`);
      }
      const gap = nextSlot - record.postColor;
      // Distance backstop (committee critique H1): a false anchor inside the
      // current slot's trailer (gap < ANCHOR_MIN_GAP) or one that skipped past
      // a real slot (gap > ANCHOR_MAX_GAP) would cause silent mis-attribution.
      // Failing loudly here lets the shadow log catch chunkVersion drift.
      if (gap < ANCHOR_MIN_GAP || gap > ANCHOR_MAX_GAP) {
        throw new Error(`parse_struct_anchor_distance_oob: slot=${slot} gap=${gap} expected=[${ANCHOR_MIN_GAP},${ANCHOR_MAX_GAP}] postColor=${record.postColor} nextSlot=${nextSlot} chunkVersion=${chunkVersion}`);
      }
      trailerSizes.push(gap);
      p = nextSlot;
    } else {
      p = record.postColor;
    }
  }

  // Tail-gap backstop (committee critique M1): catches the "anchor scan jumped
  // too far" failure mode that the per-slot gap check doesn't fully prevent
  // (cumulative drift could still produce N records but offset by a few slots).
  // Empirically tail gap is 708-743 bytes; allow a wide range for future fields.
  const lastPostColor = players[players.length - 1].postColor;
  const tailGap = payloadEnd - lastPostColor;
  if (tailGap < TAIL_MIN_GAP || tailGap > TAIL_MAX_GAP) {
    throw new Error(`parse_struct_tail_gap_oob: lastPostColor=${lastPostColor} payloadEnd=${payloadEnd} gap=${tailGap} expected=[${TAIL_MIN_GAP},${TAIL_MAX_GAP}] chunkVersion=${chunkVersion}`);
  }

  // Surface in-game color-duplication bug as a non-fatal warning attached to
  // the result, instead of throwing. Real game has a rare bug where two
  // players share a color; we want to display this faithfully, not throw it
  // away. (xhigh critique #5 mitigation.)
  const seenColors = new Set();
  const duplicateColors = [];
  for (const pl of players) {
    if (seenColors.has(pl.color)) duplicateColors.push(pl.color);
    seenColors.add(pl.color);
  }
  const warnings = [];
  if (duplicateColors.length > 0) {
    warnings.push({ kind: 'duplicate_color_bug', colors: [...new Set(duplicateColors)] });
  }

  return {
    chunkVersion,
    headerPlayerCount,
    players: players.map(p => ({
      slot: p.slot,
      name: p.name,
      civilization: p.civilization,
      playerId: p.playerId,
      color: p.color,
      colorName: p.colorName,
    })),
    warnings,
    diagnostic: {
      isHumanFlags: players.map(p => p.isHuman),
      teams: players.map(p => p.team),
      bytesConsumed: p - payloadStart,
      payloadSize: payloadEnd - payloadStart,
      // Per-slot trailer sizes — surface forensic data for chunkVersion drift.
      // Replaces extraDataFlags (which was a lie on chunkVersion 60).
      trailerSizes,
      tailGap,
    },
  };
}
