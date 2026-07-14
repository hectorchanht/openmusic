// YouTube Music lyrics edge route (Plan 27-02, YT-LYRICS-01).
//
// Does the InnerTube next -> browse two-hop EDGE-side and returns plain { text, attribution } for a
// track's lyrics tab. Metadata endpoints are NOT bot-gated (spike 007), so no visitorData/auth —
// only the public WEB_REMIX key + client context, all edge-side. Own-origin, CORS via corsHeaders +
// the hooks.server.ts seam, OPTIONS 204, edge-cacheable.
//
// Degrades to {} (never a 500 to the client): a genuine no-lyrics track (cacheable) and an upstream
// error (NOT cached) both return {}. Timed/synced LRC is NOT available from YT — the app's existing
// crossSourceLyric(name, artist) fallback covers that, wired in Plan 27-04.
//
// SECURITY (threats T-27-02-01/02/04): `videoId` is placed ONLY into the FIXED NEXT_URL/BROWSE_URL
// request bodies (POST-to-fixed-URL, no open relay). The WEB_REMIX key lives only in those URLs
// (server -> upstream) and is never echoed to a response body. CORS allowlisted (never '*').
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import {
	innerTubePost,
	NEXT_URL,
	BROWSE_URL,
	WEB_REMIX_CONTEXT,
	findLyricsTab,
	extractLyrics
} from '$lib/proxy/ytmusic';

const TTL = 86400; // 1 day — lyrics are stable (also caches a genuine no-lyrics {}).

function jsonPassthrough(body: unknown, origin: string | null, ttl?: number): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body), { status: 200, headers });
}

function cacheEntry(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
	});
}

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const videoId = (url.searchParams.get('videoId') ?? '').trim();
	// Empty videoId → {}, NO upstream call.
	if (!videoId) return jsonPassthrough({}, origin);

	// Edge cache key = own-origin Request per videoId (NEVER the key-bearing upstream URL).
	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonPassthrough(await hit.json(), origin, TTL);
	}

	try {
		// Hop 1: next(videoId) -> find the Lyrics tab's browseId. videoId in the fixed-URL body only.
		const nextJson = await innerTubePost(NEXT_URL, {
			context: WEB_REMIX_CONTEXT,
			videoId,
			isAudioOnly: true
		});
		const { browseId } = findLyricsTab(nextJson);
		if (!browseId) {
			// Genuine no-lyrics track — a real answer, cacheable (no wasted browse hop next time).
			const empty = {};
			if (cache) await cache.put(cacheReq, cacheEntry(empty));
			return jsonPassthrough(empty, origin, TTL);
		}

		// Hop 2: browse(browseId) -> plain text + licensor attribution.
		const browseJson = await innerTubePost(BROWSE_URL, {
			context: WEB_REMIX_CONTEXT,
			browseId
		});
		const result = extractLyrics(browseJson); // { text, attribution }
		if (cache) await cache.put(cacheReq, cacheEntry(result));
		return jsonPassthrough(result, origin, TTL);
	} catch {
		// Upstream error → {} with NO cache write (never a 500 to the client; a retry can succeed).
		return jsonPassthrough({}, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
