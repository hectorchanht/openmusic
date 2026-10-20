// Migu search edge proxy (quick-261020-migu; k3y: caches.default at 1h).
//
// Calls `pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do` — Migu's legacy
// public search (guohuiyuan/music-lib migu `Search`, CharlesPikachu/musicdl migu).
// Verified live from this network 2026-10-20: HTTPS answers, rows carry singers,
// albums, cover imgItems, a lyricUrl, and the rate-format table the adapter's
// VIP filter + quality pick run on (see src/lib/sources/migu.ts). Passthrough only —
// reshaping lives in the client adapter (fivesing-route division of labour).
import type { RequestHandler } from './$types';
import { fetchWithRetry, corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';

const MG_SEARCH = 'https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do';
const TTL = 3600; // 1h — catalogue search results are stable enough (fivesing idiom)
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
// The searchSwitch the reference clients send: songs only, bestShow on.
const SEARCH_SWITCH = '{"song":1,"album":0,"singer":0,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":1}';

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

const EMPTY = { songResultData: { result: [] } };

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const keyword = (url.searchParams.get('keyword') ?? '').trim();
	if (!keyword) return jsonPassthrough(EMPTY, origin);

	// Bound + clamp pagination so a hostile querystring can't fan out unbounded fetches.
	const page = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));
	const pagesize = Math.min(50, Math.max(1, Number(url.searchParams.get('pagesize')) || 20));

	const upstream =
		`${MG_SEARCH}?ua=Android_migu&version=5.0.1&text=${encodeURIComponent(keyword)}` +
		`&pageNo=${page}&pageSize=${pagesize}&searchSwitch=${encodeURIComponent(SEARCH_SWITCH)}`;

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
			{
				signal: AbortSignal.timeout(8000),
				headers: { 'User-Agent': ANDROID_UA, Referer: 'http://music.migu.cn/' }
			},
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
		return jsonPassthrough(EMPTY, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
