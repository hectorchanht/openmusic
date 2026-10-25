// YouTube video DESCRIPTION route (quick-261024-about) — feeds the Now Playing "About" tab.
//
// GET /api/ytmusic/description/:videoId → { description } — the MV's description text from
// the SAME gated VISIONOS player resolve the media routes use (shared callPlayerGated).
// Hector's call: the description is a first-class citizen (its own tab, always shown),
// not merely a lyrics fallback — though /api/ytmusic/lyrics still uses it as one.
//
// Cache: a definitive answer (playable player; description possibly empty) caches 7 days
// per PoP. A GATED resolve answers 503 with NO cache write — transient, never a verdict
// (the lyr2 lesson). CORS mirrors the sibling routes.
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { callPlayerGated, isPlayable, extractDescription, playabilityInfo } from '$lib/proxy/ytmusic';

const TTL = 7 * 86400; // descriptions are stable

export const GET: RequestHandler = async ({ params, request, url }) => {
	const origin = request.headers.get('origin');
	const videoId = (params.videoId ?? '').trim();
	if (!videoId) return new Response('missing videoId', { status: 400, headers: corsHeaders(origin) });

	const cache = edgeCache();
	const cacheReq = ownOriginCacheKey(url);
	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) {
			// Re-wrap with THIS request's CORS headers (the stored copy is CORS-free).
			return new Response(JSON.stringify(await hit.json()), {
				status: 200,
				headers: { ...corsHeaders(origin), 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
		}
	}

	const json = await callPlayerGated(videoId);
	if (!isPlayable(json)) {
		const info = playabilityInfo(json);
		const headers: Record<string, string> = { ...corsHeaders(origin) };
		if (info.status) headers['x-ytmusic-playability'] = info.status;
		if (info.reason) headers['x-ytmusic-reason'] = info.reason;
		return new Response(JSON.stringify({}), { status: 503, headers: { ...headers, 'content-type': 'application/json' } });
	}

	const body = JSON.stringify({ description: extractDescription(json) });
	const res = new Response(body, {
		status: 200,
		headers: {
			...corsHeaders(origin),
			'content-type': 'application/json',
			'Cache-Control': `public, max-age=${TTL}`
		}
	});
	if (cache) {
		// Store a CORS-free copy (the lyrics route's posture); the live response above
		// already carries this request's CORS headers.
		const stored = new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
		});
		await cache.put(cacheReq, stored).catch(() => {});
	}
	return res;
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
