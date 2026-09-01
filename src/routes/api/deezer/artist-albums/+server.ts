// Deezer artist-albums edge proxy (Phase 23, ART-01 / D-19 / UI-SPEC §8.2 — AUGMENT path).
//
// Returns each album's nb_tracks NATIVELY so the artist page can hide trackless albums with
// ZERO per-album fetches (D-19). Mirrors the /api/deezer/search posture VERBATIM:
//  - own-origin CORS via corsHeaders(origin) (NEVER `*`), OPTIONS 204 preflight,
//  - caches.default edge cache keyed by the OWN-ORIGIN Request (NEVER the upstream URL),
//  - fetchWithRetry + native AbortSignal.timeout (no hand-rolled timeout),
//  - a safeImageUrl host allow-list (*.dzcdn.net) for every cover that becomes an <img src>,
//  - never-throw: ANY upstream failure / malformed JSON returns a 200 { data: [] } (never a 5xx
//    leak of the upstream status/body).
// Carries NO secret — Deezer's public API is keyless (no env/platform read, nothing to leak).
//
// Upstream flow (T-23-16 SSRF/URL-injection guard): the user-supplied `q` is NEVER concatenated
// into a host or path. It is sent ONLY as an encodeURIComponent'd VALUE to the fixed
// `api.deezer.com/search/artist` endpoint to resolve a NUMERIC artist id; that numeric id (a
// validated integer, not raw input) is then interpolated into the fixed
// `api.deezer.com/artist/{id}/albums` path. The host is always the literal api.deezer.com.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { pickBestArtistId, DEEZER_ARTIST_SEARCH_LIMIT } from '$lib/proxy/deezer-pick';

const DEEZER_ARTIST_SEARCH = 'https://api.deezer.com/search/artist';
const DEEZER_ARTIST_ALBUMS = 'https://api.deezer.com/artist'; // + /{id}/albums

// Artist discographies are near-static; one full day keeps re-browsing off Deezer's rate cap
// (mirrors the search route's TTL).
const TTL = 86400;

/** Deezer caps `limit` at 50 per page and exposes `index` for paging. quick-260831-qkx pages up
 *  to PAGES × 50 so a deep discography is genuinely exhaustive (Coldplay has 123 releases, so the
 *  old single limit=50 call truncated it) while staying bounded — 3 sequential calls, worst case. */
const ALBUMS_PAGE_SIZE = 50;
const ALBUMS_MAX_PAGES = 3;

/** A Deezer release type. 'album' | 'ep' | 'single' | 'compilation' upstream; kept as a loose
 *  string because Deezer has added types before and an unknown one must not drop the release. */
export type DeezerRecordType = string;

/** Client-facing reshape of one Deezer album (narrow shape — no upstream fields leak).
 *  quick-260831-qkx widened this: `id` lets the album page fetch the REAL tracklist instead of
 *  re-matching by name through Last.fm, and `release_date`/`record_type` are what the shelf sorts
 *  and filters on. */
export interface DeezerArtistAlbum {
	id: number | null;
	title: string;
	nb_tracks: number;
	cover: string | null;
	release_date: string | null;
	record_type: DeezerRecordType | null;
}

/** The proxy's response envelope. */
export interface DeezerArtistAlbumsResult {
	data: DeezerArtistAlbum[];
}

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

function jsonResult(result: DeezerArtistAlbumsResult, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerArtistAlbumsResult), { status: 200, headers });
}

const EMPTY: DeezerArtistAlbumsResult = { data: [] };

