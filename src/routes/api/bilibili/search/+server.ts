// Bilibili search edge proxy (quick-261020-bili; k3y: caches.default at 1h).
//
// WBI-signed `x/web-interface/wbi/search/type` (search_type=video) — the signing
// lives in $lib/proxy/bilibili (mixin key from nav, memoized per isolate). Verified
// live 2026-10-20: code 0 anonymously, no cookie needed. Passthrough only: the
// client adapter reshapes rows and strips the <em> keyword highlights.
// No typename hard-filter (see the adapter header — real song uploads hide under
// non-music partitions like 日常).
import type { RequestHandler } from './$types';
import { jsonResponse, corsPreflight } from '$lib/proxy/http';
import { cachedUpstreamJson } from '$lib/proxy/edge-cache';
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

	// quick-261020-batch2: the edge-cache → upstream → cache-put → passthrough spine moved to
	// cachedUpstreamJson ($lib/proxy/edge-cache). The WBI-signed fetch lives in the route's
	// biliSearch helper (not a plain fetchWithRetry).
	return cachedUpstreamJson({
		origin,
		url,
		ttl: TTL,
		empty: EMPTY,
		fetchUpstream: () => biliSearch(keyword, page, pagesize)
	});
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
