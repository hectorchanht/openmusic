// /api/og — the own-origin share-card cover endpoint (OG-EP-01, OG-EP-02).
//
// A share link is now carrier-free (`/song/{artist}/{title}`, no `?c=` cover in the URL), so
// `og:image` points HERE and the cover is re-resolved server-side from the card's TEXT. A social
// crawler is what fetches this, which sets every constraint below:
//
//  - NEVER 500, never 30x. Every fault — a tier miss, malformed upstream JSON, a CDN error page,
//    a broken Cache API — degrades to a 200 + the branded 1200×630 card. A crawler that gets a
//    non-200 shows no card at all.
//  - STREAM, do not redirect: `new Response(upstream.body, { headers })` is ~0 CPU on workerd
//    (the body is never buffered) and sidesteps per-crawler redirect-follow variance — WhatsApp
//    and iMessage are the fussy ones and do not reliably follow an og:image redirect.
//  - BOUNDED: one OG_RESOLVE_MS deadline over the whole tier chain (og-cover.ts), retries=0,
//    worst case 6 resolve subrequests + 1 image = 7 (quick-260807-vl1: 3 tiers + the
//    original-terms Deezer fallback + the title-only Deezer fallback; quick-260809-38i adds the
//    key-gated Last.fm song tier in front).
//
// This route is the deezer/search SHELL (own-origin CORS, OPTIONS 204, caches.default keyed
// own-origin, cache-write on SUCCESS only) wrapped around the ytmusic/stream BODY (a FRESH header
// object with an explicit allow-list — never a blind copy of upstream headers, which is what makes
// a `Set-Cookie` in the cached copy structurally impossible; cache.put throws on one).
//
// LIVE PROBE (research 2026-08-07) — the tier facts live in $lib/proxy/og-cover.ts's header; what
// matters here: all three cover CDNs answered with a concrete Content-Length and `image/jpeg`, at
// 72 KB (Deezer cover_big) / 101 KB (iTunes 600x600bb) / 104 KB (kuwo /600/). Note edgeCache()
// returns null under `vite dev` by design, so BOTH cache layers are unit-provable only
// (og-endpoint.test.ts) — `pnpm dev` always hits live upstream.
//
// TWO CACHE LAYERS, both keyed via ownOriginCacheKey (NEVER an upstream URL — T-wv8-06):
//  1. RESOLVE (artist+title+type → cover URL), keyed on the matchKey-NORMALIZED synthetic
//     /api/og/_resolve URL so `?title=A&artist=B` and `?artist=B&title=A`, and the hyphen-for-space
//     share loss, all collapse to ONE entry. Survives bytes-layer eviction: an evicted image then
//     costs 1 subrequest, not 3.
//  2. BYTES (the image itself), keyed on the request URL as-is.
//
// SECURITY: no URL parameter is accepted at all — input is TEXT (T-24-08, strictly tighter than
// the old `?c=` carrier), length-capped, and only ever encodeURIComponent'd into fixed upstream
// templates (T-wv8-01). The cover URL is fetched only after passing its own tier's host allow-list
// (T-wv8-05), its Content-Type is VALIDATED (T-30-04) and the cache-buffering clone is size-capped
// (T-og-02).
//
// quick-260809-3uo — AMENDMENT to the paragraph above (the T-24-08 / OG-EP-01 refs STAY: they record
// why the URL carrier left, and it has not come back). ONE optional parameter `ci` is now accepted,
// and it is NOT a URL. It is a short cover ID from a CLOSED tag set (`d`/`l`/`k`/`i`), reconstructed
// into an image URL by coverUrlFromToken in $lib/proxy/og-cover from a template whose scheme, host
// and path shape are LITERALS in that file. So the sentence "no URL parameter is accepted at all"
// is still true — there is still no URL to smuggle a host into, which is the property T-24-08 was
// protecting; the allow-list is now STRUCTURAL rather than a check to probe (T-3uo-01/02).
//
// WHY IT EXISTS: server-side re-resolution from TEXT is structurally blind to the cover the CLIENT
// already resolved. 你瞞我瞞 / 陳柏宇 showed Quinquennium art (the client's iTunes tier) on the hero,
// the Nowbar and the Downloads rows, and an EMPTY card in WhatsApp. Adding more server tiers is
// whack-a-mole; the client knows the answer at the moment the user taps share, so it carries it.
// The carrier is OPTIONAL and ADVISORY: absent, unrecognised or rejected → the tier chain runs
// byte-identically to before this change (T-3uo-07).
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { corsHeaders, fetchWithRetry } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import type { EdgeCache } from '$lib/proxy/edge-cache';
import { OG_RESOLVE_MS, coverUrlFromToken, isOgType, resolveCoverTiered } from '$lib/proxy/og-cover';
import type { OgType } from '$lib/proxy/og-cover';
import { OG_FALLBACK_BYTES, OG_FALLBACK_TYPE } from '$lib/proxy/og-fallback';
import { matchKey } from '$lib/services/match-key';

