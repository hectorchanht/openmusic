// Shared Deezer cover/search upstream call for the /api/* proxy routes (OG-EP-03).
//
// WHY THIS MODULE EXISTS: a SvelteKit `+server.ts` may export ONLY HTTP verbs. A top-level
// non-verb `export function` in a route file 500s at REQUEST time ("Invalid export") and unit
// tests miss it entirely because they import the module directly (project finding
// `svelte-server-endpoint-only-verb-exports`). `/api/og` (OG-EP-01) needs the same Deezer call
// that `/api/deezer/search` already had inline, so the shared half moves HERE instead of being
// exported from the route. Required, not cosmetic.
//
// This is a no-behavior-change extraction out of `src/routes/api/deezer/search/+server.ts`
// (quick-260606-wv8, WV8-01): the route keeps its own CORS shaping, cache orchestration, TTL,
// retries and timeout untouched. The proof is `api/deezer/search/deezer-endpoint.test.ts`
// passing with ZERO edits (T-30-03) — that file was written against the route and never touches
// an internal helper.
//
// LIVE Deezer probe (2026-06-06, re-confirmed by research 2026-08-07 — the facts this module is
// built on):
//  - GET https://api.deezer.com/search?q=<term> → { data: [...], total }. A no-match returns
//    { data: [], total: 0 } — a CLEAN 200 with NO error envelope. No API key is required.
//  - data[0].album.cover_xl (1000) / cover_big (500) / cover_medium (250);
//    data[0].artist.picture_xl / picture_big.
//  - Image host is cdn-images.dzcdn.net (under .dzcdn.net); all https:.
//  - api.deezer.com sends NO Access-Control-Allow-Origin → a browser fetch is CORS-BLOCKED, so
//    the edge proxy is REQUIRED (it also adds caching + own-origin posture parity).
//  - Rate limit ~50 req / 5 s → the route's caches.default TTL 86400 + the client CAP=3 +
//    AbortSignal.timeout keep us well under it (T-wv8-04 self-DoS guard).
//  - Measured cover bytes for one cover: cover_xl 208,487 · cover_big 72,650 · 264px 26,011
//    (§C.13) — the reason `prefer` exists below.
import { fetchWithRetry } from '$lib/proxy/http';

const DEEZER_SEARCH = 'https://api.deezer.com/search';

/** Cover/artist-picture is near-static; one full day keeps re-browsing off Deezer's rate cap. */
export const DEEZER_COVER_TTL = 86400;

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

/**
 * Validate an image URL before it leaves the edge (parity with the discovery route's
 * safeImageUrl, threat T-wv8-05). The client renders it as an `<img src>` attribute; even so
 * we reject anything that could break out of an attribute / inject a CSS url() layer. Allowed:
 * https:// only, on a *.dzcdn.net host, with NO CSS/attribute-breaking characters. Anything
 * else → null (the field becomes null → the tile keeps its gradient, never a broken image).
 *
 * DEEZER-ONLY BY NAME (OG-EP-03): the allowlist is per-tier, so a Deezer body can never smuggle
 * an mzstatic/kuwo URL past this check (and vice versa for the iTunes/kuwo siblings).
 */
