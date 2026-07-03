// Same-origin metadata proxy (DATA-02).
//
// One catch-all route fronts all four sources. It validates params.source against the
// PROXIES registry (404 unknown — threat T-01-01 / Security V5), builds the real
// upstream URL via the per-source ProxyAdapter (JOOX injects its token from
// platform.env here, never on the client — T-01-04), fetches with a native timeout +
// bounded retry, and forwards the upstream body with CORS scoped to the own origin
// (never `*` — T-01-02).
//
// CACHING (quick-260704-2os, CONCERNS perf #1): the `search` segment now edge-caches
// 200-OK responses in caches.default (short 300s TTL, keyed by the OWN-ORIGIN request,
// CORS re-applied per request on a hit — WR-01). `url`/`detail`/`lrc` remain the
// UNCHANGED streaming passthrough (no cache read/write) so no expiring playable-audio
// or lyric URL is ever frozen (the stale-URL bug class — T-2os-03).
import type { RequestHandler } from './$types';
import { PROXIES } from '$lib/proxy/proxy-registry';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import type { Env } from '$lib/proxy/proxy-types';
import type { SourceId } from '$lib/sources/types';

// Search results are volatile (unlike Deezer cover art at 86400s), so a SHORT TTL keeps
// results reasonably fresh AND means any briefly-bad cache entry self-heals within minutes;
// 300s still absorbs the keystroke-hot burst + repeat-search traffic that is the bulk of the
// win. This is intentionally NOT the 86400 the Deezer cover route uses.
const SEARCH_TTL = 300;

function isKnownSource(source: string): source is SourceId {
	return Object.prototype.hasOwnProperty.call(PROXIES, source);
}

// The Cloudflare Cache API extends the standard CacheStorage with a `default` cache
// (caches.default). The DOM lib's CacheStorage does NOT declare `default` and shadows
// @cloudflare/workers-types' global, so we narrow through a minimal local interface for the
// subset we use. Absent in the dev runtime (`vite dev`) — guarded with `typeof caches`.
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

export const GET: RequestHandler = async ({ params, url, platform, request }) => {
	const origin = request.headers.get('origin');

	if (!isKnownSource(params.source)) {
		return new Response('unknown source', { status: 404, headers: corsHeaders(origin) });
	}
	const proxy = PROXIES[params.source];
	// Sources with DEDICATED routes (e.g. fivesing) are absent from PROXIES — the catch-all
	// shouldn't match them anyway, but defend in depth (hvu).
	if (!proxy) {
		return new Response('source not served by catch-all', { status: 404, headers: corsHeaders(origin) });
	}

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;

	let upstream: string;
	try {
		upstream = proxy.buildUrl(params.path ?? '', url.searchParams, env);
	} catch (err) {
		return new Response(`bad request: ${err instanceof Error ? err.message : 'invalid path'}`, {
			status: 400,
			headers: corsHeaders(origin)
		});
	}

	// Normalize the path exactly as the adapters do so the route agrees with them on what
	// "search" is. `search` is the ONLY cacheable segment across all four sources (netease/
	// qq/kuwo/joox); `url`/`detail`/`lrc` (and anything else) always take the passthrough.
	const type = (params.path || 'search').replace(/^\/+|\/+$/g, '');
	const cacheable = type === 'search';

	// Cache key = the OWN-ORIGIN request (NEVER the upstream URL as key — T-2os-02 / T-wv8-06
	// parity; the JOOX-token-bearing upstream URL must never leak into a cache key). Guarded for
	// the dev runtime (`vite dev` has no Cache API) so local dev still hits live upstream.
	const cache = cacheable ? edgeCache() : null;
	const cacheReq = cacheable ? new Request(url.toString()) : null;

	if (cache && cacheReq) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// The stored entry is CORS-FREE — re-apply corsHeaders(origin) for THIS request so a
			// cross-origin (preview vs prod) hit never receives a prior requester's
			// Access-Control-Allow-Origin (WR-01). Content-type is stored on the cached Response.
			const body = await hit.text();
			return new Response(body, {
				status: 200,
				headers: {
					...corsHeaders(origin),
					'content-type': hit.headers.get('content-type') ?? 'application/json',
					'Cache-Control': `public, max-age=${SEARCH_TTL}`
				}
			});
		}
	}

	const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);

	if (cacheable && res.status === 200 && cache && cacheReq) {
		// Search bodies are small JSON — buffer once, use the same buffer for both the cache
		// put and the response (a Response body is single-use). NEVER cache non-200 (T-2os-04).
		const buf = await res.arrayBuffer();
		const contentType = res.headers.get('content-type') ?? 'application/json';
		// Store a CORS-FREE copy (origin re-applied per request on a hit — WR-01).
		await cache.put(
			cacheReq,
			new Response(buf, {
				status: 200,
				headers: { 'content-type': contentType, 'Cache-Control': `public, max-age=${SEARCH_TTL}` }
			})
		);
		return new Response(buf, {
			status: 200,
			headers: {
				...corsHeaders(origin),
				'content-type': contentType,
				'Cache-Control': `public, max-age=${SEARCH_TTL}`
			}
		});
	}

	// Passthrough: forward body unchanged; add only CORS + content-type. This is the path
	// url/detail/lrc always take (and search on a non-200 or no-cache runtime), preserving
	// audio-URL freshness and lyric streaming — no Cache-Control header here (matches today).
	return new Response(res.body, {
		status: res.status,
		headers: {
			...corsHeaders(origin),
			'content-type': res.headers.get('content-type') ?? 'application/json'
		}
	});
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
