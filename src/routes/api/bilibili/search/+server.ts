// Bilibili search edge proxy (quick-261020-bili; k3y: caches.default at 1h).
//
// WBI-signed `x/web-interface/wbi/search/type` (search_type=video) — the signing
// lives in $lib/proxy/bilibili (mixin key from nav, memoized per isolate). Verified
// live 2026-10-20: code 0 anonymously, no cookie needed. Passthrough only: the
// client adapter reshapes rows and strips the <em> keyword highlights.
// No typename hard-filter (see the adapter header — real song uploads hide under
// non-music partitions like 日常).
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { biliSearch } from '$lib/proxy/bilibili';

const TTL = 3600; // 1h (fivesing/jamendo search-route idiom)

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

const EMPTY = { code: 0, data: { result: [] } };

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	if (!keyword) return jsonPassthrough(EMPTY, origin);

	// Bound + clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));
	const pagesize = Math.min(50, Math.max(1, Number(url.searchParams.get('pagesize')) || 20));

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
		const body = await biliSearch(keyword, page, pagesize);
		if (cache) {
			const cached = new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(body, origin, TTL);
	} catch {
		// Upstream/signing failure → empty result (NO cache write — next retry can succeed).
		return jsonPassthrough(EMPTY, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
