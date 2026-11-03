// JBSou （煎餅搜， www.jbsou.cn) edge helpers — shared by /api/jbsou/resolve (quick-261101-jbs).
//
// JBSou is an aggregator over the SAME netease/qq catalogs we already hold: its search rows
// carry the upstream songid (netease id / qq mid) plus a per-row SIGNED resolve path
// (`api.php?get=url&type=wy&id=…&sign=…&t=…`) that 302s to the real CDN file. We use it for
// exactly one thing — a fallback RESOLVE pipe when a primary pipe yields no playable URL
// (the qijieya Meting type=url dry spell). It is NOT a catalog source: no search surface,
// no registry entry, and its rows never reach the client — this module answers with ONE
// final stream URL or nothing.
//
// Protocol (facts from the musicdl spec, re-verified live from the VM 2026-11-01):
//   1. GET the homepage — an inline `document.cookie="mk_visit=…"` script sets the session
//      cookie the search POST demands. There is no secret of ours; the value is per-visit.
//   2. POST https://www.jbsou.cn/ form {input, filter=name, type=netease|qq, page=1} with
//      X-Requested-With: XMLHttpRequest + the cookie → JSON { data: [rows] }.
//   3. Follow the picked row's signed path (same cookie) with redirect:'manual' → Location
//      is the final CDN URL (music.126.net / qqmusic hosts).
//
// Matching is deliberately STRICT (a wrong-song URL is worse than a failure):
//   1. songid identity — a row whose songid IS the wanted upstream id wins outright.
//   2. matchKey(artist, title) identity — the same gate resolve-edge.ts and catalog's
//      lyricFromSource use; scoreMatch only RANKS within that identity set.
//   3. Nothing looser. JBSou's netease rows are cover-heavy (the live probe's first page
//      for 晴天 was mostly covers), so a fuzzy tier would rescue the WRONG recording.
import { fetchWithRetry } from './http';
import { matchKey } from '$lib/services/dedupe';
import { foldScriptReady } from '$lib/services/zh-convert';
import { scoreMatch } from '$lib/services/score-match';
import type { Track } from '$lib/sources/types';

export const JBSOU_BASE = 'https://www.jbsou.cn/';
const JBSOU_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** The JBSou search `type` values this pipe uses (its signed paths use wy/tx — not our input). */
export type JbsouType = 'netease' | 'qq';

export interface JbsouRow {
	songid: string;
	name: string;
	artist: string;
	/** The row's signed resolve path, relative to JBSOU_BASE (e.g. `api.php?get=url&…`). */
	urlPath: string;
}

export interface JbsouWant {
	/** The upstream songid (netease id / qq mid) when known — the identity key. */
	id?: string;
	title: string;
	artist: string;
}

/**
 * Extract the `mk_visit` cookie pair from the homepage HTML. The inline script assigns
 * `document.cookie="mk_visit=<token>; expires=…; path=/"` — only the first `name=value`
 * pair is a cookie; the rest are attributes. Returns null when the challenge is absent
 * (shape drift — the caller treats it as an upstream failure, never a crash).
 */
export function extractMkVisitCookie(html: string): string | null {
	const m = /document\.cookie\s*=\s*"([^"]+)"/.exec(html ?? '');
	if (!m) return null;
	const pair = m[1].split(';')[0].trim();
	return pair.startsWith('mk_visit=') && pair.length > 'mk_visit='.length ? pair : null;
}

