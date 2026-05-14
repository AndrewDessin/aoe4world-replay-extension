let DEBUG = false;
export interface PlayerColorInfo {
    slot: number;
    name: string | null;
    civilization: string | null;
    playerId: string;
    color: number;
    colorName: string;
}
export interface ExtractPlayerColorsResult {
    chunkVersion: number;
    headerPlayerCount: number;
    players: PlayerColorInfo[];
}
export interface StructuralWarning {
    kind: 'duplicate_color_bug';
    colors: number[];
}
export interface StructuralDiagnostic {
    isHumanFlags: number[];
    teams: number[];
    bytesConsumed: number;
    payloadSize: number;
    trailerSizes: number[];
    tailGap: number;
}
export interface ExtractPlayerColorsStructuralResult extends ExtractPlayerColorsResult {
    warnings: StructuralWarning[];
    diagnostic: StructuralDiagnostic;
}
interface TextReadResult {
    value: string;
    end: number;
}
interface OffsetTextReadResult extends TextReadResult {
    offset: number;
}
interface ScannedPlayerId {
    offset: number;
    end: number;
    value: string;
}
interface ChunkHeader {
    type: 'FOLD' | 'DATA';
    id: string;
    version: number;
    length: number;
    dataOffset: number;
    endOffset: number;
}
interface GameSetupPayload {
    payloadStart: number;
    payloadEnd: number;
    chunkVersion: number;
}
interface GameSetupPlayerRecord {
    slot: number;
    isHuman: 0 | 1;
    name: string;
    civilization: string;
    playerId: string;
    color: number;
    colorName: string;
    team: number;
    internalPlayerId: number;
    recordStart: number;
    colorPos: number;
    postColor: number;
}
export function setDebug(value: boolean): void { DEBUG = !!value; }
const debugWarn = (...args: unknown[]): void => { if (DEBUG)
    console.warn(...args); };
