// Deezer related-artists edge proxy (quick-260607-jau). Used by similar.ts as a fallback
// for artist recommendations when LASTFM_KEY is absent or Last.fm returned no similars.
//
// Two upstream calls:
//   1. search/artist?q=<name>&limit=1 → first hit's artist.id
//   2. artist/{id}/related?limit=<N>  → related artists list
//
// Output shape mirrors /api/similar's `{ artists: string[] }` (a clean name list) so the
// client just plugs into the same downstream `searchAll(artist, …) per-name` fan-out that
// similar.ts already runs. NO secret, NO env read (Deezer public API, same posture as the
// existing /api/deezer/search route).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { pickBestArtistId, DEEZER_ARTIST_SEARCH_LIMIT } from '$lib/proxy/deezer-pick';

const DEEZER_ARTIST_SEARCH = 'https://api.deezer.com/search/artist';
const DEEZER_ARTIST_RELATED = 'https://api.deezer.com/artist';

// Related artists for a given name change rarely → cache 24h, same as the cover proxy.
const TTL = 86400;

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

interface RelatedResult {
	artists: string[];
}

function jsonResult(body: RelatedResult, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body satisfies RelatedResult), { status: 200, headers });
}

// Upstream shape — we only read the fields we need; all optional (untrusted JSON).
interface DzArtistHit {
	id?: number;
	name?: string;
	/** Popularity, read by pickBestArtistId to skip namesake shell profiles. */
	nb_fan?: number;
}
interface DzSearchResp {
	data?: DzArtistHit[];
}
interface DzRelatedResp {
	data?: { name?: string }[];
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const artist = (url.searchParams.get('artist') ?? '').trim();
	if (!artist) return jsonResult({ artists: [] }, origin);

	const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 8));

	// Cache key = own-origin request (T-wv8-06 — never the upstream URL).
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = (await hit.json()) as RelatedResult;
			return jsonResult({ artists: cached.artists ?? [] }, origin, TTL);
		}
	}

	try {
		// 1. Resolve artist NAME → artist.id via search/artist.
		// debug/upnext-diverse-fallback-kuwo-dead: ask for SEVERAL hits and pick, instead of
		// trusting data[0]. Deezer's artist search does not rank by popularity, so `limit=1`
		// returned empty namesake shells (q=Drake → 111 fans, real Drake is 24M; those shells
		// have zero related artists, which is what made this fallback permanently dry).
		const searchUrl = `${DEEZER_ARTIST_SEARCH}?q=${encodeURIComponent(artist)}&limit=${DEEZER_ARTIST_SEARCH_LIMIT}`;
		const searchRes = await fetchWithRetry(searchUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const searchData = (await searchRes.json()) as DzSearchResp;
		const id = pickBestArtistId(searchData?.data ?? [], artist);
		if (id === null) {
			return jsonResult({ artists: [] }, origin);
		}
		// 2. Fetch related artists by id.
		const relatedUrl = `${DEEZER_ARTIST_RELATED}/${encodeURIComponent(String(id))}/related?limit=${limit}`;
		const relRes = await fetchWithRetry(relatedUrl, { signal: AbortSignal.timeout(8000) }, 2);
		const relData = (await relRes.json()) as DzRelatedResp;
		const arr = Array.isArray(relData?.data) ? relData!.data! : [];
		const artists = arr
			.map((it) => (it.name ?? '').trim())
			.filter((s): s is string => !!s)
			.slice(0, limit);
		const out: RelatedResult = { artists };
		if (cache) {
			const cached = new Response(JSON.stringify(out satisfies RelatedResult), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonResult(out, origin, TTL);
	} catch {
		return jsonResult({ artists: [] }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