/** Parse the search response body into rows. Any shape drift → [] (a clean no-rows answer). */
export function parseJbsouRows(body: unknown): JbsouRow[] {
	if (!body || typeof body !== 'object') return [];
	const data = (body as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	const rows: JbsouRow[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const songid = typeof r.songid === 'string' ? r.songid : typeof r.songid === 'number' ? String(r.songid) : '';
		const urlPath = typeof r.url === 'string' ? r.url : '';
		if (!songid || !urlPath) continue;
		rows.push({
			songid,
			name: typeof r.name === 'string' ? r.name : '',
			artist: typeof r.artist === 'string' ? r.artist : '',
			urlPath
		});
	}
	return rows;
}

/** Minimal Track stub so scoreMatch can rank a row (it reads artist/title/duration only). */
function rowTrack(row: JbsouRow, type: JbsouType): Track {
	return {
		uid: `${type}:${row.songid}`,
		source: type,
		songid: row.songid,
		title: row.name,
		artist: row.artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
}


/**
 * Acceptance floor for the matchKey tier. Every identity-set member scores SIM_EXACT (10)
 * on similarity, so the only way down is scoreMatch's variant penalty (−4 per un-asked-for
 * variant keyword in the candidate title: live / remix / 伴奏 …). ≥8 therefore means
 * "identity-equal AND variant-clean" — an identity-equal LIVE row (10−4=6) is refused:
 * rescuing a different rendition is a wrong-song rescue.
 */
export const JBSOU_MIN_SCORE = 8;

/**
 * Pick the ONE row that is confidently the wanted song, or null. Strict by design (see the
 * header): songid identity first, then matchKey identity ranked by scoreMatch with the
 * JBSOU_MIN_SCORE floor.
 */
export function pickJbsouRow(rows: JbsouRow[], want: JbsouWant, type: JbsouType): JbsouRow | null {
	if (want.id) {
		const byId = rows.find((r) => r.songid === want.id);
		if (byId) return byId;
	}
	const wantKey = matchKey(want.artist, want.title);
	if (!want.title || wantKey === '|') return null;
	const q = { artist: want.artist || '', title: want.title || '' };
	const identity = rows.filter((r) => matchKey(r.artist, r.name) === wantKey);
	if (identity.length === 0) return null;
	identity.sort((a, b) => scoreMatch(q, rowTrack(b, type)) - scoreMatch(q, rowTrack(a, type)));
	const best = identity[0];
	return scoreMatch(q, rowTrack(best, type)) >= JBSOU_MIN_SCORE ? best : null;
}

/** Audio extensions a JBSou redirect may legitimately land on (the signed path's only job). */
const AUDIO_PATH_RE = /\.(mp3|m4a|aac|flac|ogg|opus)$/i;

/**
 * Validate + normalize a redirect Location into a playable URL: absolute http(s), https
 * after the mixed-content upgrade (the /api/stream-url idiom), pathname ending in an audio
 * extension. Anything else (an HTML error page, a login wall) → null.
 */
export function normalizeJbsouLocation(location: string | null): string | null {
	if (!location) return null;
	let u: URL;
	try {
		u = new URL(location, JBSOU_BASE);
	} catch {
		return null;
	}
	if (u.protocol === 'http:') u.protocol = 'https:';
	if (u.protocol !== 'https:') return null;
	if (!AUDIO_PATH_RE.test(u.pathname)) return null;
	return u.toString();
}

// --- Cookie session memo (per-isolate, the bilibili stream route's memo idiom) -------------
const COOKIE_TTL_MS = 5 * 60 * 1000;
let cookieMemo: { value: string; at: number } | null = null;

/** TEST-ONLY: clear the memoized cookie so cases cannot leak into each other. */
export function __resetJbsouSession(): void {
	cookieMemo = null;
}

async function fetchFreshCookie(): Promise<string | null> {
	try {
		const res = await fetchWithRetry(
			JBSOU_BASE,
			{ headers: { 'User-Agent': JBSOU_UA }, signal: AbortSignal.timeout(8000) },
			1
		);
		if (!res.ok) return null;
		const cookie = extractMkVisitCookie(await res.text());
		if (cookie) cookieMemo = { value: cookie, at: Date.now() };
		return cookie;
	} catch {
		return null;
	}
}

async function getCookie(forceFresh: boolean): Promise<string | null> {
	if (!forceFresh && cookieMemo && Date.now() - cookieMemo.at < COOKIE_TTL_MS) {
		return cookieMemo.value;
	}
	return fetchFreshCookie();
}

async function searchJbsou(type: JbsouType, input: string, cookie: string): Promise<JbsouRow[] | null> {
	try {
		const res = await fetchWithRetry(
			JBSOU_BASE,
			{
				method: 'POST',
				headers: {
					'User-Agent': JBSOU_UA,
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Referer: JBSOU_BASE,
					Origin: 'https://www.jbsou.cn',
					Cookie: cookie
				},
				body: new URLSearchParams({ input, filter: 'name', type, page: '1' }),
				signal: AbortSignal.timeout(12000)
			},
			1
		);
		if (!res.ok) return null;
		const body: unknown = await res.json().catch(() => null);
		if (body === null) return null;
		return parseJbsouRows(body);
	} catch {
		return null;
	}
}

/** The pipe's three outcomes — the route maps them to 200 {url} / 200 {url:null} / 503 so
 *  the client health gate can tell a dead pipe from a live one with no match. */
export type JbsouResolveResult =
	| { kind: 'ok'; url: string }
	| { kind: 'nomatch' }
	| { kind: 'fail' };

/**
 * The full pipe: cookie → search by "title artist" → strict pick → follow the signed path →
 * final CDN URL. Never throws. Bounded: ≤2 homepage fetches, ≤2 search POSTs, 1 redirect fetch.
 */
export async function resolveViaJbsou(type: JbsouType, want: JbsouWant): Promise<JbsouResolveResult> {
	// quick-261102-sdm: search in Simplified (the one identity fold) and warm the fold BEFORE
	// pickJbsouRow keys rows — a cold edge isolate otherwise keyed 周杰倫 ≠ 周杰伦.
	const input = `${await foldScriptReady(want.title)} ${await foldScriptReady(want.artist)}`.trim();
	if (!input) return { kind: 'fail' };

	for (let attempt = 0; attempt < 2; attempt++) {
		const cookie = await getCookie(attempt > 0);
		if (!cookie) return { kind: 'fail' };
		const rows = await searchJbsou(type, input, cookie);
		if (rows === null) {
			// A dead search most often means the challenge cookie rotated — drop the memo and
			// take the ONE retry with a fresh cookie; a second failure is a real upstream failure.
			if (attempt === 0) {
				cookieMemo = null;
				continue;
			}
			return { kind: 'fail' };
		}
		const row = pickJbsouRow(rows, want, type);
		if (!row) return { kind: 'nomatch' }; // retrying with a new cookie cannot help

		try {
			const signed = new URL(row.urlPath, JBSOU_BASE).toString();
			const res = await fetchWithRetry(
				signed,
				{
					redirect: 'manual', // we want the Location, never the bytes (stream-url idiom)
					headers: { 'User-Agent': JBSOU_UA, Cookie: cookie },
					signal: AbortSignal.timeout(8000)
				},
				1
			);
			await res.body?.cancel().catch(() => {});
			const final = normalizeJbsouLocation(res.headers.get('location'));
			// A matched row whose signed path does not land on audio is an upstream failure
			// shape (dead sign / login wall), not a no-match.
			return final ? { kind: 'ok', url: final } : { kind: 'fail' };
		} catch {
			return { kind: 'fail' };
		}
	}
	return { kind: 'fail' };
}
