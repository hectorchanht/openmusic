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
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';

const AUDIUS_SEARCH = 'https://api.audius.co/v1/tracks/search';
const APP_NAME = 'musicsquare';
const TTL = 600; // 10min

interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}
interface EdgeCacheStorage {
	default?: EdgeCache;
}
function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}

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
	const query = (url.searchParams.get('query') ?? '').trim();
	if (!query) return jsonPassthrough({ data: [] }, origin);

	// Upstream: passthrough-only. `query` is encodeURIComponent'd into the fixed template
	// (no command construction); `app_name` appended server-side. No arbitrary client params.
	const upstream = `${AUDIUS_SEARCH}?query=${encodeURIComponent(query)}&app_name=${APP_NAME}`;

	// Edge cache key = own-origin Request (NOT the upstream URL). Guarded for the dev runtime.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			const cached = await hit.json();
			return jsonPassthrough(cached, origin, TTL);
		}
	}

	try {
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const body = await res.json();
		if (cache) {
			const cached = new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(body, origin, TTL);
	} catch {
		// Upstream error → empty list (NO cache write so the next retry can succeed).
		return jsonPassthrough({ data: [] }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
