// kuwo search edge route (quick-261004-n1i) — official search.kuwo.cn/r.s reshaped into the legacy
// `{ code: 200, data: [{ rid, name, artist, album, pic }] }` body the client adapter reads, so
// src/lib/sources/kuwo.ts and every saved `kuwo:<rid>` uid are untouched. All logic lives in
// $lib/proxy/kuwo.ts; this file exports ONLY verbs (a helper export 500s at request time).
//
// Edge-cached 300 s — the same TTL the catch-all gave kuwo search (quick-260704-2os). Search bodies
// are cacheable; /api/kuwo/detail NEVER is, its resolver urls are signed + expiring (T-2os-03
// parity). Only a 200 is stored, so one upstream fault is never frozen for the TTL.
import type { RequestHandler } from './$types';
import { corsHeaders, jsonResponse } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import { fetchKuwoSearch } from '$lib/proxy/kuwo';

const TTL = 300;

export const GET: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');
	const name = (url.searchParams.get('name') ?? '').trim();
	if (!name) return jsonResponse({ code: 200, data: [] }, origin);
	// Clamped to 1..50 in buildKuwoSearchUrl (T-n1i-06).
	const limit = Number(url.searchParams.get('limit')) || 10;
	const page = Number(url.searchParams.get('page')) || 1;

	const cache = edgeCache();
	const cacheReq = new Request(url.toString()); // OWN-origin key, never the upstream url

	if (cache) {
		const hit = await cache.match(cacheReq);
		if (hit) return jsonResponse(await hit.json(), origin, { ttl: TTL });
	}

	const { status, body } = await fetchKuwoSearch(name, limit, page);
	if (cache && status === 200) {
		await cache.put(
			cacheReq,
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			})
		);
	}
	return jsonResponse(body, origin, { status, ttl: status === 200 ? TTL : undefined });
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