/** 24 h, `immutable` (a client hint, RFC 8246) — a cover for a given song does not change. */
const TTL = 86400;
const CACHE_CONTROL = `public, max-age=${TTL}, immutable`;

/** The image fetch is the last hop and gets its own budget, outside the resolve deadline. */
const IMAGE_MS = 2500;

/** T-og-02: clone() BUFFERS the whole body (Cloudflare docs), so never buffer an unbounded one. */
const CACHE_BYTES_CAP = 3_000_000;

/** Pathological-input guard: a hostile query must not build a giant upstream URL. */
const MAX_TERM_CHARS = 200;

/** Content types we will relay as a card image. Anything else → the branded fallback. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The branded 1200×630 card: 200, zero network, zero subrequests. Every fault lands here.
 *
 * quick-260807-vl1: a RASTER (og-fallback.ts), no longer an inlined SVG — no major platform renders
 * an SVG og:image, so the previous fallback was invisible in exactly the messengers this endpoint
 * exists for. The bytes are already decoded at module scope, so this is allocation-only.
 */
function ogFallback(origin: string | null): Response {
	return new Response(OG_FALLBACK_BYTES, {
		status: 200,
		headers: {
			...corsHeaders(origin),
			'content-type': OG_FALLBACK_TYPE,
			'Content-Length': String(OG_FALLBACK_BYTES.length),
			'Cache-Control': CACHE_CONTROL
		}
	});
}

/**
 * Validate the upstream Content-Type (T-30-04). Do NOT pass it through blindly: a CDN that answers
 * a 200 `text/html` error page would otherwise be emitted AS the card image. Parameters are
 * stripped (`image/jpeg; charset=binary` is real) and the result must be in the allow-list.
 */
function normalizeImageType(raw: string | null): string | null {
	const ct = (raw ?? '').split(';')[0].trim().toLowerCase();
	if (!ct.startsWith('image/')) return null;
	const norm = ct === 'image/jpg' ? 'image/jpeg' : ct;
	return IMAGE_TYPES.has(norm) ? norm : null;
}

/** Re-apply CORS for THIS request's origin on a bytes-layer hit (WR-01 — the stored copy is
 *  deliberately CORS-free, so a cross-origin hit never inherits a prior requester's ACAO). */
function withCors(hit: Response, origin: string | null): Response {
	const headers: Record<string, string> = {
		...corsHeaders(origin),
		'content-type': normalizeImageType(hit.headers.get('content-type')) ?? 'image/jpeg',
		'Cache-Control': CACHE_CONTROL
	};
	const len = hit.headers.get('content-length');
	if (len != null) headers['Content-Length'] = len;
	return new Response(hit.body, { status: 200, headers });
}

/**
 * Read the resolve layer. THREE-VALUED, mirroring resolveCoverTiered's contract:
 * `undefined` = cache miss (go resolve), a string = cached hit, `null` = cached KNOWN-NONE.
 * Cache reads are best-effort — a broken Cache API degrades to "miss", never to a 500.
 */
