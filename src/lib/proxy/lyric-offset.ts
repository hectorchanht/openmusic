// lyric-offset — pure helpers behind /api/lyric-offset (quick-260926-mzn): shared per-lyrics time
// offsets, decided by median consensus over listener votes.
//
// Same posture as diag-payload.ts: no I/O, no HTTP status knowledge, never-throw screens that return
// a sentinel. The route turns sentinels into 4xx.
//
// Consensus rule: the MEDIAN of all votes, trusted only when >= AGREE_MIN votes sit within
// ±AGREE_WINDOW_SEC of it. The median ignores a lone troll; the agree-quorum stops two listeners
// with unrelated offsets from publishing their midpoint. Both raise the bar for a bad default, and
// the client's local offset (including an explicit 0) always beats whatever this publishes.

import { normalizeLyricOffset, LYRIC_OFFSET_MAX } from '$lib/services/lrc';

/** A vote body is `{"k":"<32 hex>","offset":-600.0}` at most ~60 B; 256 leaves slack, nothing more. */
export const MAX_VOTE_BODY_BYTES = 256;
/** Most-recent votes kept per key — bounds the record (and the parse the route does per request). */
export const MAX_VOTES = 50;
export const AGREE_MIN = 3;
export const AGREE_WINDOW_SEC = 1.0;
/** Edge-cache TTL of a GET reply. A new vote busts the PoP it landed on; elsewhere it ages out. */
export const SHARED_OFFSET_TTL = 300;

export type OffsetVote = { o: number; t: number };
export type OffsetRecord = { v: 1; votes: Record<string, OffsetVote> };

/** The fingerprint key the client computes (first 32 hex of SHA-256(uid + '\n' + lrc)). */
export function isOffsetKey(k: string | null): k is string {
	return !!k && /^[0-9a-f]{32}$/.test(k);
}

/**
 * The R2 object key for a fingerprint. The ONLY place an R2 key is built for this feature; callers
 * pass a value that already passed `isOffsetKey`, so this endpoint can never touch `log/` (private
 * listening logs, read-token gated) or list anything.
 */
export function offsetObjectKey(k: string): string {
	return `lyric-offset/${k}.json`;
}

export function emptyRecord(): OffsetRecord {
	return { v: 1, votes: {} };
}

const inRange = (n: unknown): n is number =>
	typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LYRIC_OFFSET_MAX;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
	!!x && typeof x === 'object' && !Array.isArray(x);

/** Never-throw. Anything not `{v:1, votes:{...}}` is empty; bad entries are dropped one by one. */
export function parseRecord(text: string | null): OffsetRecord {
	let raw: unknown;
	try {
		raw = text ? JSON.parse(text) : null;
	} catch {
		return emptyRecord();
	}
	if (!isPlainObject(raw) || raw.v !== 1 || !isPlainObject(raw.votes)) return emptyRecord();
	const out = emptyRecord();
	for (const [id, e] of Object.entries(raw.votes)) {
		if (isPlainObject(e) && inRange(e.o) && typeof e.t === 'number' && Number.isFinite(e.t)) {
			out.votes[id] = { o: e.o, t: e.t };
		}
	}
	return out;
}

/**
 * Never-throw. Out-of-range offsets are REJECTED, not clamped: a 1e9 vote did not come from our
 * client (which normalizes to ±600), so it has no business being counted at all.
 */
export function parseVoteBody(text: string): { k: string; offset: number } | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	const k = typeof raw.k === 'string' ? raw.k : null;
	if (!isOffsetKey(k) || !inRange(raw.offset)) return null;
	return { k, offset: normalizeLyricOffset(raw.offset) };
}

/** Pure: a NEW record with `voter`'s vote set (a re-vote replaces), capped to the MAX_VOTES newest. */
export function applyVote(rec: OffsetRecord, voter: string, offset: number, now: number): OffsetRecord {
	const votes = { ...rec.votes, [voter]: { o: offset, t: now } };
	const entries = Object.entries(votes);
	if (entries.length <= MAX_VOTES) return { v: 1, votes };
	entries.sort((a, b) => b[1].t - a[1].t);
	return { v: 1, votes: Object.fromEntries(entries.slice(0, MAX_VOTES)) };
}

/** `{ offset, n }` only — never the votes. `offset` is null until the agree-quorum is met. */
export function consensus(rec: OffsetRecord): { offset: number | null; n: number } {
	const os = Object.values(rec.votes)
		.map((v) => v.o)
		.sort((a, b) => a - b);
	const n = os.length;
	if (n === 0) return { offset: null, n };
	const mid = n >> 1;
	const median = n % 2 ? os[mid] : (os[mid - 1] + os[mid]) / 2;
	const agree = os.filter((o) => Math.abs(o - median) <= AGREE_WINDOW_SEC).length;
	return { offset: agree >= AGREE_MIN ? normalizeLyricOffset(median) : null, n };
}

/**
 * First 16 hex of SHA-256(`ip|k`). Per-key salt so one voter's ids are not linkable across songs;
 * the raw IP is never stored or returned. `crypto.subtle` + `TextEncoder` are globals on workerd AND
 * Node 22 (same idiom as diag-auth.ts), so the tested path IS the edge path.
 */
export async function voterId(ip: string, k: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${k}`));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
