// YouTube video DESCRIPTION route (quick-261024-about) — feeds the Now Playing "About" tab.
//
// GET /api/ytmusic/description/:videoId → { description } — the MV's description text.
// Hector's call: the description is a first-class citizen (its own tab, always shown),
// not merely a lyrics fallback — though /api/ytmusic/lyrics still uses it as one.
//
// quick-261029-meta1: the resolve is callPlayerForMetadata(..., 'description') — the
// gated VISIONOS resolve FIRST, then alternate InnerTube clients (description needs
// no streamable format, so WEB/WEB_REMIX/ANDROID are valid metadata sources), then
// one more gated round. The old sole-VISIONOS dependency 503'd the whole tab whenever
// a PoP's gate was hot (Hector's layNDqkZQnQ, 2026-10-29 — healthy on other PoPs).
//
// Cache: a definitive answer (playable player; description possibly empty — or a
// non-empty description from any client) caches 7 days per PoP. A GATED resolve
// answers 503 with NO cache write and Cache-Control: no-store — transient, never a
// verdict (the lyr2 lesson). CORS mirrors the sibling routes.
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { callPlayerForMetadata, extractDescription, playabilityInfo } from '$lib/proxy/ytmusic';

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

	// quick-261029-meta1 (was about2's extra gated round, now inside the shared
	// resolver): VISIONOS gate rounds + alternate metadata clients + a final round.
	const meta = await callPlayerForMetadata(videoId, 'description');
	const json = meta.json;
	if (!meta.definitive) {
		const info = playabilityInfo(json);
		const headers: Record<string, string> = { ...corsHeaders(origin), 'Cache-Control': 'no-store' };
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