async function readResolveCache(
	cache: EdgeCache | null,
	key: Request
): Promise<string | null | undefined> {
	if (!cache) return undefined;
	try {
		const hit = await cache.match(key);
		if (!hit) return undefined;
		const body = (await hit.json()) as { cover?: string | null } | null;
		return body?.cover ?? null;
	} catch {
		return undefined;
	}
}

/**
 * Write the resolve layer. `null` IS written — a clean all-tier miss is a genuine "this cover does
 * not exist", so negative-caching it makes the repeat crawl cost ZERO subrequests. An `'ERROR'`
 * never reaches here: a fault must be retried next request, not pinned for the whole TTL (the same
 * discipline deezer/search/+server.ts's no-cache-write-on-error branch documents).
 */
async function writeResolveCache(
	cache: EdgeCache | null,
	key: Request,
	cover: string | null
): Promise<void> {
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify({ cover }), {
				status: 200,
				headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			})
		);
	} catch {
		// Caching is best-effort; a failed write only costs the next request a re-resolve.
	}
}

/**
 * Fetch the resolved cover and STREAM it. `coverUrl` has already passed its own tier's host
 * allow-list, so this is never a client-supplied URL (no open relay, T-wv8-05).
 */
async function streamImage(
	coverUrl: string,
	cache: EdgeCache | null,
	bytesKey: Request,
	origin: string | null
): Promise<Response> {
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): SERVER-SIDE (Cloudflare edge) fetch of an
		// absolute upstream CDN URL. apiFetch is the CLIENT seam and must not run edge-side. retries=0
		// — a crawler is waiting and backoff does not fit the budget.
		const upstream = await fetchWithRetry(
			coverUrl,
			{ signal: AbortSignal.timeout(IMAGE_MS) },
			0
		);
		if (!upstream.ok || !upstream.body) return ogFallback(origin);
		const contentType = normalizeImageType(upstream.headers.get('content-type'));
		if (!contentType) {
			// Not an image (a CDN html error page) — drain so the connection can be reused, then serve
			// the branded card rather than relaying a non-image body as the card image (T-30-04).
			await upstream.body.cancel().catch(() => {});
			return ogFallback(origin);
		}

		// FRESH header object with an explicit allow-list (the ytmusic/stream posture) — never a copy
		// of upstream headers, so Set-Cookie cannot reach the client OR the cached copy.
		const headers: Record<string, string> = {
			...corsHeaders(origin),
			'content-type': contentType,
			'Cache-Control': CACHE_CONTROL
		};
		const len = Number(upstream.headers.get('content-length') ?? NaN);
		const sized = Number.isFinite(len) && len > 0;
		// Only pass through a Content-Length we actually received — a mismatch truncates the image.
		if (sized) headers['Content-Length'] = String(len);

		const streamed = new Response(upstream.body, { status: 200, headers });

		if (cache && sized && len <= CACHE_BYTES_CAP) {
			// clone() buffers `len` bytes (bounded above, T-og-02); the CLONE goes to the cache and the
			// ORIGINAL streams to the crawler. The cached copy is CORS-FREE (WR-01) — withCors()
			// re-applies the requesting origin on a hit.
			const forCache = new Response(streamed.clone().body, {
				status: 200,
				headers: {
					'content-type': contentType,
					'Cache-Control': CACHE_CONTROL,
					'Content-Length': String(len)
				}
			});
			try {
				await cache.put(bytesKey, forCache);
			} catch {
				// Best-effort: a failed cache write must not cost the crawler its card.
			}
		}
		return streamed;
	} catch {
		return ogFallback(origin);
	}
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	try {
		// Closed-set `type`, COERCED rather than rejected — this route never fails (a 404 here means
		// no card at all).
		//
		// quick-260809-38i: ONE secret is read — LASTFM_KEY, for the song-card parity tier that makes
		// the card match the in-app hero. platform?.env is the verified Cloudflare-adapter accessor
		// (api/lastfm/info/+server.ts:265). The key is injected EDGE-SIDE ONLY: it is interpolated into
		// the upstream URL inside og-cover.ts and never reaches the client, a response header, or the
		// cached body (the cache stores only the resolved image URL / the image bytes — T-38i-01).
		// ABSENT KEY IS SUPPORTED (T-08-02 parity): the remaining tiers are keyless and the chain then
		// behaves exactly as it did before this change.
		const requested = url.searchParams.get('type') ?? 'song';
		const type: OgType = isOgType(requested) ? requested : 'song';
		const artist = (url.searchParams.get('artist') ?? '').trim().slice(0, MAX_TERM_CHARS);
		const title = (url.searchParams.get('title') ?? '').trim().slice(0, MAX_TERM_CHARS);
		// quick-260809-3uo: the optional cover-id carrier, read as an OPAQUE string. Deliberately NOT
		// capped or sanitised here — the cap and the closed-tag grammar both live inside
		// coverUrlFromToken, so there is exactly ONE place that decides what a token is (MAX_TERM_CHARS
		// above is the sibling precedent for capping request text, but a SECOND cap here would just be
		// a place for the two to disagree).
		const ci = url.searchParams.get('ci') ?? '';

		// T-og-01: nothing to search for → branded card with ZERO subrequests. AHEAD of any token work
		// (quick-260809-3uo) — an empty card must still cost nothing, carrier or not.
		if (!artist && !title) return ogFallback(origin);

		const cache = edgeCache();

		// LAYER 2 (bytes) — keyed on this own-origin /api/og URL as-is.
		const bytesKey = ownOriginCacheKey(url);
		if (cache) {
			try {
				const hit = await cache.match(bytesKey);
				if (hit) return withCors(hit, origin);
			} catch {
				// A broken Cache API degrades to a cold resolve, never to an error.
			}
		}

		// quick-260809-3uo — THE CARRIER PATH. Sits AFTER the bytes layer (a cached card must still cost
		// zero subrequests) and BEFORE the resolve key is even built.
		//
		// D2 / T-3uo-03 — the resolve layer is NEVER read or written here, and that is the whole
		// anti-poisoning property: the resolve entry is keyed on normalized TEXT and is SHARED by every
		// requester, so letting request-supplied input write it would let one crafted link change what
		// everyone else's carrier-free crawl resolves. The BYTES key is ownOriginCacheKey(url), which
		// already includes `ci`, so each distinct token gets its own entry and shares nothing.
		// ownOriginCacheKey stays the ONLY key builder on both paths.
		//
		// D1 — a token that rebuilt and passed its allow-list but whose IMAGE fetch then fails lands on
		// the branded card (streamImage's own failure path), it does NOT fall through to the tier chain.
		// The arithmetic: falling through would cost IMAGE_MS (2500) + OG_RESOLVE_MS (5000) + a second
		// image fetch (2500) ≈ 10 s, past the 3–10 s crawler budget 30-RESEARCH §D records — trading a
		// rare better card for a routinely-timed-out one.
		const carried = await coverUrlFromToken(ci);
		if (carried) return await streamImage(carried, cache, bytesKey, origin);

		// LAYER 1 (resolve) — NORMALIZED synthetic own-origin key: matchKey() strips case, spaces and
		// punctuation, so query-order variants AND the hyphen-for-space share loss share one entry.
		const resolveKey = ownOriginCacheKey(
			`${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
		);
		let cover = await readResolveCache(cache, resolveKey);
		if (cover === undefined) {
			const resolved = await resolveCoverTiered(
				type,
				artist,
				title,
				AbortSignal.timeout(OG_RESOLVE_MS),
				(platform?.env as Env | undefined)?.LASTFM_KEY
			);
			if (resolved === 'ERROR') {
				cover = null; // fall back now, but write NOTHING — the next request retries.
			} else {
				cover = resolved;
				await writeResolveCache(cache, resolveKey, resolved);
			}
		}
		if (!cover) return ogFallback(origin);

		return await streamImage(cover, cache, bytesKey, origin);
	} catch {
		// Outermost never-500 guard: whatever happened, the crawler still gets a card.
		return ogFallback(origin);
	}
};

// CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02).
export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
