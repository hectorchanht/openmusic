// og-handler — the ONE request-handling core behind BOTH /api/og spellings (OG-EP-01/02).
//
// quick-261120-mediacard: /api/og used to be a single query-form route
// (`/api/og?type=&artist=&title=`). Hector's keyword-only ruling made og:image a PATH-form
// URL (`/api/og/song/{artist}/{title}` — keywords only, no query), so the handler core moved
// here and both +server.ts files are verb-only shells delegating to it: ONE handler, ONE
// resolver, two URL spellings. The legacy query form keeps working byte-identically for
// og:image URLs already rendered into pages and chats (live compat); it is simply no longer
// emitted (ogImageUrl in $lib/services/share builds the path form).
//
// RESOLUTION ORDER (both spellings): bytes cache → legacy `ci` carrier (query form only) →
// THE SEAM (resolveCoverViaSeam in $lib/proxy/og-cover — the system's single song-resolver
// seam, driven edge-side; song cards only) → keyword-keyed resolve cache → the text tier
// chain (fallback-only since quick-261120-mediacard) → the branded card.
//
// A social crawler is what fetches this, which sets every constraint below:
//
//  - NEVER 500, never 30x. Every fault — a tier miss, malformed upstream JSON, a CDN error
//    page, a broken Cache API — degrades to a 200 + the branded 1200×630 card. A crawler
//    that gets a non-200 shows no card at all.
//  - STREAM, do not redirect: `new Response(upstream.body, { headers })` is ~0 CPU on
//    workerd (the body is never buffered) and sidesteps per-crawler redirect-follow
//    variance — WhatsApp and iMessage are the fussy ones and do not reliably follow an
//    og:image redirect.
//  - BOUNDED: the seam gets SEAM_MS, the tier chain one OG_RESOLVE_MS deadline, retries=0.
//
// This core is the deezer/search SHELL (own-origin CORS, OPTIONS 204, caches.default keyed
// own-origin, cache-write on SUCCESS only) wrapped around the ytmusic/stream BODY (a FRESH
// header object with an explicit allow-list — never a blind copy of upstream headers, which
// is what makes a `Set-Cookie` in the cached copy structurally impossible; cache.put throws
// on one).
//
// TWO CACHE LAYERS, both keyed via ownOriginCacheKey (NEVER an upstream URL — T-wv8-06):
//  1. RESOLVE (artist+title+type → cover URL), keyed on the matchKey-NORMALIZED synthetic
//     /api/og/_resolve URL so param order and the hyphen-for-space share loss collapse to
//     ONE entry, shared by both spellings. Survives bytes-layer eviction: an evicted image
//     then costs 1 subrequest, not a fan-out.
//  2. BYTES (the image itself), keyed on the request URL as-is (each spelling has its own).
//
// SECURITY: no URL parameter is accepted at all — input is TEXT (T-24-08, strictly tighter
// than the old `?c=` carrier), length-capped, and only ever encodeURIComponent'd into fixed
// upstream templates (T-wv8-01). The cover URL is fetched only after passing its own tier's
// host allow-list (T-wv8-05), its Content-Type is VALIDATED (T-30-04) and the
// cache-buffering clone is size-capped (T-og-02).
//
// LEGACY COMPAT — the `ci` cover-id carrier (quick-260809-3uo): ONE optional parameter on
// the QUERY form only, and it is NOT a URL. It is a short cover ID from a CLOSED tag set
// (`d`/`l`/`k`/`i`), reconstructed into an image URL by coverUrlFromToken in
// $lib/proxy/og-cover from a template whose scheme, host and path shape are LITERALS in that
// file. Emission stopped at quick-261120-mediacard (keyword-only ruling; the client half,
// coverToken, is deleted) — this reception stays because links already in chats carry it.
// The carrier path NEVER reads or writes the resolve layer (T-3uo-03 anti-poisoning: the
// resolve entry is keyed on normalized TEXT and shared by every requester, so
// request-supplied input must not write it). The retired `?u=` identity carrier is NOT read
// here any more: it only ever selected a per-source detail call, and the keyword seam below
// supersedes it — an old og:image URL carrying `&u=` simply resolves by its keywords.
import type { Env } from '$lib/proxy/proxy-types';
import { corsHeaders, fetchWithRetry, corsPreflight } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import type { EdgeCache } from '$lib/proxy/edge-cache';
import {
	OG_RESOLVE_MS,
	coverUrlFromToken,
	isOgType,
	resolveCoverTiered,
	resolveCoverViaSeam
} from '$lib/proxy/og-cover';
import type { OgType } from '$lib/proxy/og-cover';
import { OG_FALLBACK_BYTES, OG_FALLBACK_TYPE } from '$lib/proxy/og-fallback';
import { matchKey } from '$lib/services/dedupe';
import { ensureFoldReady } from '$lib/services/zh-convert';