export function safeDeezerImageUrl(raw: string | null | undefined): string | null {
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

/** Safe preview URL — only https + on a cdnt-preview.dzcdn.net (the 30s mp3 host). */
export function safeDeezerPreviewUrl(raw: string | null | undefined): string | null {
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

/**
 * Pick the album cover variant. `'xl'` is the LEGACY order (cover_xl ?? cover_big ??
 * cover_medium) the client tiles have always received and must keep receiving byte-identically.
 * `'big'` flips to cover_big first for `/api/og`: measured 72,650 B vs 208,487 B for the same
 * cover (§C.13), and a crawler's fetch budget is what OG-EP-01 exists to stay inside (Pitfall 6).
 */
function pickAlbumCover(album: DzAlbum | undefined, prefer: 'xl' | 'big'): string | null {
	if (!album) return null;
	return prefer === 'big'
		? (album.cover_big ?? album.cover_xl ?? album.cover_medium ?? null)
		: (album.cover_xl ?? album.cover_big ?? album.cover_medium ?? null);
}

/** Normalize one Deezer hit to the client-facing shape. */
function reshapeHit(it: DzResult | undefined): DeezerHit | null {
	if (!it || it.id === undefined || it.id === null) return null;
	// Always the legacy xl-first order: `results` is a CLIENT-only payload (dedupe /
	// recommendation, quick-260607-jau); /api/og reads cover/artistPicture only, so `prefer`
	// deliberately does not reach here.
	const rawCover = pickAlbumCover(it.album, 'xl');
	return {
		id: String(it.id),
		title: it.title ?? '',
		artist: it.artist?.name ?? '',
		album: it.album?.title ?? '',
		cover: safeDeezerImageUrl(rawCover),
		preview: safeDeezerPreviewUrl(it.preview)
	};
}

/**
 * Reshape a Deezer search envelope. `limit=1` (cover-mode) yields the cheap legacy payload
 * (cover/artistPicture from data[0] only) so existing backfill callers stay byte-compatible.
 * `limit>1` populates `results` with up to `limit` normalized hits for dedupe/recommendation
 * callers (quick-260607-jau).
 *
 * `data` is `unknown` (OG-EP-03): `/api/og` hands over a raw parsed body, and this is untrusted
 * third-party JSON either way — it is narrowed inside and every field access is optional, so a
 * malformed/empty body yields the `{ cover: null, artistPicture: null }` sentinel, never a throw.
 */
export function reshapeDeezerSearch(
	data: unknown,
	limit: number,
	prefer: 'xl' | 'big' = 'xl'
): DeezerCover {
	const body = (data ?? {}) as DeezerSearchResponse;
	const arr = Array.isArray(body.data) ? body.data : [];
	const top = arr[0];
	const rawPicture = top?.artist?.picture_xl ?? top?.artist?.picture_big ?? null;
	const base: DeezerCover = {
		cover: safeDeezerImageUrl(pickAlbumCover(top?.album, prefer)),
		artistPicture: safeDeezerImageUrl(rawPicture)
	};
	if (limit > 1) {
		base.results = arr
			.slice(0, limit)
			.map(reshapeHit)
			.filter((h): h is DeezerHit => h !== null);
	}
	return base;
}

/**
 * Build the upstream Deezer search URL. Passthrough-only: `q` is encodeURIComponent'd into a
 * FIXED template — no command/template construction (T-wv8-01).
 */
export function deezerSearchUrl(q: string, limit = 1): string {
	return `${DEEZER_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}`;
}

/**
 * Bounded, never-throws Deezer search → reshaped { cover, artistPicture }.
 *
 * TWO-VALUED RETURN (the contract `/api/og` negative-caching depends on, §C.9):
 *  - `null` = FAULT. Returned on: already-aborted signal, non-ok response, malformed JSON,
 *    abort/timeout, network failure, or any thrown error. A fault must NEVER be cached — the
 *    caller retries on the next request instead of pinning a miss for the whole TTL.
 *  - `{ cover: null, artistPicture: null }` = CLEAN MISS. Deezer answered 200 with
 *    `{ data: [], total: 0 }` (its documented no-match shape) — cacheable.
 *
 * `retries` is passed through to fetchWithRetry (extra attempts after the first). `prefer`
 * selects the cover variant (see pickAlbumCover). `limit` mirrors the route's `?limit` param:
 * >1 populates `results` (quick-260607-jau) — kept here so the extraction does not regress
 * `deezerSearchTracks()` (deezer.ts:186, calls with limit=10).
 */
export async function fetchDeezerCover(
	q: string,
	signal: AbortSignal,
	retries = 2,
	prefer: 'xl' | 'big' = 'xl',
	limit = 1
): Promise<DeezerCover | null> {
	if (signal.aborted) return null;
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): fetchWithRetry is the SERVER-SIDE
		// (Cloudflare edge) fetch of the UPSTREAM api.deezer.com URL. apiFetch is the CLIENT
		// seam — it prepends the /api base and must not run edge-side. Bounded retry + the
		// caller's native AbortSignal.timeout (T-wv8-04, 429/5xx backoff is free).
		const res = await fetchWithRetry(deezerSearchUrl(q, limit), { signal }, retries);
		if (!res.ok) return null;
		const data = (await res.json()) as unknown;
		return reshapeDeezerSearch(data, limit, prefer);
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → fault sentinel (null).
		return null;
	}
}
