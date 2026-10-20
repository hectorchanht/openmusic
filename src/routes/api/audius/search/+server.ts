// Audius search edge proxy (quick-260616-0zn; caches.default at 10min).
//
// Calls api.audius.co/v1/tracks/search?query=…&app_name=musicsquare. Audius is fully
// public — `app_name` is a free-text identifier, NOT a secret — but it is appended
// SERVER-side here so the client adapter never has to carry it (tidiness + matches the
// "no arbitrary client params forwarded" posture of the other dedicated routes).
//
// Passthrough JSON only: the adapter does the row → Track reshape client-side. No secrets,
// no signed state — mirrors the fivesing/jamendo posture (own-origin CORS, OPTIONS 204
// preflight, native AbortSignal.timeout, fetchWithRetry).
//
// Edge cache via Cloudflare's caches.default at TTL 10min: best-match search ranking is
// stable enough that a 10-minute window avoids hammering upstream on repeat searches.
import type { RequestHandler } from './$types';
import { fetchWithRetry, jsonResponse, corsPreflight } from '$lib/proxy/http';
import { cachedUpstreamJson } from '$lib/proxy/edge-cache';

const AUDIUS_SEARCH = 'https://api.audius.co/v1/tracks/search';
const APP_NAME = 'musicsquare';
const TTL = 600; // 10min

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const query = (url.searchParams.get('query') ?? '').trim();
	if (!query) return jsonPassthrough({ data: [] }, origin);

	// Upstream: passthrough-only. `query` is encodeURIComponent'd into the fixed template
	// (no command construction); `app_name` appended server-side. No arbitrary client params.
	const upstream = `${AUDIUS_SEARCH}?query=${encodeURIComponent(query)}&app_name=${APP_NAME}`;

	// quick-261020-batch2: the edge-cache → upstream → cache-put → passthrough spine moved to
	// cachedUpstreamJson ($lib/proxy/edge-cache); the route keeps only its param guard + upstream.
	return cachedUpstreamJson({
		origin,
		url,
		ttl: TTL,
		empty: { data: [] },
		fetchUpstream: async () => {
			const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
			return res.json();
		}
	});
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