export const COLOR_NAMES = ['Blue', 'Red', 'Yellow', 'Green', 'Teal', 'Purple', 'Orange', 'Pink', 'Magenta', 'Dark Green'] as const;
export const COLOR_HEX = ['#0162FF', '#F60000', '#FFEE00', '#4DE94C', '#41D8FF', '#8E00FF', '#FF8C00', '#FF3395', '#C000C0', '#166534'] as const;
const MAX_STRING_LENGTH = 256;
const FILE_HEADER_SIZE = 0x4C;
const SECOND_CHUNKY_OFFSET = 0x90;
const CHUNKY_MAGIC = 'Relic Chunky\r\n\x1a\0';
const COLOR_OFFSET_AFTER_STEAMID = 14;
const KNOWN_CIVS = new Set([
    'english', 'french', 'hre', 'holy_roman_empire', 'rus', 'mongol', 'mongols', 'chinese',
    'abbasid', 'abbasid_dynasty', 'delhi', 'delhi_sultanate', 'malian', 'malians', 'ottoman', 'ottomans',
    'byzantine', 'byzantines', 'japanese', 'jeanne_darc', 'order_of_the_dragon',
    'ayyubids', 'golden_horde', 'house_of_lancaster', 'jin_dynasty', 'knights_templar',
    'macedonian_dynasty', 'sengoku_daimyo', 'templar', 'tughlaq_dynasty', 'zhu_xis_legacy',
]);
function isPlausibleCiv(value: string): boolean {
    if (KNOWN_CIVS.has(value))
        return true;
    if (/^[a-z][a-z0-9_]+_ha_[a-z0-9]+$/.test(value))
        return true;
    const base = value.replace(/_(?:dynasty|empire|sultanate|horde|legacy|daimyo)$/, '');
    if (base !== value && KNOWN_CIVS.has(base))
        return true;
    return false;
}
const XUID_MIN = 2533274790395904n;
const XUID_MAX = 2814749767106559n;
function isStrictPlayerId(value: string): boolean {
    if (value.length === 17 && /^76561\d{12}$/.test(value))
        return true;
    if (value.length === 16 && /^\d{16}$/.test(value)) {
        const n = BigInt(value);
        if (n >= XUID_MIN && n <= XUID_MAX)
            return true;
    }
    return false;
}
function isPermissivePlayerId(value: string): boolean {
    if (isStrictPlayerId(value))
        return true;
    if (value.length >= 14 && value.length <= 20 && /^\d+$/.test(value))
        return true;
    return false;
}
function isPlausibleName(value: string): boolean {
    if (value.length === 0 || value.length > 64)
        return false;
    if (isStrictPlayerId(value))
        return false;
    if (value.length === 19 && /^\d{19}$/.test(value))
        return false;
    return true;
}
async function gunzip(arrayBuffer: ArrayBuffer): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream not available');
    }
    const stream = new Response(arrayBuffer).body!.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        const chunk = value as Uint8Array;
        chunks.push(chunk);
        total += chunk.byteLength;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
        out.set(chunk, pos);
        pos += chunk.byteLength;
    }
    return out;
}
function readU16LE(buf: Uint8Array, p: number): number { return buf[p] | (buf[p + 1] << 8); }
function readU32LE(buf: Uint8Array, p: number): number { return (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0; }
function readI32LE(buf: Uint8Array, p: number): number { return (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) | 0; }
function asciiSlice(buf: Uint8Array, start: number, length: number): string {
    let s = '';
    for (let i = 0; i < length; i++)
        s += String.fromCharCode(buf[start + i]);
    return s;
}
function utf16leSlice(buf: Uint8Array, start: number, charCount: number): string {
    let s = '';
    for (let i = 0; i < charCount; i++) {
        s += String.fromCharCode(buf[start + i * 2] | (buf[start + i * 2 + 1] << 8));
    }
    return s;
}
function indexOfBytes(buf: Uint8Array, needle: string, start: number): number {
    outer: for (let i = start; i <= buf.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (buf[i + j] !== needle.charCodeAt(j))
                continue outer;
        }
        return i;
    }
    return -1;
}
function readChunkHeader(buf: Uint8Array, offset: number): ChunkHeader | null {
    if (offset < 0 || offset + 20 > buf.length)
        return null;
    const type = asciiSlice(buf, offset, 4);
    const id = asciiSlice(buf, offset + 4, 4);
    if (type !== 'FOLD' && type !== 'DATA')
        return null;
    const version = readU32LE(buf, offset + 8);
    const length = readU32LE(buf, offset + 12);
    const nameLen = readU32LE(buf, offset + 16);
    if (length < 0 || nameLen < 0 || nameLen > MAX_STRING_LENGTH)
        return null;
    const dataOffset = offset + 20 + nameLen;
    const endOffset = dataOffset + length;
    if (endOffset > buf.length)
        return null;
    return { type, id, version, length, dataOffset, endOffset };
}
function findGameSetupPayload(buf: Uint8Array): GameSetupPayload | null {
    if (buf.length < SECOND_CHUNKY_OFFSET + 24)
        return null;
    if (asciiSlice(buf, SECOND_CHUNKY_OFFSET, 16) !== CHUNKY_MAGIC)
        return null;
    const infoOff = indexOfBytes(buf, 'FOLDINFO', FILE_HEADER_SIZE);
    if (infoOff < 0)
        return null;
    const info = readChunkHeader(buf, infoOff);
    if (!info || info.type !== 'FOLD' || info.id !== 'INFO')
        return null;
    const child = readChunkHeader(buf, info.dataOffset);
    if (!child || child.type !== 'DATA' || child.id !== 'DATA' || child.endOffset > info.endOffset)
        return null;
    return { payloadStart: child.dataOffset, payloadEnd: child.endOffset, chunkVersion: child.version };
}
function tryReadUtf16At(buf: Uint8Array, offset: number, end: number): TextReadResult | null {
    if (offset + 4 > end)
        return null;
    const len = readI32LE(buf, offset);
    if (len <= 0 || len > MAX_STRING_LENGTH)
        return null;
    const strStart = offset + 4;
    const byteLength = len * 2;
    if (strStart + byteLength > end)
        return null;
    for (let i = 0; i < byteLength; i += 2) {
        const codeUnit = buf[strStart + i] | (buf[strStart + i + 1] << 8);
        if (codeUnit < 0x20)
            return null;
        if (codeUnit === 0x7F)
            return null;
        if (codeUnit >= 0xFDD0 && codeUnit <= 0xFDEF)
            return null;
        if (codeUnit === 0xFFFE || codeUnit === 0xFFFF)
            return null;
    }
    return { value: utf16leSlice(buf, strStart, len), end: strStart + byteLength };
}
function tryReadAsciiAt(buf: Uint8Array, offset: number, end: number): TextReadResult | null {
    if (offset + 4 > end)
        return null;
    const len = readI32LE(buf, offset);
    if (len <= 0 || len > MAX_STRING_LENGTH)
        return null;
    const strStart = offset + 4;
    if (strStart + len > end)
        return null;
    for (let i = 0; i < len; i++) {
        const c = buf[strStart + i];
        if (c < 0x20 || c > 0x7E)
            return null;
    }
    return { value: asciiSlice(buf, strStart, len), end: strStart + len };
}
export async function extractPlayerColors(arrayBuffer: ArrayBuffer): Promise<ExtractPlayerColorsResult> {
    const buf = await gunzip(arrayBuffer);
    const setup = findGameSetupPayload(buf);
    if (!setup)
        throw new Error('FOLD:INFO -> DATA:DATA chunk not found');
    const { payloadStart, payloadEnd, chunkVersion } = setup;
    if (payloadStart + 14 > payloadEnd)
        throw new Error('DATA:DATA payload too short');
    const headerPlayerCount = readU32LE(buf, payloadStart + 10);
    if (headerPlayerCount === 0 || headerPlayerCount > 16) {
        throw new Error(`Implausible playerCount: ${headerPlayerCount}`);
    }
    let playerIds = scanPlayerIds(buf, payloadStart, payloadEnd, isStrictPlayerId);
    let usedPermissive = false;
    if (playerIds.length < headerPlayerCount) {
        const permissive = scanPlayerIds(buf, payloadStart, payloadEnd, isPermissivePlayerId);
        if (permissive.length > playerIds.length) {
            for (const candidate of permissive) {
                if (!isStrictPlayerId(candidate.value)) {
                    debugWarn(`[replay-parser] unknown player ID format`, { value: candidate.value, length: candidate.value.length, offset: candidate.offset, chunkVersion });
                }
            }
            playerIds = permissive;
            usedPermissive = true;
        }
    }
    if (playerIds.length === 0)
        throw new Error('parse_no_player_ids: empty player setup');
    if (playerIds.length > headerPlayerCount) {
        throw new Error(`parse_player_count_overshoot: header=${headerPlayerCount} parsed=${playerIds.length} (likely false-positive in permissive scan)`);
    }
    if (playerIds.length < headerPlayerCount) {
        debugWarn(`[replay-parser] player count short of header — likely AI/bot slots, but verify if a human is missing`, { headerCount: headerPlayerCount, parsedCount: playerIds.length, usedPermissive, chunkVersion });
    }
    if (usedPermissive) {
        debugWarn(`[replay-parser] used permissive ID matcher — chosen IDs:`, playerIds.map((p, i) => ({ slot: i, value: p.value, length: p.value.length, offset: p.offset })));
    }
    const players: PlayerColorInfo[] = [];
    for (let slot = 0; slot < playerIds.length; slot++) {
        const pid = playerIds[slot];
        const colorOffset = pid.end + COLOR_OFFSET_AFTER_STEAMID;
        if (colorOffset >= payloadEnd) {
            throw new Error(`parse_slot_color_oob: slot=${slot} colorOffset=${colorOffset} payloadEnd=${payloadEnd} chunkVersion=${chunkVersion}`);
        }
        const color = buf[colorOffset];
        if (color > 15) {
            throw new Error(`parse_slot_color_invalid: slot=${slot} color=${color} playerId=${pid.value} chunkVersion=${chunkVersion}`);
        }
        if (buf[colorOffset - 1] !== 0x01) {
            throw new Error(`parse_slot_sanity_byte_invalid: slot=${slot} prevByte=0x${buf[colorOffset - 1].toString(16)} (expected 0x01) playerId=${pid.value} chunkVersion=${chunkVersion}`);
        }
        let civ: OffsetTextReadResult | null = null;
        let profile: OffsetTextReadResult | null = null;
        const civSearchStart = Math.max(payloadStart, pid.offset - 200);
        for (let p = pid.offset - 4; p >= civSearchStart; p--) {
            const r = tryReadAsciiAt(buf, p, pid.offset);
            if (!r)
                continue;
            if (r.value === 'default') {
                if (!profile)
                    profile = { offset: p, ...r };
            }
            else if (isPlausibleCiv(r.value)) {
                civ = { offset: p, ...r };
                break;
            }
        }
        if (!civ) {
            console.warn(`[replay-parser] civ walkback failed`, { slot, playerId: pid.value, chunkVersion });
        }
        let name: TextReadResult | null = null;
        const nameSearchEnd = civ ? civ.offset : pid.offset;
        const nameSearchStart = Math.max(payloadStart, nameSearchEnd - 200);
        for (let p = nameSearchEnd - 4; p >= nameSearchStart; p--) {
            const r = tryReadUtf16At(buf, p, nameSearchEnd);
            if (!r)
                continue;
            if (!isPlausibleName(r.value))
                continue;
            name = r;
            break;
        }
        players.push({
            slot,
            name: name?.value ?? null,
            civilization: civ?.value ?? null,
            playerId: pid.value,
            color,
            colorName: COLOR_NAMES[color] ?? `Color ${color}`,
        });
    }
    if (players.length !== playerIds.length) {
        throw new Error(`parse_player_count_drift: parsedIds=${playerIds.length} produced=${players.length}`);
    }
    return { chunkVersion, headerPlayerCount, players };
}
function scanPlayerIds(buf: Uint8Array, payloadStart: number, payloadEnd: number, predicate: (value: string) => boolean): ScannedPlayerId[] {
    const ids: ScannedPlayerId[] = [];
    for (let p = payloadStart; p <= payloadEnd - 4; p++) {
        const r = tryReadUtf16At(buf, p, payloadEnd);
        if (!r)
            continue;
        if (!predicate(r.value))
            continue;
        if (ids.length > 0 && p < ids[ids.length - 1].end)
            continue;
        ids.push({ offset: p, end: r.end, value: r.value });
    }
    return ids;
}
function skipLengthPrefixedString(buf: Uint8Array, p: number, end: number, charSize: number, fieldName: string): number {
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
function readValidatedUString(buf: Uint8Array, p: number, end: number, fieldName: string): TextReadResult {
    if (p + 4 > end) {
        throw new Error(`parse_struct_oob_length: field=${fieldName} offset=${p} end=${end}`);
    }
    const len = readI32LE(buf, p);
    if (len < 0 || len > MAX_STRING_LENGTH) {
        throw new Error(`parse_struct_invalid_length: field=${fieldName} length=${len} offset=${p}`);
    }
    if (len === 0)
        return { value: '', end: p + 4 };
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
function readValidatedString(buf: Uint8Array, p: number, end: number, fieldName: string): TextReadResult {
    if (p + 4 > end) {
        throw new Error(`parse_struct_oob_length: field=${fieldName} offset=${p} end=${end}`);
    }
    const len = readI32LE(buf, p);
    if (len < 0 || len > MAX_STRING_LENGTH) {
        throw new Error(`parse_struct_invalid_length: field=${fieldName} length=${len} offset=${p}`);
    }
    if (len === 0)
        return { value: '', end: p + 4 };
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
function readGameSetupPlayer(buf: Uint8Array, offset: number, payloadEnd: number, slotIndex: number, chunkVersion: number): GameSetupPlayerRecord {
    const recordStart = offset;
    let p = offset;
    if (p + 1 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=isHuman`);
    const isHuman = buf[p++] as 0 | 1;
    if (isHuman !== 0 && isHuman !== 1) {
        throw new Error(`parse_struct_invalid_isHuman: slot=${slotIndex} value=${isHuman} offset=${recordStart} chunkVersion=${chunkVersion}`);
    }
    const name = readValidatedUString(buf, p, payloadEnd, 'playerName');
    p = name.end;
    if (p + 9 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=team/playerId/unknown7`);
    const team = readU32LE(buf, p);
    p += 4;
    const playerId = readU32LE(buf, p);
    p += 4;
    const unknown7 = buf[p++];
    if (isHuman === 1 && unknown7 !== 1) {
        throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown7 expected=1 actual=${unknown7} chunkVersion=${chunkVersion}`);
    }
    const civ = readValidatedString(buf, p, payloadEnd, 'civ');
    p = civ.end;
    if (p + 8 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown8/9/10`);
    const unknown8 = readU16LE(buf, p);
    const unknown9 = readU16LE(buf, p + 2);
    const unknown10Count = readU32LE(buf, p + 4);
    if (unknown8 !== 0) {
        throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown8 expected=0 actual=${unknown8} chunkVersion=${chunkVersion}`);
    }
    if (unknown9 !== 34) {
        throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown9 expected=34 actual=${unknown9} chunkVersion=${chunkVersion}`);
    }
    if (unknown10Count !== 1 && unknown10Count !== 127) {
        throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown10Count expected=1|127 actual=${unknown10Count} chunkVersion=${chunkVersion}`);
    }
    p += 8;
    p = skipLengthPrefixedString(buf, p, payloadEnd, 1, 'unknown11');
    if (p + 28 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown12-14`);
    p += 28;
    if (p + 4 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown15`);
    const unknown15 = readU32LE(buf, p);
    p += 4;
    if (unknown15 !== slotIndex) {
        throw new Error(`parse_struct_slot_index_mismatch: slot=${slotIndex} unknown15=${unknown15} offset=${recordStart} chunkVersion=${chunkVersion}`);
    }
    if (p + 17 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=unknown16-19`);
    p += 4;
    const unknown17 = readU32LE(buf, p);
    p += 4;
    if (unknown17 !== 0) {
        throw new Error(`parse_struct_invariant_violation: slot=${slotIndex} field=unknown17 expected=0 actual=${unknown17} chunkVersion=${chunkVersion}`);
    }
    p += 4;
    p += 5;
    const steamIdRes = readValidatedUString(buf, p, payloadEnd, 'steamId');
    const platformId = steamIdRes.value;
    p = steamIdRes.end;
    if (p + 15 > payloadEnd)
        throw new Error(`parse_struct_oob: slot=${slotIndex} field=color`);
    p += 14;
    const colorPos = p;
    const color = buf[p++];
    if (color > 15) {
        throw new Error(`parse_struct_invalid_color: slot=${slotIndex} color=${color} platformId=${platformId} chunkVersion=${chunkVersion}`);
    }
    return {
        slot: slotIndex,
        isHuman,
        name: name.value,
        civilization: civ.value,
        playerId: platformId,
        color,
        colorName: COLOR_NAMES[color] ?? `Color ${color}`,
        team,
        internalPlayerId: playerId,
        recordStart,
        colorPos,
        postColor: p,
    };
}
const CIV_MIN_LEN = 3;
const CIV_MAX_LEN = 24;
const NAME_MIN_LEN = 1;
const NAME_MAX_LEN = 64;
const TEAM_MAX = 15;
const PLAYER_ID_MAX = 15;
function findNextSlotAnchor(buf: Uint8Array, from: number, payloadEnd: number): number {
    const limit = payloadEnd - 30;
    for (let scan = from; scan < limit; scan++) {
        const isHuman = buf[scan];
        if (isHuman !== 0 && isHuman !== 1)
            continue;
        if (scan + 5 > payloadEnd)
            break;
        const nameLen = readI32LE(buf, scan + 1);
        if (nameLen < NAME_MIN_LEN || nameLen > NAME_MAX_LEN)
            continue;
        const nameEnd = scan + 5 + nameLen * 2;
        if (nameEnd + 9 > payloadEnd)
            continue;
        let bad = false;
        for (let i = 0; i < nameLen; i++) {
            const lo = buf[scan + 5 + i * 2];
            const hi = buf[scan + 5 + i * 2 + 1];
            const cp = lo | (hi << 8);
            if (cp < 0x20) {
                bad = true;
                break;
            }
            if (cp === 0x7F) {
                bad = true;
                break;
            }
            if (cp >= 0xFDD0 && cp <= 0xFDEF) {
                bad = true;
                break;
            }
            if (cp === 0xFFFE || cp === 0xFFFF) {
                bad = true;
                break;
            }
        }
        if (bad)
            continue;
        const team = readU32LE(buf, nameEnd);
        const playerId = readU32LE(buf, nameEnd + 4);
        if (team > TEAM_MAX || playerId > PLAYER_ID_MAX)
            continue;
        const unknown7 = buf[nameEnd + 8];
        if (unknown7 > 1)
            continue;
        const civLenOff = nameEnd + 9;
        if (civLenOff + 4 > payloadEnd)
            continue;
        const civLen = readI32LE(buf, civLenOff);
        if (civLen < CIV_MIN_LEN || civLen > CIV_MAX_LEN)
            continue;
        const civEnd = civLenOff + 4 + civLen;
        if (civEnd + 8 > payloadEnd)
            continue;
        let civBad = false;
        for (let i = 0; i < civLen; i++) {
            const c = buf[civLenOff + 4 + i];
            if (!((c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c === 0x5F)) {
                civBad = true;
                break;
            }
        }
        if (civBad)
            continue;
        const unknown8 = readU16LE(buf, civEnd);
        const unknown9 = readU16LE(buf, civEnd + 2);
        if (unknown8 !== 0 || unknown9 !== 34)
            continue;
        const unknown10Count = readU32LE(buf, civEnd + 4);
        if (unknown10Count !== 1 && unknown10Count !== 127)
            continue;
        return scan;
    }
    return -1;
}
const ANCHOR_MIN_GAP = 100;
const ANCHOR_MAX_GAP = 400;
const TAIL_MIN_GAP = 400;
const TAIL_MAX_GAP = 1500;
export async function extractPlayerColorsStructural(arrayBuffer: ArrayBuffer): Promise<ExtractPlayerColorsStructuralResult> {
    const buf = await gunzip(arrayBuffer);
    const setup = findGameSetupPayload(buf);
    if (!setup)
        throw new Error('parse_struct_no_setup_payload');
    const { payloadStart, payloadEnd, chunkVersion } = setup;
    if (payloadStart + 14 > payloadEnd)
        throw new Error('parse_struct_payload_too_short');
    const headerPlayerCount = readU32LE(buf, payloadStart + 10);
    if (headerPlayerCount === 0 || headerPlayerCount > 16) {
        throw new Error(`parse_struct_implausible_player_count: ${headerPlayerCount}`);
    }
    const players: GameSetupPlayerRecord[] = [];
    const trailerSizes: number[] = [];
    let p = payloadStart + 14;
    for (let slot = 0; slot < headerPlayerCount; slot++) {
        const record = readGameSetupPlayer(buf, p, payloadEnd, slot, chunkVersion);
        players.push(record);
        if (slot < headerPlayerCount - 1) {
            const nextSlot = findNextSlotAnchor(buf, record.postColor, payloadEnd);
            if (nextSlot < 0) {
                throw new Error(`parse_struct_no_anchor_found: after slot=${slot} from=${record.postColor} payloadEnd=${payloadEnd} chunkVersion=${chunkVersion}`);
            }
            const gap = nextSlot - record.postColor;
            if (gap < ANCHOR_MIN_GAP || gap > ANCHOR_MAX_GAP) {
                throw new Error(`parse_struct_anchor_distance_oob: slot=${slot} gap=${gap} expected=[${ANCHOR_MIN_GAP},${ANCHOR_MAX_GAP}] postColor=${record.postColor} nextSlot=${nextSlot} chunkVersion=${chunkVersion}`);
            }
            trailerSizes.push(gap);
            p = nextSlot;
        }
        else {
            p = record.postColor;
        }
    }
    const lastPostColor = players[players.length - 1].postColor;
    const tailGap = payloadEnd - lastPostColor;
    if (tailGap < TAIL_MIN_GAP || tailGap > TAIL_MAX_GAP) {
        throw new Error(`parse_struct_tail_gap_oob: lastPostColor=${lastPostColor} payloadEnd=${payloadEnd} gap=${tailGap} expected=[${TAIL_MIN_GAP},${TAIL_MAX_GAP}] chunkVersion=${chunkVersion}`);
    }
    const seenColors = new Set<number>();
    const duplicateColors: number[] = [];
    for (const pl of players) {
        if (seenColors.has(pl.color))
            duplicateColors.push(pl.color);
        seenColors.add(pl.color);
    }
    const warnings: StructuralWarning[] = [];
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
            trailerSizes,
            tailGap,
        },
    };
}
