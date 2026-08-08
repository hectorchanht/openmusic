// Deezer cover/search edge proxy (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for the home discovery tiles. This route mirrors
// the /api/lastfm/discovery posture VERBATIM (own-origin CORS, OPTIONS 204 preflight,
// caches.default edge cache keyed by the OWN-ORIGIN Request, fetchWithRetry + native
// AbortSignal.timeout, a safeImageUrl host allow-list) — but carries NO secret: Deezer's
// public search needs no key, so there is NO env/secret read and NO proxy-types.ts Env
// change.
//
// The upstream call itself (URL building, fetch+parse, reshape, the *.dzcdn.net image
// allow-list, the TTL) now lives in $lib/proxy/deezer-cover so /api/og can share ONE
// implementation (OG-EP-03) — a `+server.ts` may only export HTTP verbs, so a shared helper
// cannot live here (`svelte-server-endpoint-only-verb-exports`). What STAYS here is
// route-specific: CORS/response shaping, the ?q/?limit parsing, and cache orchestration. The
// LIVE Deezer probe facts and the reshape rationale moved with the code.
//
// COVERS/search SCOPE ONLY: the upstream parse + reshape is funnelled through a single
// reshapeDeezerSearch() so the proxy can be EXTENDED later for charts/album/artist-info (tasks
// 3b/3c) WITHOUT restructuring — but only the search → { cover, artistPicture } path ships now.
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { fetchDeezerCover, DEEZER_COVER_TTL } from '$lib/proxy/deezer-cover';
import type { DeezerCover } from '$lib/proxy/deezer-cover';

// edgeCache() (caches.default narrowing + `typeof caches` dev guard) is shared from
// $lib/proxy/edge-cache (quick-260713-mqv). Cache key stays the own-origin Request below.

function jsonResult(result: DeezerCover, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(result satisfies DeezerCover), { status: 200, headers });
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	// No secret/env read: Deezer public search is keyless. There is intentionally NO
	// platform.env access here (T-wv8-03 — nothing to leak).
	const q = (url.searchParams.get('q') ?? '').trim();
	// Empty/missing q → empty result with NO upstream fetch (T-wv8-01 short-circuit).
	if (!q) return jsonResult({ cover: null, artistPicture: null }, origin);

	// jau: optional ?limit param (clamped [1,25]). Default 1 = backward-compat cover mode;
	// >1 surfaces `results` for dedupe/recommendation use without breaking existing callers.
	const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 1));

	// Cache key = the OWN-ORIGIN request (NEVER the upstream api.deezer.com URL — T-wv8-06).
	// Guarded for the dev runtime (`vite dev` has no Cache API) so local dev still hits live.
	const cache = edgeCache();
	const cacheReq = new Request(url.toString());

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-apply CORS for THIS request's origin (WR-01). The cached entry stores a
			// CORS-FREE body, so a cross-origin (preview vs prod) hit never receives a prior
			// requester's Access-Control-Allow-Origin. `results` (jau) is preserved when present.
			const cached = (await hit.json()) as DeezerCover;
			return jsonResult(
				{
					cover: cached.cover ?? null,
					artistPicture: cached.artistPicture ?? null,
					...(cached.results ? { results: cached.results } : {})
				},
				origin,
				DEEZER_COVER_TTL
			);
		}
	}

	// Same 8000 ms native timeout + retries=2 as before the OG-EP-03 extraction; `'xl'` keeps
	// the legacy cover_xl-first order for the client tiles (/api/og passes `'big'` instead).
	const result = await fetchDeezerCover(q, AbortSignal.timeout(8000), 2, 'xl', limit);
	// null = upstream error / malformed JSON / abort → best-effort empty (NO cache write, so the
	// next request retries instead of pinning the fault for the whole TTL).
	if (!result) return jsonResult({ cover: null, artistPicture: null }, origin);

	if (cache) {
		// Cache a CORS-FREE copy (origin re-applied per request on a hit, WR-01).
		const cached = new Response(JSON.stringify(result satisfies DeezerCover), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				'Cache-Control': `public, max-age=${DEEZER_COVER_TTL}`
			}
		});
		await cache.put(cacheReq, cached);
	}
	return jsonResult(result, origin, DEEZER_COVER_TTL);
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
