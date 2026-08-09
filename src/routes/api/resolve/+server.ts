// Edge resolve cache — /api/resolve (phase 31, 31-D-06 / 31-D-07 / 31-D-09 / 31-D-10).
//
// GET  /api/resolve?a=<artist>&t=<title>  → { hit: true, entry } | { hit: false }
// POST /api/resolve  { "a": string, "t": string } → { busted: boolean }   (DELETE-ONLY)
//
// Turns a repeat play of a song someone in this PoP already played into ONE own-origin
// round-trip instead of a CN search + detail pair. Skeleton copied from
// api/deezer/search/+server.ts (the JSON + caches.default template): a CORS-FREE stored copy
// with CORS re-applied per hit, and a per-route OPTIONS 204 for sibling parity.
//
// THIS FILE EXPORTS ONLY HTTP VERBS. A top-level non-verb `export function` in a `+server.ts`
// 500s at REQUEST time ("Invalid export") and unit tests do NOT catch it, because they import
// the module directly (`svelte-server-endpoint-only-verb-exports`). Every helper therefore lives
// in $lib/proxy/resolve-cache.ts and $lib/proxy/resolve-edge.ts. `jsonResult` below is private
// (non-exported), matching deezer/search.
//
// 31-D-07: no new Cloudflare binding, no new secret, no new package — `caches.default` only,
// reached through the single `edgeCache()` guard (never a second `typeof caches`).
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/proxy/http';
import { edgeCache } from '$lib/proxy/edge-cache';
import {
	capTerm,
	resolveCacheKey,
	readResolveEntry,
	writeResolveEntry,
	bustResolveEntry,
	RESOLVE_TTL_S
} from '$lib/proxy/resolve-cache';
import { resolveOnEdge } from '$lib/proxy/resolve-edge';

/** Ceiling on the whole background fill (search + detail). Bounded — nobody is waiting on it. */
const FILL_TIMEOUT_MS = 8000;

function jsonResult(body: unknown, origin: string | null, ttl?: number, status = 200): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': 'application/json'
	};
	if (ttl != null) headers['Cache-Control'] = `public, max-age=${ttl}`;
	return new Response(JSON.stringify(body), { status, headers });
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');

	// RAW text in, normalization owned by the edge. `matchKey` is lossy (a key cannot be turned
	// back into a search query), so the route must do the folding itself — which also means a
	// client can never hand-craft its own key namespace. capTerm caps both at 200 (T-31-03-07).
	const a = capTerm(url.searchParams.get('a'));
	const t = capTerm(url.searchParams.get('t'));
	// Nothing to look up → answer with ZERO cache touches and ZERO subrequests (the deezer/search
	// short-circuit).
	if (!a && !t) return jsonResult({ hit: false }, origin);

	const cache = edgeCache();
	const key = resolveCacheKey(url.origin, a, t);

	// THREE-VALUED: a defined value (including a stored known-none) is a HIT. The stored copy is
	// CORS-free; CORS for THIS requester's origin is re-applied here (WR-01).
	const entry = await readResolveEntry(cache, key);
	if (entry !== undefined) return jsonResult({ hit: true, entry }, origin, RESOLVE_TTL_S);

	// MISS — answer IMMEDIATELY and fill OUT OF BAND. Awaiting the fill on the hot path is the
	// anti-pattern this whole design exists to avoid (31-D-08): a miss must cost the client one
	// own-origin round-trip and nothing more, because the client resolves normally anyway.
	//
	// 31-D-06 / T-31-03-03: the fill is server-side, so every cached URL is derived from the kuwo
	// upstream. There is deliberately NO client write path — the entry is keyed on normalized TEXT
	// and shared by every requester in the PoP, so a client-supplied URL would let one crafted
	// request change what everyone else plays.
	//
	// ponytail: there is no in-flight marker, so N concurrent misses for the same song in one PoP
	// can each schedule a fill. At this app's traffic that is a handful of bounded 2-subrequest
	// jobs. Add a short-TTL placeholder entry only if PoP traffic ever makes it matter.
	platform?.ctx?.waitUntil(
		(async () => {
			const result = await resolveOnEdge(a, t, AbortSignal.timeout(FILL_TIMEOUT_MS));
			// null = FAULT → write NOTHING, so the next request retries instead of pinning the fault
			// for the whole TTL. A clean "kuwo is dry" negative is a non-null entry and IS written
			// (D-06(c)) — that is what makes the repeat crawl cost zero subrequests.
			if (result) await writeResolveEntry(cache, key, result);
		})().catch(() => {})
	);

	return jsonResult({ hit: false }, origin);
};

/**
 * 31-D-09 cache bust. DELETE-ONLY, structurally: this handler contains no `cache.put` and never
 * reads a `url` (or any payload) field from the body — the ONLY thing a request can express is
 * "drop the entry for this artist+title" (T-31-03-01). The entry is shared by every requester in
 * the PoP, so letting request-supplied input WRITE it would let one crafted request change what
 * everyone else resolves — the same reasoning /api/og records for its shared, text-keyed entry.
 *
 * Deleting is idempotent and self-limiting (T-31-03-02): the worst case of an abusive caller is a
 * cold resolve, i.e. exactly the pre-phase behaviour, and the delete is PoP-local. Rate limiting
 * is deliberately NOT added — it would need per-IP state (a new binding, forbidden by D-07) to
 * defend against "slightly slower playback". Upgrade path: a Cloudflare WAF rate-limit rule on
 * this path, zero code change.
 */
export const POST: RequestHandler = async ({ url, request }) => {
	const origin = request.headers.get('origin');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResult({ busted: false }, origin, undefined, 400);
	}

	const fields = (body ?? {}) as { a?: unknown; t?: unknown };
	const a = capTerm(typeof fields.a === 'string' ? fields.a : null);
	const t = capTerm(typeof fields.t === 'string' ? fields.t : null);
	if (!a && !t) return jsonResult({ busted: false }, origin);

	// Same key builder as the GET, so a bust can only ever hit the entry the GET wrote.
	const busted = await bustResolveEntry(edgeCache(), resolveCacheKey(url.origin, a, t));
	return jsonResult({ busted }, origin);
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02). hooks.server.ts
// already answers /api/* preflights before routing; this is belt-and-braces parity with the
// sibling routes (deezer/search, og).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
