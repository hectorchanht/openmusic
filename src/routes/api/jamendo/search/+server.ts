// Jamendo search edge proxy (quick-260607-ixw; k3y: caches.default at 1h).
//
// Calls api.jamendo.com/v3.0/tracks/?client_id=…&search=…&audioformat=mp32&limit=N&offset=M.
// The client_id is PUBLIC (Jamendo sends it on every API URL by design) but lives in
// wrangler.jsonc `vars.JAMENDO_CLIENT_ID` so it can be rotated/scoped without a code edit.
// Absent env → returns an empty `{ results: [] }` so the adapter sees no hits (graceful
// degradation; matches the LASTFM_KEY absent-state idiom).
//
// `audioformat=mp32` returns a direct progressive mp3 in the `audio` field — plays in
// HTML5 <audio> with no MSE, no DASH, no DRM. The Jamendo client_secret Jamendo issues is
// ONLY needed for OAuth flows we don't implement; it never reaches this route.
//
// k3y: edge cache via Cloudflare's caches.default. Mirrors the wv8 deezer/search posture —
// CORS-free cached body, own-origin Request as cache key, origin re-applied per request on a hit.
// TTL 1h: Jamendo's catalogue moves slowly; an hourly refresh is plenty.
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const JM_BASE = 'https://api.jamendo.com/v3.0/tracks/';
const TTL = 3600; // 1h — search metadata is stable enough

// edgeCache() shared from $lib/proxy/edge-cache (quick-260713-mqv).

function jsonPassthrough(body: unknown, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body), { status: 200, headers });
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const env = platform?.env as Env | undefined;
	const clientId = env?.JAMENDO_CLIENT_ID;

	const search = (url.searchParams.get('search') ?? '').trim();
	if (!search) return jsonPassthrough({ headers: { status: 'success', code: 0 }, results: [] }, origin);

	// Absent client_id → empty result (NOT 401/500 — the adapter records this as "0 hits
	// for jamendo" which is identical to a legitimate no-match, matching the LASTFM_KEY
	// absent-state posture).
	if (!clientId) return jsonPassthrough({ headers: { status: 'success', code: 0 }, results: [] }, origin);

	// Clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
	const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get('offset')) || 0));

	// Upstream is passthrough. encodeURIComponent on `search` is REDUNDANT (we just trimmed
	// it from a URLSearchParams; it's already raw text) but explicit here is safer than
	// implicit. `audioformat=mp32` is the required progressive-mp3 toggle. `include=` left
	// empty (musicinfo not surfaced in v1 — saves payload weight on every search).
	const upstream =
		`${JM_BASE}?client_id=${encodeURIComponent(clientId)}` +
		`&search=${encodeURIComponent(search)}` +
		`&audioformat=mp32&limit=${limit}&offset=${offset}`;

	// k3y: edge cache key = own-origin Request (never the upstream URL — the client_id must
	// never reach the cache key surface). Guarded for the dev runtime (no Cache API).
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
		// Upstream error → empty (NO cache write so the next retry can succeed).
		return jsonPassthrough({ headers: { status: 'success', code: 0 }, results: [] }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
