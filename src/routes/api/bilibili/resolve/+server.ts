// Bilibili resolve edge proxy (quick-261020-bili; k3y: caches.default at 10 min).
//
// Runs the pagelist → unsigned playurl chain (see $lib/proxy/bilibili for the probe
// evidence) and returns the best DASH audio stream as JSON: { cid, url, bandwidth }.
// The client adapter does NOT put this CDN url into <audio> — bilivideo enforces a
// bilibili Referer that HTML media elements cannot send (proven: openmusic.lol
// Referer → 403). The adapter points the player at /api/bilibili/stream instead and
// uses this route's answer for the playability check + honest quality label.
// The 10-min edge cache matches the CDN urls' signed lifetime comfortably and
// amortizes repeat plays; `url: null` = gone / region-locked / no audio track.
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { biliResolveDashAudio } from '$lib/proxy/bilibili';

const TTL = 600; // 10 min
const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

// Shared JSON responder (src/lib/proxy/http.ts).
const jsonPassthrough = (body: unknown, origin: string | null, ttl?: number): Response =>
	jsonResponse(body, origin, { ttl });

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const bvid = (url.searchParams.get('bvid') ?? '').trim();
	if (!BVID_RE.test(bvid)) return jsonPassthrough({ url: null }, origin);

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
		const dash = await biliResolveDashAudio(bvid);
		if (!dash) return jsonPassthrough({ url: null }, origin);
		const body = { cid: dash.cid, url: dash.url, bandwidth: dash.bandwidth };
		if (cache) {
			const cached = new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			await cache.put(cacheReq, cached);
		}
		return jsonPassthrough(body, origin, TTL);
	} catch {
		return jsonPassthrough({ url: null }, origin);
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
