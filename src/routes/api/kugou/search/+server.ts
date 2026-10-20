// Kugou search edge proxy (quick-261020-kugo; k3y: caches.default at 1h).
//
// Calls `songsearch.kugou.com/song_search_v2` (Kugou's public web search — the same
// endpoint every open-source client uses: MakcRe/KuGouMusicApi, guohuiyuan/music-lib,
// CharlesPikachu/musicdl). Verified live from this network 2026-10-20: HTTPS works,
// rows carry per-quality file hashes (FileHash 128k / HQFileHash 320k / SQFileHash FLAC /
// ResFileHash hi-res) that the /api/kugou/url route later exchanges for play URLs.
// Passthrough only: the client adapter does the reshape + <em> stripping (mirrors the
// fivesing search route's division of labour). No secrets, no signed state.
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const KG_SEARCH = 'https://songsearch.kugou.com/song_search_v2';
const TTL = 3600; // 1h — catalogue search results are stable enough (fivesing idiom)
const MOBILE_UA =
	'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	if (!keyword) return jsonPassthrough({ status: 1, data: { lists: [] } }, origin);

	// Bound + clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));
	const pagesize = Math.min(50, Math.max(1, Number(url.searchParams.get('pagesize')) || 20));

	// The parameter set the reference clients send (music-lib kugou Search): WebFilter
	// platform, correction on, no privilege pre-filter (paid rows are KEPT — the adapter's
	// resolve() discovers paywalls per-song and cross-source fallback covers them).
	const upstream =
		`${KG_SEARCH}?keyword=${encodeURIComponent(keyword)}` +
		`&page=${page}&pagesize=${pagesize}` +
		'&userid=-1&clientver=&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0';

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
		const res = await fetchWithRetry(
			upstream,
			{ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': MOBILE_UA } },
			2
		);
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
		// Upstream error → empty list (NO cache write — next retry can succeed).
		return jsonPassthrough({ status: 1, data: { lists: [] } }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