/**
 * Validate an image URL before it leaves the edge (parity with the search route's safeImageUrl,
 * threat T-23-17). The client renders it as an `<img src>`/`background-image` attribute; reject
 * anything that could break out of an attribute / inject a CSS url() layer. Allowed: https:// on
 * a *.dzcdn.net host, with NO CSS/attribute-breaking characters. Anything else → null.
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

/** Clamp an untrusted nb_tracks to a non-negative integer (0 if absent/garbage/negative). */
function clampCount(raw: unknown): number {
	const n = Math.floor(Number(raw));
	return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---- Deezer response sub-shapes (only the fields we read; all optional — untrusted JSON). ----
interface DzArtistSearchItem {
	id?: number;
	/** Read by pickBestArtistId to skip namesake shell profiles (quick-260831-qkx). */
	name?: string;
	nb_fan?: number;
}
interface DzArtistSearchResponse {
	data?: DzArtistSearchItem[];
}
interface DzAlbumItem {
	id?: number;
	title?: string;
	nb_tracks?: number;
	cover_xl?: string;
	cover_big?: string;
	cover_medium?: string;
	cover?: string;
	release_date?: string;
	record_type?: string;
}
interface DzAlbumsResponse {
	data?: DzAlbumItem[];
	total?: number;
}

/** ISO date guard: only `YYYY-MM-DD` passes through, so the client sort key can never be a
 *  surprise string. Anything else → null (those entries sort last). */
function safeReleaseDate(raw: string | null | undefined): string | null {
	return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** Record type guard: a short lowercase a–z word or null. Keeps an unknown-but-plausible type
 *  (Deezer has added types before) while refusing anything that could reach the DOM as markup. */
function safeRecordType(raw: string | null | undefined): DeezerRecordType | null {
	return typeof raw === 'string' && /^[a-z]{1,20}$/.test(raw) ? raw : null;
}

/** Reshape one Deezer album to the narrow client shape; covers pass through safeImageUrl. */
function reshapeAlbum(it: DzAlbumItem | undefined): DeezerArtistAlbum | null {
	if (!it) return null;
	const rawCover = it.cover_xl ?? it.cover_big ?? it.cover_medium ?? it.cover ?? null;
	// The id is interpolated into a FIXED upstream path by /api/deezer/album-tracks, so validate
	// it as a positive integer here rather than trusting the upstream field (T-23-16 parity).
	const rawId = Math.floor(Number(it.id));
	return {
		id: Number.isFinite(rawId) && rawId > 0 ? rawId : null,
		title: it.title ?? '',
		nb_tracks: clampCount(it.nb_tracks),
		cover: safeImageUrl(rawCover),
		release_date: safeReleaseDate(it.release_date),
		record_type: safeRecordType(it.record_type)
	};
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	// No secret/env read: Deezer's public API is keyless (T-23-18 — nothing to leak).
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty/missing q → empty result with NO upstream fetch (short-circuit).
	if (!q) return jsonResult(EMPTY, origin);

	// Cache key = the OWN-ORIGIN request (NEVER the upstream api.deezer.com URL — T-23-19).
	// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (the cached body is CORS-free, WR-01).
			const cached = (await hit.json()) as DeezerArtistAlbumsResult;
			return jsonResult({ data: Array.isArray(cached.data) ? cached.data : [] }, origin, TTL);
		}
	}

	try {
		// 1) Resolve the artist id. q is sent ONLY as an encoded VALUE to the fixed search host
		//    (T-23-16 — never as a host/path). The browser fetch to Deezer is CORS-blocked, so
		//    this MUST be proxied at the edge.
		// quick-260831-qkx: ask for SEVERAL hits and pick, instead of trusting data[0]. This route
		// was the FOURTH caller of the namesake-shell bug fixed in
		// debug/upnext-diverse-fallback-kuwo-dead — `limit=1` for "Coldplay" returns id 316813311
		// (91 fans, ZERO albums), so the shelf silently fell through to Last.fm's popularity-ranked
		// top-albums sample. The real Coldplay (id 892) has 123 releases.
		const searchUrl = `${DEEZER_ARTIST_SEARCH}?q=${encodeURIComponent(q)}&limit=${DEEZER_ARTIST_SEARCH_LIMIT}`;
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		// WR-05: fetchWithRetry RETURNS (does not throw) a 429/5xx once the retry budget is
		// exhausted, and Deezer signals quota errors as 200 + {"error":{…}}. Both are TRANSIENT
		// failures — return best-effort empty WITHOUT cache.put, or a single rate-limit window
		// would pin "no albums" at the edge for a full day (no-negative-caching posture, T-17-13).
		if (!searchRes.ok) return jsonResult(EMPTY, origin);
		const searchData = (await searchRes.json()) as DzArtistSearchResponse & { error?: unknown };
		if (searchData.error) return jsonResult(EMPTY, origin);
		const rawId = pickBestArtistId(searchData?.data ?? [], q);
		// Validate the id as a positive integer BEFORE it enters the albums URL path (T-23-16).
		const artistId = Math.floor(Number(rawId));
		if (!Number.isFinite(artistId) || artistId <= 0) {
			// No artist match → genuine empty result (cache it: a real "no albums" answer).
			if (cache) {
				await cache.put(
					cacheReq,
					new Response(JSON.stringify(EMPTY), {
						status: 200,
						headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
					})
				);
			}
			return jsonResult(EMPTY, origin, TTL);
		}

		// 2) Fetch the artist's albums (the numeric id is interpolated into the FIXED path —
		//    never raw user input). nb_tracks comes back natively per album (D-19).
		// quick-260831-qkx: PAGE the discography. Deezer caps a page at 50, so the old single
		// limit=50 call truncated any artist with a deeper catalogue — part of the reported
		// "not exhaustive". Bounded to ALBUMS_MAX_PAGES sequential calls, stopping early on a
		// short page. A page that fails mid-way keeps what was already collected rather than
		// discarding the whole discography.
		const list: DzAlbumItem[] = [];
		for (let pageIdx = 0; pageIdx < ALBUMS_MAX_PAGES; pageIdx++) {
			const albumsUrl = `${DEEZER_ARTIST_ALBUMS}/${artistId}/albums?limit=${ALBUMS_PAGE_SIZE}&index=${pageIdx * ALBUMS_PAGE_SIZE}`;
			const albumsRes = await fetchWithRetry(albumsUrl, { signal: AbortSignal.timeout(8000) }, 2);
			// WR-05: same transient-failure guards as the search call — never negative-cache a
			// rate-limited/erroring albums response as a genuine "artist has no albums". On the
			// FIRST page a failure is fatal (nothing collected); on a later page keep what we have.
			if (!albumsRes.ok) {
				if (pageIdx === 0) return jsonResult(EMPTY, origin);
				break;
			}
			const albumsData = (await albumsRes.json()) as DzAlbumsResponse & { error?: unknown };
			if (albumsData.error) {
				if (pageIdx === 0) return jsonResult(EMPTY, origin);
				break;
			}
			const page = Array.isArray(albumsData?.data) ? albumsData.data : [];
			list.push(...page);
			if (page.length < ALBUMS_PAGE_SIZE) break; // short page → discography exhausted
		}
		const result: DeezerArtistAlbumsResult = {
			data: list.map(reshapeAlbum).filter((a): a is DeezerArtistAlbum => a !== null)
		};

		if (cache) {
			// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
			await cache.put(
				cacheReq,
				new Response(JSON.stringify(result), {
					status: 200,
					headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
				})
			);
		}
		return jsonResult(result, origin, TTL);
	} catch {
		// Upstream error / malformed JSON / non-ok-throw / timeout → best-effort empty (NO cache
		// write). NEVER forwards the upstream status/body (T-23-18).
		return jsonResult(EMPTY, origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
