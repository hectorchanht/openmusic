// Last.fm similar-artists proxy (quick-260606-5ug).
//
// Dedicated route (NOT the /api/[source]/[...path] catch-all): reads the OPTIONAL
// LASTFM_KEY from platform.env, calls Last.fm artist.getSimilar, and returns a clean
// { artists: string[] } list. The key is injected into the upstream URL on the edge
// and NEVER reaches the client (threat T-5ug-01, parity with JOOX_TOKEN / T-01-04).
//
// Unlike the JOOX proxy, an ABSENT key is a SUPPORTED state (T-5ug-03 fallback): with
// no key — or on any upstream error / malformed JSON — we return 200 { artists: [] }
// so the service layer falls back to same-artist search and playback is never blocked.
// CORS is scoped to the own origin via corsHeaders (never `*`).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import type { Env } from '$lib/proxy/proxy-types';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

// artist.getSimilar's recommendation graph is near-static → cache the success path 24h
// (parity with lastfm/discovery artist.getTopAlbums 86400). quick-260713-mqv.
const SIMILAR_TTL = 86400;

// ttl is added ONLY on a cacheable success (Cache-Control emitted only when ttl != null) — the
// !key / empty-artist / catch EMPTY returns pass no ttl so they carry no Cache-Control and are
// never written to caches.default (quick-260713-mqv, copied from lastfm/discovery jsonList).
function jsonArtists(artists: string[], origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify({ artists }), { status: 200, headers });
}

/** Clamp the client-supplied limit to a small positive integer (T-5ug-02). */
function clampLimit(raw: string | null): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
	return Math.min(n, MAX_LIMIT);
}

export const GET: RequestHandler = async ({ url, platform, request }) => {
	const origin = request.headers.get('origin');

	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;
	const key = env?.LASTFM_KEY;

	// No key configured → supported fallback state. Do NOT throw (unlike JOOX), and
	// do NOT fetch an api_key=undefined upstream URL.
	if (!key) return jsonArtists([], origin);

	const artist = url.searchParams.get('artist') ?? '';
	if (!artist.trim()) return jsonArtists([], origin);
	const limit = clampLimit(url.searchParams.get('limit'));

	// Cache key = the OWN-ORIGIN request (NEVER the LASTFM_KEY-bearing upstream URL — T-5ug-01
	// parity; keep the key out of the cache key). Guarded for `vite dev` (no Cache API) so local
	// dev still hits live upstream (quick-260713-mqv).
	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01): the stored body is CORS-FREE, so a
			// cross-origin (preview vs prod) hit never receives a prior requester's ACAO header.
			const cached = (await hit.json()) as { artists?: string[] };
			return jsonArtists(cached.artists ?? [], origin, SIMILAR_TTL);
		}
	}

	// artist is URL-encoded (T-5ug-02 — thin passthrough, no command construction).
	const upstream =
		`${LASTFM_ENDPOINT}?method=artist.getsimilar` +
		`&artist=${encodeURIComponent(artist)}` +
		`&api_key=${encodeURIComponent(key)}` +
		`&format=json&limit=${limit}`;

	try {
		// Bounded retry + native timeout (T-5ug-03). NEVER log the key or upstream URL (V7 / T-5ug-01).
		const res = await fetchWithRetry(upstream, { signal: AbortSignal.timeout(8000) }, 2);
		const data = (await res.json()) as {
			similarartists?: { artist?: Array<{ name?: string }> };
		};
		const raw = data?.similarartists?.artist ?? [];
		const seen = new Set<string>();
		const artists: string[] = [];
		for (const a of raw) {
			const name = a?.name?.trim();
			if (!name || seen.has(name)) continue;
			seen.add(name);
			artists.push(name);
			if (artists.length >= limit) break;
		}
		if (cache) {
			// Cache a CORS-FREE copy of the success (origin re-applied per request on a hit, WR-01).
			// quick-260713-mqv.
			await cache.put(
				cacheReq,
				new Response(JSON.stringify({ artists }), {
					status: 200,
					headers: {
						'content-type': 'application/json',
						'Cache-Control': `public, max-age=${SIMILAR_TTL}`
					}
				})
			);
		}
		return jsonArtists(artists, origin, SIMILAR_TTL);
	} catch {
		// Upstream error / malformed JSON → best-effort empty; client falls back. NO cache write.
		return jsonArtists([], origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