/** 24 h, `immutable` (a client hint, RFC 8246) — a cover for a given song does not change. */
const TTL = 86400;
const CACHE_CONTROL = `public, max-age=${TTL}, immutable`;

/**
 * The image fetch is the last hop and gets its own budget, outside the resolve deadline.
 * 4000 (raised from 2500 at quick-261120-mediacard's live fix): the seam's CN CDN covers
 * (music.126.net / kuwo / gtimg) transfer slowly to overseas PoPs on a cold hit — a
 * 600×600 netease cover is ~390 KB and measured multiple seconds from North America —
 * and 2500 killed resolved covers at the last hop. A hit is bytes-cached for the TTL,
 * so the cost is once per song per PoP.
 */
const IMAGE_MS = 4000;

/**
 * quick-261120-mediacard: the seam stage's own budget — a crowd-pick read plus a 3-source
 * search fan-out (plus at most one qq detail hop / one Meting-redirector deref), all
 * parallel where the seam parallelises. Sized from LIVE measurements (2026-11-20): the
 * CN upstreams answer in ~1.5–2.6 s EACH from the edge and the fan-out's slowest leg sets
 * the stage — the first cut (4000) aborted the fan-out mid-flight and every seam-resolved
 * song fell back to the branded card, so the budget is 8000. A hit is bytes-cached for the
 * TTL and written to the resolve layer, so the cost is paid once per song per PoP.
 */
const SEAM_MS = 8000;

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
 *
 * quick-260914-to2 — `x-og-fallback: 1` is a MACHINE marker, purely additive. A crawler is not the
 * only consumer any more: media-artwork.ts asks this endpoint for a cover to embed in a download and
 * to hand the OS media session, and a total miss and a real cover are BOTH 200 + image/jpeg, so
 * without a marker the app stamped the branded card in as FrontCover. Body, status, content-type,
 * Content-Length and Cache-Control stay byte-identical — crawlers ignore unknown headers.
 *
 * WHY IT IS EXPOSED: on the native build the app fetches https://openmusic.lol/api/og from
 * https://localhost, i.e. CROSS-origin, and a non-safelisted response header is invisible to
 * `headers.get()` without Access-Control-Expose-Headers. Without this line the guard would silently
 * never fire on the APK. Only THIS response carries the marker, so only this one exposes it —
 * corsHeaders() in $lib/proxy/http.ts is deliberately left alone.
 */
