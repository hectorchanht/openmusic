// Server hook — the SINGLE CORS seam for every /api/* route (D-02).
//
// WHY a hook and not per-route edits: the dedicated routes (/api/[source]/[...path],
// /api/deezer/*, /api/lastfm/*, /api/similar) already add corsHeaders, but /api/translate
// explicitly had NO CORS ("same-origin only") and would reject the native WebView origin
// https://localhost. Lifting CORS into one handle() covers translate AND every other /api/*
// route uniformly — no route can be silently left without allowlisted CORS.
//
// POSTURE (threat T-999.1-01/02/03):
//  - corsHeaders() echoes Access-Control-Allow-Origin ONLY for an allow-listed origin and
//    NEVER `*` — the JOOX-token-bearing proxy is never an open relay. It also sets
//    `Vary: Origin` so the Cloudflare edge cache keys per-origin correctly.
//  - OPTIONS preflight on /api/* returns a 204 WITHOUT calling resolve(): on Cloudflare
//    workerd the preflight must not fall through to the route's GET/POST logic.
//  - Non-/api/* paths pass through untouched (no CORS headers added to page/app routes).
import type { Handle } from '@sveltejs/kit';
import { corsHeaders } from '$lib/proxy/http';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith('/api/')) {
		const origin = event.request.headers.get('origin');

		// CORS preflight: answer 204 here; do NOT resolve() into route logic (workerd).
		if (event.request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(origin) });
		}

		// Real request: resolve the route, then merge allowlisted CORS onto the response.
		// corsHeaders() only sets Access-Control-Allow-Origin when `origin` is allow-listed
		// (never `*`), and always sets Vary: Origin for edge-cache correctness.
		const response = await resolve(event);
		for (const [key, value] of Object.entries(corsHeaders(origin))) {
			response.headers.set(key, value);
		}
		return response;
	}

	return resolve(event);
};
