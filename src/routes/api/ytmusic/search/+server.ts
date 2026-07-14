// YouTube Music search edge route (Plan 27-02, YT-SEARCH-01).
//
// Thin forwarder mirroring /api/audius/search: the InnerTube WEB_REMIX search POST happens EDGE-side
// (public key + client context + songs filter kept off the client bundle) and the raw InnerTube JSON
// is passed through for the client adapter (src/lib/sources/ytmusic.ts) to parse. Own-origin, CORS
// via corsHeaders + the hooks.server.ts seam, OPTIONS 204 preflight, edge-cacheable.
//
// SECURITY (threats T-27-02-01/02/04): `q` is placed ONLY into the FIXED SEARCH_URL request body —
// never used to build an arbitrary upstream host/path (POST-to-fixed-URL, no open relay). The
// WEB_REMIX key lives only in SEARCH_URL (server -> upstream); it is NEVER echoed into a response
// body. CORS is allowlisted (never '*').
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { innerTubePost, SEARCH_URL, SONGS_FILTER, WEB_REMIX_CONTEXT } from '$lib/proxy/ytmusic';

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
		// InnerTube POST is fixed-URL; `q` goes only into the body (open-relay guard T-27-02-01).
		const body = await innerTubePost(SEARCH_URL, {
			context: WEB_REMIX_CONTEXT,
			query: q,
			params: SONGS_FILTER
		});
		if (cache) {
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
		// Upstream error → empty (shelf-shaped) body, NO cache write so the next retry can succeed.
		return jsonPassthrough(EMPTY_SEARCH_ENVELOPE, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