function ogFallback(origin: string | null): Response {
	return new Response(OG_FALLBACK_BYTES, {
		status: 200,
		headers: {
			...corsHeaders(origin),
			'content-type': OG_FALLBACK_TYPE,
			'Content-Length': String(OG_FALLBACK_BYTES.length),
			'Cache-Control': CACHE_CONTROL,
			'x-og-fallback': '1',
			'Access-Control-Expose-Headers': 'x-og-fallback'
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

/** The inputs both spellings extract from their URL shape — nothing else differs. */
export interface OgImageInput {
	/** Raw card kind (`song` / `album` / `artist`); coerced against the closed set inside. */
	type: string;
	artist: string;
	title: string;
	/** LEGACY COMPAT: the query form's `ci` cover-id token ('' for the path form). */
	ci: string;
	/** The request URL (its origin keys both cache layers + the seam's crowd dispatch). */
	url: URL;
	request: Request;
	platform?: unknown;
}

/**
 * The shared GET core. Both /api/og +server.ts shells delegate here verbatim, so the two
 * spellings can never drift apart (quick-261120-mediacard).
 */
export async function handleOgImage(input: OgImageInput): Promise<Response> {
	const { url, request, platform } = input;
	const origin = request.headers.get('origin');
	// TEMP DIAGNOSTIC (quick-261120-mediacard live debug): ?dbg=1 on the legacy spelling
	// collects a stage trace into the x-og-debug response header. Remove after diagnosis.
	const trace: string[] | undefined = url.searchParams.get('dbg') === '1' ? [] : undefined;
	const done = (res: Response): Response => {
		if (trace) {
			try {
				res.headers.set('x-og-debug', trace.join(' '));
			} catch {
				/* guarded headers — diagnostic only */
			}
		}
		return res;
	};
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
		const type: OgType = isOgType(input.type) ? input.type : 'song';
		const artist = (input.artist ?? '').trim().slice(0, MAX_TERM_CHARS);
		const title = (input.title ?? '').trim().slice(0, MAX_TERM_CHARS);
		// LEGACY COMPAT (quick-260809-3uo): the optional cover-id carrier, read as an OPAQUE
		// string. Deliberately NOT capped or sanitised here — the cap and the closed-tag grammar
		// both live inside coverUrlFromToken, so there is exactly ONE place that decides what a
		// token is.
		const ci = input.ci ?? '';

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

		// LEGACY COMPAT — THE CARRIER PATH (query form only; the path form passes ci='').
		// Sits AFTER the bytes layer (a cached card must still cost zero subrequests) and
		// BEFORE the resolve key is even built.
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
		// The arithmetic: falling through would cost IMAGE_MS (4000) + OG_RESOLVE_MS (5000) + a second
		// image fetch (4000) ≈ 13 s, past the 3–10 s crawler budget 30-RESEARCH §D records — trading a
		// rare better card for a routinely-timed-out one.
		const carried = await coverUrlFromToken(ci);
		if (carried) return await streamImage(carried, cache, bytesKey, origin);

		// LAYER 1 (resolve) KEY — NORMALIZED synthetic own-origin key: matchKey() strips case, spaces
		// and punctuation, so query-order variants, both URL spellings AND the hyphen-for-space share
		// loss share one entry.
		await ensureFoldReady(); // quick-261102-sjg: matchKey folds script — never key cold
		const resolveKey = ownOriginCacheKey(
			`${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
		);

		// quick-261120-mediacard — THE SEAM STAGE. Resolving a media card is resolving a song:
		// a SONG card's cover comes from the system's single resolver seam FIRST (crowd pick →
		// resolveStub-shaped fan-out → the cover chain's qq detail hop), driven edge-side by
		// resolveCoverViaSeam (see $lib/proxy/og-cover for why the seam is driven, not
		// imported). It sits AFTER the bytes + carrier paths and BEFORE the resolve-cache read
		// on purpose: a negative entry the old text chain wrote must not shadow the seam for
		// its whole TTL — the seam IS the resolution now, the cache is its memo. A HIT writes
		// the resolve layer (keyword-keyed, like any tier hit) and streams; a MISS falls
		// through to the resolve layer + tier chain unchanged. Album/artist cards have no
		// song seam — they keep the tier chain as their primary path.
		if (type === 'song') {
			const seamCover = await resolveCoverViaSeam(
				url.origin,
				artist,
				title,
				AbortSignal.timeout(SEAM_MS),
				trace
			);
			if (seamCover) {
				trace?.push(`seam:hit:${new URL(seamCover).hostname}`);
				await writeResolveCache(cache, resolveKey, seamCover);
				const res = await streamImage(seamCover, cache, bytesKey, origin);
				trace?.push(res.headers.get('x-og-fallback') ? 'img:fallback' : 'img:ok');
				return done(res);
			}
			trace?.push('seam:miss');
		}

		let cover = await readResolveCache(cache, resolveKey);
		trace?.push(cover === undefined ? 'rcache:miss' : cover === null ? 'rcache:neg' : 'rcache:hit');
		if (cover === undefined) {
			const resolved = await resolveCoverTiered(
				type,
				artist,
				title,
				AbortSignal.timeout(OG_RESOLVE_MS),
				(platform as { env?: Env } | undefined)?.env?.LASTFM_KEY
			);
			trace?.push(resolved === 'ERROR' ? 'tier:error' : resolved === null ? 'tier:miss' : 'tier:hit');
			if (resolved === 'ERROR') {
				cover = null; // fall back now, but write NOTHING — the next request retries.
			} else {
				cover = resolved;
				await writeResolveCache(cache, resolveKey, resolved);
			}
		}
		if (!cover) return done(ogFallback(origin));

		const res2 = await streamImage(cover, cache, bytesKey, origin);
		trace?.push(res2.headers.get('x-og-fallback') ? 'img:fallback' : 'img:ok');
		return done(res2);
	} catch {
		// Outermost never-500 guard: whatever happened, the crawler still gets a card.
		return ogFallback(origin);
	}
}

/** CORS preflight — scoped to the own origin via corsHeaders (never `*`, T-wv8-02). */
export function handleOgOptions(request: Request): Response {
	return corsPreflight(request);
}
