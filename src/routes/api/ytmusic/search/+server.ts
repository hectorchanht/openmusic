// YouTube Music search edge route (Plan 27-02, YT-SEARCH-01).
//
// Thin forwarder mirroring /api/audius/search: the InnerTube WEB_REMIX search POSTs happen EDGE-side
// (public key + client context + Songs/Videos filters kept off the client bundle) and the raw JSON is
// passed through for the client adapter (src/lib/sources/ytmusic.ts) to parse. The route issues the
// Songs AND Videos filters in parallel and returns a merged `{ ytmusicMerged: [songsJson, videosJson] }`
// envelope so video-only uploads surface too (quick-260715-jdj). Own-origin, CORS via corsHeaders +
// the hooks.server.ts seam, OPTIONS 204 preflight, edge-cacheable.
//
// SECURITY (threats T-27-02-01/02/04): `q` is placed ONLY into the FIXED SEARCH_URL request body —
// never used to build an arbitrary upstream host/path (POST-to-fixed-URL, no open relay). The
// WEB_REMIX key lives only in SEARCH_URL (server -> upstream); it is NEVER echoed into a response
// body. CORS is allowlisted (never '*').
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { searchInnerTube, SONGS_FILTER, VIDEOS_FILTER } from '$lib/proxy/ytmusic';

const TTL = 600; // 10min — search ranking is stable enough to avoid hammering upstream on repeats.

// An empty-but-VALID InnerTube search envelope (a shelf with zero rows). Returned for an empty query
// and on an upstream error so the client adapter's parse yields [] instead of tripping its
// shelf-absent contract-drift guard (src/lib/sources/ytmusic.ts parseSearchEnvelope).
const EMPTY_SEARCH_ENVELOPE = {
	contents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [] } }] } }
};

function jsonPassthrough(body: unknown, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body), { status: 200, headers });
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty query → empty (shelf-shaped) body, NO upstream call.
	if (!q) return jsonPassthrough(EMPTY_SEARCH_ENVELOPE, origin);

	// Edge cache key = own-origin Request (NEVER the key-bearing upstream URL). Null under vite dev.
	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonPassthrough(await hit.json(), origin, TTL);
	}

	try {
		// quick-260715-jdj: run the Songs + Videos filters in PARALLEL and merge, so video-only
		// uploads (community/MV tracks that never appear in the Songs catalog) surface alongside the
		// official catalog. Both are fixed-URL POSTs; `q` goes only into the body (open-relay guard
		// T-27-02-01). Promise.allSettled so one failing filter never sinks the other shelf.
		const [songs, videos] = await Promise.allSettled([
			searchInnerTube(q, SONGS_FILTER),
			searchInnerTube(q, VIDEOS_FILTER)
		]);

		// SONGS FIRST so the official-catalog variant of a track ranks above (and wins the dedupe
		// against) its video variant in the client parse (parseSearchEnvelope walks shelves in order).
		const merged: unknown[] = [];
		if (songs.status === 'fulfilled') merged.push(songs.value);
		if (videos.status === 'fulfilled') merged.push(videos.value);

		// BOTH filters failed → empty (shelf-shaped) body, NO cache write so the next retry can
		// succeed. The client sees a shelf and returns [] instead of tripping its contract-drift guard.
		if (!merged.length) return jsonPassthrough(EMPTY_SEARCH_ENVELOPE, origin);

		// One merged envelope; the client's recursive walk collects every wrapped shelf's rows.
		const body = { ytmusicMerged: merged };

		// Only cache a FULL merge (both shelves present) — a partial (one filter failed) must not be
		// pinned for the whole TTL; leave it uncached so a retry can fetch the missing shelf.
		if (cache && merged.length === 2) {
			await cache.put(
				cacheReq,
				new Response(JSON.stringify(body), {
					status: 200,
					headers: {
						'content-type': 'application/json',
						'Cache-Control': `public, max-age=${TTL}`
					}
				})
			);
		}
		return jsonPassthrough(body, origin, TTL);
	} catch {
		// Defensive: any unexpected throw → empty (shelf-shaped) body, NO cache write.
		return jsonPassthrough(EMPTY_SEARCH_ENVELOPE, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
