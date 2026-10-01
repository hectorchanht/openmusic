// cover-pick — pure helpers behind /api/cover-pick (Phase 40 D-13 / D-17 / D-18 / D-18a / D-19):
// a crowd-shared cover per song, decided by vote count over listener picks.
//
// Same posture as lyric-offset.ts: no I/O, no HTTP status knowledge, never-throw screens that return
// a sentinel. The route turns sentinels into 4xx.
//
// Two lookup keys per song (D-13), each a 32-hex hash the client computes: `u` (exact uid) and `n`
// (artist+title name key). A vote can land on either or both; each key has its own record.
//
// Consensus rule (D-17): most votes wins, one vote per voter, a re-vote replaces (D-19), a tie goes to
// the most recent vote.
//
// ponytail: no quorum — one vote publishes a cover. Bounded by the host allowlist (D-18), the per-IP
// throttle (D-18a) and the fact that a local pin always wins on the client. Upgrade path: a quorum
// like lyric-offset's AGREE_MIN, or HMAC-peppered voter ids so IP rotation costs more.

import { safeImageUrl, COVER_PICK_IMAGE_HOSTS } from './safe-image-url';
import type { Throttle } from './comments';

// The throttle STATE shape and its parser are identical to the comments route's; only the limits
// (checkThrottle below) differ, so the parser is shared rather than copied.
export type { Throttle } from './comments';
export { parseThrottle } from './comments';

/** `{"u":"<32>","n":"<32>","url":"<≤512>"}` is ~600 B at most; 1024 leaves slack, nothing more. */
export const MAX_VOTE_BODY_BYTES = 1024;
export const MAX_URL_CHARS = 512;
/** Most-recent votes kept per key — bounds the record (and the parse the route does per request). */
export const MAX_VOTES = 50;
/** Edge-cache TTL of a GET reply. A new vote busts the PoP it landed on; elsewhere it ages out. */
export const COVER_PICK_TTL = 300;
/** D-18a: own limits, looser than comments (a pick is one tap, not typed text). */
export const PICK_MIN_GAP_MS = 10_000;
export const PICK_DAILY_MAX = 60;

export type PickVote = { u: string; t: number };
export type PickRecord = { v: 1; votes: Record<string, PickVote> };
export type PickKeys = { u: string | null; n: string | null };

export function isPickKey(k: string | null): k is string {
	return !!k && /^[0-9a-f]{32}$/.test(k);
}

/**
 * The ONLY two R2 key builders for this feature. Callers pass a value that already passed
 * `isPickKey` or came out of `throttleVoterId`, so the route can never reach the private listening
 * logs, `comments/` or `lyric-offset/`, and it never enumerates the bucket.
 */
export function pickObjectKey(kind: 'u' | 'n', k: string): string {
	return `cover-pick/${kind}/${k}.json`;
}
export function pickThrottleKey(voter: string): string {
	return `cover-pick-throttle/${voter}.json`;
}

/**
 * The GET query string, in fixed `u` then `n` order. ONE builder shared by the client and the
 * route's post-vote cache bust, so the busted key is byte-identical to the one the GET cached.
 */
export function pickQuery(keys: PickKeys): string {
	return [keys.u ? `u=${keys.u}` : '', keys.n ? `n=${keys.n}` : ''].filter(Boolean).join('&');
}

/**
 * The edge-cache URL for a GET reply. Deliberately NOT the public `/api/cover-pick?…` URL:
 * adapter-cloudflare's worker answers any GET whose own URL sits in `caches.default` straight from
 * the cache, BEFORE the route and hooks.server.ts run, so the stored copy (no CORS, `max-age=300`)
 * would reach the APK WebView (https://localhost, cross-origin) unreadable. Off-path, only the route's
 * own `cache.match` finds it and it re-applies CORS. Shared by the GET and the post-vote bust so both
 * build a byte-identical key.
 */
export function pickCacheUrl(origin: string, keys: PickKeys): string {
	return `${origin}/api/cover-pick/__edge?${pickQuery(keys)}`;
}

