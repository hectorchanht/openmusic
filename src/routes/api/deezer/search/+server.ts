// Deezer cover/search edge proxy (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for the home discovery tiles. This route mirrors
// the /api/lastfm/discovery posture VERBATIM (own-origin CORS, OPTIONS 204 preflight,
// caches.default edge cache keyed by the OWN-ORIGIN Request, fetchWithRetry + native
// AbortSignal.timeout, a safeImageUrl host allow-list) — but carries NO secret: Deezer's
// public search needs no key, so there is NO env/secret read and NO proxy-types.ts Env
// change.
//
// LIVE Deezer probe (2026-06-06, curl vs api.deezer.com — the facts this route is built on):
//  - GET https://api.deezer.com/search?q=<term> → { data: [...], total }. A no-match returns
//    { data: [], total: 0 } — a CLEAN 200 with NO error envelope. No API key is required.
//  - data[0].album.cover_xl (1000) / cover_big (500) / cover_medium (250);
//    data[0].artist.picture_xl / picture_big.
//  - Image host is cdn-images.dzcdn.net (under .dzcdn.net); all https:.
//  - api.deezer.com sends NO Access-Control-Allow-Origin → a browser fetch is CORS-BLOCKED,
//    so this edge proxy is REQUIRED (it also adds caching + own-origin posture parity).
//  - Rate limit ~50 req / 5 s → caches.default TTL 86400 + the client CAP=3 + AbortSignal.timeout
//    keep us well under it (T-wv8-04 self-DoS guard).
//
// COVERS/search SCOPE ONLY: the upstream parse + reshape is funnelled through a single
// reshapeSearch() so the proxy can be EXTENDED later for charts/album/artist-info (tasks
// 3b/3c) WITHOUT restructuring — but only the search → { cover, artistPicture } path ships now.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const DEEZER_SEARCH = 'https://api.deezer.com/search';

// Cover/artist-picture is near-static; one full day keeps re-browsing off Deezer's rate cap.
const TTL = 86400;

/** Client-facing reshape of a Deezer search top result. */
export interface DeezerCover {
	cover: string | null;
	artistPicture: string | null;
	/** Top-N reshaped track hits (quick-260607-jau). Empty when `limit=1` (default — keeps
	 *  the existing cover-backfill consumers payload tiny + backward-compatible). When the
	 *  caller passes `?limit=N` (clamped to [1,25]) this populates with normalized hits for
	 *  dedupe/recommendation use. Cover-only callers ignore the field. */
	results?: DeezerHit[];
}

/** One Deezer search hit, reshaped to a normalized shape the client can consume. */
export interface DeezerHit {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	/** 30-second mp3 preview Deezer returns publicly (never the full track — that needs `arl`). */
	preview: string | null;
}

// edgeCache() (caches.default narrowing + `typeof caches` dev guard) is shared from
// $lib/proxy/edge-cache (quick-260713-mqv). Cache key stays the own-origin Request below.

function jsonResult(result: DeezerCover, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerCover), { status: 200, headers });
}

/**
 * Validate an image URL before it leaves the edge (parity with the discovery route's
 * safeImageUrl, threat T-wv8-05). The client renders it as an `<img src>` attribute; even so
 * we reject anything that could break out of an attribute / inject a CSS url() layer. Allowed:
 * https:// only, on a *.dzcdn.net host, with NO CSS/attribute-breaking characters. Anything
 * else → null (the field becomes null → the tile keeps its gradient, never a broken image).
 */
function safeImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

// ---- Deezer response sub-shapes (only the fields we read; all optional — untrusted JSON). ----
interface DzAlbum {
	id?: number;
	title?: string;
	cover_xl?: string;
	cover_big?: string;
	cover_medium?: string;
}
interface DzArtist {
	id?: number;
	name?: string;
	picture_xl?: string;
	picture_big?: string;
}
interface DzResult {
	id?: number;
	title?: string;
	preview?: string;
	album?: DzAlbum;
	artist?: DzArtist;
}
interface DeezerSearchResponse {
	data?: DzResult[];
	total?: number;
}

/** Safe preview URL — only https + on a cdnt-preview.dzcdn.net (the 30s mp3 host). */
function safePreviewUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host.endsWith('.dzcdn.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

/** Normalize one Deezer hit to the client-facing shape. */
function reshapeHit(it: DzResult | undefined): DeezerHit | null {
	if (!it || it.id === undefined || it.id === null) return null;
	const rawCover = it.album?.cover_xl ?? it.album?.cover_big ?? it.album?.cover_medium ?? null;
	return {
		id: String(it.id),
		title: it.title ?? '',
		artist: it.artist?.name ?? '',
		album: it.album?.title ?? '',
		cover: safeImageUrl(rawCover),
		preview: safePreviewUrl(it.preview)
	};
}

/**
 * Reshape a Deezer search envelope. `limit=1` (cover-mode) yields the cheap legacy payload
 * (cover/artistPicture from data[0] only) so existing backfill callers stay byte-compatible.
 * `limit>1` populates `results` with up to `limit` normalized hits for dedupe/recommendation
 * callers (quick-260607-jau).
 */
function reshapeSearch(data: DeezerSearchResponse, limit: number): DeezerCover {
	const top = data?.data?.[0];
	const rawCover = top?.album?.cover_xl ?? top?.album?.cover_big ?? top?.album?.cover_medium ?? null;
	const rawPicture = top?.artist?.picture_xl ?? top?.artist?.picture_big ?? null;
	const base: DeezerCover = {
		cover: safeImageUrl(rawCover),
		artistPicture: safeImageUrl(rawPicture)
	};
	if (limit > 1) {
		const arr = Array.isArray(data?.data) ? data!.data!.slice(0, limit) : [];
		base.results = arr.map(reshapeHit).filter((h): h is DeezerHit => h !== null);
	}
	return base;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	// No secret/env read: Deezer public search is keyless. There is intentionally NO
	// platform.env access here (T-wv8-03 — nothing to leak).
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty/missing q → empty result with NO upstream fetch (T-wv8-01 short-circuit).
	if (!q) return jsonResult({ cover: null, artistPicture: null }, origin);

	// jau: optional ?limit param (clamped [1,25]). Default 1 = backward-compat cover mode;
	// >1 surfaces `results` for dedupe/recommendation use without breaking existing callers.
	const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 1));

	// Passthrough-only upstream: q is encodeURIComponent'd into the fixed search string — no
	// command/template construction (T-wv8-01).
	const upstream = `${DEEZER_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}`;

	// Cache key = the OWN-ORIGIN request (NEVER the upstream api.deezer.com URL — T-wv8-06).
	// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
			// CORS-FREE body, so a cross-origin (preview vs prod) hit never receives a prior
			// requester's Access-Control-Allow-Origin. `results` (jau) is preserved when present.
			const cached = (await hit.json()) as DeezerCover;
			return jsonResult(
				{
					cover: cached.cover ?? null,
					artistPicture: cached.artistPicture ?? null,
					...(cached.results ? { results: cached.results } : {})
				},
				origin,
				TTL
			);
		}
	}

	try {
		// Bounded retry + native timeout (T-wv8-04, 429/5xx backoff is free).
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as DeezerSearchResponse;
		const result = reshapeSearch(data, limit);
		if (cache) {
			// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
			const cached = new Response(JSON.stringify(result satisfies DeezerCover), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonResult(result, origin, TTL);
	} catch {
		// Upstream error / malformed JSON / non-ok-throw → best-effort empty (NO cache write).
		return jsonResult({ cover: null, artistPicture: null }, origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