export function emptyRecord(): PickRecord {
	return { v: 1, votes: {} };
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
	!!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Never-throw. Anything not `{v:1, votes:{...}}` is empty; bad entries are dropped one by one. The
 * url is re-screened on READ too (D-18), so a record written before an allowlist tightening, or
 * tampered with in the bucket, can never publish a url the screen would refuse today.
 */
export function parseRecord(text: string | null): PickRecord {
	let raw: unknown;
	try {
		raw = text ? JSON.parse(text) : null;
	} catch {
		return emptyRecord();
	}
	if (!isPlainObject(raw) || raw.v !== 1 || !isPlainObject(raw.votes)) return emptyRecord();
	const out = emptyRecord();
	for (const [id, e] of Object.entries(raw.votes)) {
		if (
			isPlainObject(e) &&
			typeof e.u === 'string' &&
			safeImageUrl(e.u, COVER_PICK_IMAGE_HOSTS) !== null &&
			typeof e.t === 'number' &&
			Number.isFinite(e.t)
		) {
			out.votes[id] = { u: e.u, t: e.t };
		}
	}
	return out;
}

/**
 * Never-throw. `u` and `n` are each optional but must pass `isPickKey` when present, and at least
 * one is required. The url must be a string ≤ MAX_URL_CHARS on an allowlisted https host (D-18);
 * what is stored is the normalized href the screen approved, not the raw input.
 */
export function parseVoteBody(text: string): (PickKeys & { url: string }) | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	const key = (x: unknown): string | null | false =>
		x === undefined || x === null ? null : typeof x === 'string' && isPickKey(x) ? x : false;
	const u = key(raw.u);
	const n = key(raw.n);
	if (u === false || n === false || (!u && !n)) return null;
	if (typeof raw.url !== 'string' || raw.url.length > MAX_URL_CHARS) return null;
	const url = safeImageUrl(raw.url, COVER_PICK_IMAGE_HOSTS);
	return url ? { u, n, url } : null;
}

/** Pure: a NEW record with `voter`'s vote set (a re-vote replaces, D-19), capped to the MAX_VOTES newest. */
export function applyVote(rec: PickRecord, voter: string, url: string, now: number): PickRecord {
	const votes = { ...rec.votes, [voter]: { u: url, t: now } };
	const entries = Object.entries(votes);
	if (entries.length <= MAX_VOTES) return { v: 1, votes };
	entries.sort((a, b) => b[1].t - a[1].t);
	return { v: 1, votes: Object.fromEntries(entries.slice(0, MAX_VOTES)) };
}

/** D-17: the url with the most votes; a tie goes to the url holding the most recent vote. Never the votes. */
export function consensus(rec: PickRecord): string | null {
	const tally = new Map<string, { n: number; maxT: number }>();
	for (const { u, t } of Object.values(rec.votes)) {
		const cur = tally.get(u);
		tally.set(u, { n: (cur?.n ?? 0) + 1, maxT: Math.max(cur?.maxT ?? -Infinity, t) });
	}
	let best: string | null = null;
	let top = { n: 0, maxT: -Infinity };
	for (const [u, s] of tally) {
		if (s.n > top.n || (s.n === top.n && s.maxT > top.maxT)) {
			best = u;
			top = s;
		}
	}
	return best;
}

async function hex16(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * First 16 hex of SHA-256(`ip|k`). Per-key salt (as lyric-offset) so one voter's ids are not linkable
 * across songs; the raw IP is never stored or returned.
 */
export function voterId(ip: string, k: string): Promise<string> {
	return hex16(`${ip}|${k}`);
}

/**
 * First 16 hex of SHA-256(`ip|cover-pick`). A GLOBAL salt BY DESIGN (D-18a, as comments): the
 * throttle is per address across every song. Residual: SHA-256 over IPv4 is brute-forceable offline
 * if the private bucket ever leaked; no hash ever leaves the edge.
 */
export function throttleVoterId(ip: string): Promise<string> {
	return hex16(`${ip}|cover-pick`);
}

/** D-18a: PICK_MIN_GAP_MS between votes and PICK_DAILY_MAX per UTC day, per address. */
export function checkThrottle(th: Throttle | null, now: number): { ok: true; next: Throttle } | { ok: false } {
	const day = new Date(now).toISOString().slice(0, 10);
	if (th && now - th.last < PICK_MIN_GAP_MS) return { ok: false };
	if (th && th.day === day && th.n >= PICK_DAILY_MAX) return { ok: false };
	return { ok: true, next: { last: now, day, n: th && th.day === day ? th.n + 1 : 1 } };
}
