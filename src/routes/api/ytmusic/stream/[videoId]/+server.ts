// YouTube Music STREAM byte-proxy (Plan 27-03, YT-PLAY-01 / YT-DOWNLOAD-01) — THE WALL (spike 006).
//
// GET /api/ytmusic/stream/:videoId — the money route. It POSTs the InnerTube VISIONOS `player`
// endpoint (clientVersion PLAYER_CLIENT_VERSION + a cached anonymous visitorData token) edge-side, selects itag 140
// (AAC-LC/mp4, the codec iOS Safari <audio> plays — NOT Opus/webm itag 251), then fetches the
// IP-locked googlevideo URL **within the same Worker invocation** and streams the bytes back with
// Range passthrough — exactly the audius stream pattern, plus the "call player first" step.
//
// WHY A PROXY (spike 006): the googlevideo URL is signed for the REQUESTER's IP (~6h expiry). If we
// set <audio>.src to the raw URL, the fetch originates from the user's browser IP (≠ the edge IP that
// signed it) → 403. So the Worker must call `player` (URL signed for the Worker's IP) AND fetch the
// bytes in the SAME invocation, then stream them back to an own-origin /api/ytmusic/stream/:videoId
// path (also keeps it CORS/Capacitor-safe, like audius/netease).
//
// ZERO auth: the player call uses an ANONYMOUS visitorData token only (spike 006) — no Google
// account, no PoToken, no cookie. Nothing here introduces an account/OAuth/user-token surface.
//
// SECURITY:
//  - open relay (T-27-03-01): we ONLY ever fetch the `url` returned in the player response's
//    adaptiveFormats — NEVER a client-supplied URL. videoId goes only into the fixed InnerTube body.
//  - info disclosure (T-27-03-02): visitorData stays edge-side (proxy module); the signed
//    googlevideo URL is never returned — only proxied bytes.
//  - DoS (T-27-03-03): the media byte-fetch uses the RAW edge fetch (fetchWithRetry) with
//    AbortSignal.timeout + retries=1 (audius posture) — NEVER the client fetch governor (api-base),
//    so a long-lived media stream cannot hold (and deadlock) a client concurrency slot.
//  - bot gate (T-27-03-04): VISIONOS + cached visitorData clears the gate anonymously;
//    bounded fresh-token retries then 503 avoids hammering a challenging upstream (never hang).
import type { RequestHandler } from './$types';
import { corsHeaders, corsPreflight } from '$lib/proxy/http';
import { edgeCache, type EdgeCache } from '$lib/proxy/edge-cache';
// selectAudioFormat + isPlayable live in the shared proxy module, NOT here: SvelteKit `+server.ts`
// only permits HTTP-verb (or `_`-prefixed) exports, so a top-level `export function` in this route
// throws `Invalid export` at request time (quick-270715 — caught by E2E, missed by the fixture unit
// test which imported the module directly).
// PLAYER_UA + playerBody (and the ROTTING VERSION PIN they read) now live in
// $lib/proxy/ytmusic-innertube.ts — shared verbatim with the native on-device resolver
// (src/lib/services/ytmusic-native.ts) so one bump fixes both (quick-260915-3ng). Imported here via
// the $lib/proxy/ytmusic re-export.
import {
	callPlayerGated,
	fetchMedia,
	isPlayable,
	playabilityInfo,
	selectAudioFormat
} from '$lib/proxy/ytmusic';

// googlevideo 403s ~1 in 6 edge byte fetches (sampled on prod 2026-10-04) even though the player said
// OK — the url is IP-locked and a Worker's subrequests do not always leave from the same IP. A fresh
// player call gets a fresh url, so retry the whole player→bytes hop on a 403.
const URL_ATTEMPTS = 3;
// The gated player resolve (callPlayerGated) + the googlevideo byte fetch (fetchMedia)
// moved to $lib/proxy/ytmusic in quick-261024-vid1 — the video route shares them verbatim.

// quick-261024-ytc — FULL-AUDIO EDGE CACHE. Live follow-up to -ytg: a failing request still took
// ~2.6-3.1 s (all 3 gate retries exhausted) while successes took ~0.9 s — the gate is the
// invocation's egress IP, so retries INSIDE one invocation are correlated and only a NEW
// invocation (or a different egress) decorrelates. A cache hit needs no invocation luck at all:
// once any request in a PoP lands the full file, every later play / seek / repeat click in that
// PoP is served from `caches.default` for 6 h (the googlevideo url lifetime; the BYTES do not
// expire, but 6 h bounds staleness / takedown lag). PoP-local by design — a user's browser
// sticks to its nearest PoP, so their repeat clicks hit the entry their first success stored.
const AUDIO_CACHE_TTL_S = 6 * 60 * 60;
const AUDIO_CACHE_MAX_BYTES = 25 * 1024 * 1024; // itag-140 songs are ~1-15 MB; cap the freak case
const audioCacheKey = (videoId: string) =>
	new Request('https://openmusic.lol/__ytmusic__/audio/' + encodeURIComponent(videoId));

// quick-261024-ytu — RESOLVED-URL EDGE CACHE. The -ytc audio cache only fills once a FULL file
// has crossed a PoP, but an <audio> session is mostly RANGE requests — a track can be played
// several times in a PoP before any single response covers the whole file, and every one of
// those invocations still had to survive the gated player call. The resolved googlevideo URL
// is therefore cached per PoP too: later invocations skip the player entirely and fetch bytes
// straight from the cached URL. TTL 3 h — half the ~6 h signed-URL lifetime, so an entry
// expires well before the URL does. The URL is IP-locked to the resolving egress and a PoP's
// invocations do not always share one, so a cached URL can 403 where a fresh one would work:
// ANY non-OK media answer on the fast path invalidates the entry and falls through to the
// normal player flow (the entry is a hint, never a promise). SECURITY (T-27-03-02): the signed
// URL lives ONLY inside the edge cache — it is never returned to the client; only bytes are.
const URL_CACHE_TTL_S = 3 * 60 * 60;
const urlCacheKey = (videoId: string) =>
	new Request('https://openmusic.lol/__ytmusic__/url/' + encodeURIComponent(videoId));
// Only plain single-range / range-less requests take the fast path — the same provable shapes
// the audio cache serves. Anything exotic (multi-range…) runs the full live flow.
const SINGLE_RANGE_SHAPE = /^bytes=\d*-\d*$/;

/** The cached googlevideo URL for this video, or null. A stored value that is not a plausible
 *  googlevideo URL is deleted rather than fetched (the cache is a hint, not a trust root). */
async function readCachedStreamUrl(cache: EdgeCache, videoId: string): Promise<string | null> {
	try {
		const hit = await cache.match(urlCacheKey(videoId));
		if (!hit) return null;
		const url = (await hit.text()).trim();
		if (!url.startsWith('https://') || !url.includes('googlevideo.com')) {
			await cache.delete(urlCacheKey(videoId)).catch(() => false);
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

/** Parse ONE `bytes=a-b` / `bytes=a-` / `bytes=-n` range against a known total. Anything else
 *  (multi-range, malformed, out of bounds) → null, and the caller falls through to the live
 *  upstream flow rather than answering a range it cannot prove correct. */
function parseSingleRange(header: string, total: number): { start: number; end: number } | null {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	if (m[1] === '') {
		const n = Number(m[2]);
		if (!Number.isFinite(n) || n <= 0) return null;
		return { start: Math.max(0, total - n), end: total - 1 };
	}
	const start = Number(m[1]);
	const end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
	if (!Number.isFinite(start) || start < 0 || start >= total || start > end) return null;
	return { start, end };
}

/** Serve a stream request ENTIRELY from the audio cache, or null on any miss / oddity (the
 *  caller then runs the normal player→bytes flow). A hit never touches YouTube — the whole point. */
async function serveFromAudioCache(
	cache: EdgeCache,
	videoId: string,
	range: string | null,
	origin: string | null
): Promise<Response | null> {
	try {
		const hit = await cache.match(audioCacheKey(videoId));
		if (!hit) return null;
		const bytes = new Uint8Array(await hit.arrayBuffer());
		if (bytes.byteLength === 0) {
			await cache.delete(audioCacheKey(videoId)).catch(() => false);
			return null;
		}
		const headers: Record<string, string> = {
			...corsHeaders(origin),
			'content-type': 'audio/mp4',
			'Accept-Ranges': 'bytes',
			'x-ytmusic-cache': 'hit'
		};
		if (!range) {
			headers['Content-Length'] = String(bytes.byteLength);
			return new Response(bytes, { status: 200, headers });
		}
		const r = parseSingleRange(range, bytes.byteLength);
		if (!r) return null; // unprovable range — let the live flow answer it
		const slice = bytes.slice(r.start, r.end + 1);
		headers['Content-Range'] = `bytes ${r.start}-${r.end}/${bytes.byteLength}`;
		headers['Content-Length'] = String(slice.byteLength);
		return new Response(slice, { status: 206, headers });
	} catch {
		return null; // a cache oddity must never break playback — fall through live
	}
}

/**
 * When an upstream response carries the FULL file, tee its body: one branch serves the client,
 * the other is stored into the audio cache under `waitUntil` (never delaying playback — the
 * 31-D-06 pattern). Returns the body the route should serve. Any doubt (partial coverage, no
 * cache, no ctx, oversize) → the original body, untouched.
 */
function storableBody(
	res: Response,
	cache: EdgeCache | null,
	videoId: string,
	ctx: { waitUntil(p: Promise<unknown>): void } | undefined
): BodyInit | null {
	if (!cache || !ctx || !res.body) return res.body;
	// Full coverage proof: a content-range spanning 0..total-1, or a plain 200 (its
	// content-length, when present, is verified byte-for-byte in the background reader).
	let total: number | null = null;
	const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
	if (cr) {
		if (Number(cr[1]) !== 0 || Number(cr[2]) !== Number(cr[3]) - 1) return res.body;
		total = Number(cr[3]);
	} else if (res.status === 200) {
		const cl = Number(res.headers.get('content-length') ?? '');
		total = Number.isFinite(cl) && cl > 0 ? cl : null;
	} else {
		return res.body;
	}
	if (total !== null && (total <= 0 || total > AUDIO_CACHE_MAX_BYTES)) return res.body;
	const [serve, copy] = res.body.tee();
	ctx.waitUntil(
		(async () => {
			const buf = await new Response(copy).arrayBuffer();
			if (buf.byteLength === 0 || buf.byteLength > AUDIO_CACHE_MAX_BYTES) return;
			if (total !== null && buf.byteLength !== total) return; // truncated — never cache a partial
			await cache.put(
				audioCacheKey(videoId),
				new Response(buf, {
					status: 200,
					headers: {
						'content-type': 'audio/mp4',
						'Cache-Control': `public, max-age=${AUDIO_CACHE_TTL_S}`
					}
				})
			);
		})().catch(() => {})
	);
	return serve;
}

export const GET: RequestHandler = async ({ params, request, platform }) => {
	const origin = request.headers.get('origin');
	const videoId = (params.videoId ?? '').trim();
	if (!videoId) return new Response('missing videoId', { status: 400, headers: corsHeaders(origin) });

	// googlevideo throttles a range-less GET to a trickle but serves `Range: bytes=0-` at full speed, so
	// a range-less request (the download path) asks upstream for bytes=0- and answers the client a
	// plain 200 below. A client Range (<audio> seeking) is forwarded verbatim.
	const range = request.headers.get('range');
	const upstreamHeaders: Record<string, string> = { Range: range ?? 'bytes=0-' };

	// quick-261024-ytc: a full-audio cache hit answers with NO player call and NO googlevideo
	// fetch — immune to the bot gate by construction. Miss / oddity → the live flow below.
	const cache = edgeCache();
	if (cache) {
		const cached = await serveFromAudioCache(cache, videoId, range, origin);
		if (cached) return cached;
	}

	let res: Response | null = null;
	let urlCacheHit = false;
	// quick-261024-ytu: a cached resolved URL lets this invocation skip the gated player call
	// entirely. Any non-OK media answer invalidates the entry and falls through live.
	if (cache && (range === null || SINGLE_RANGE_SHAPE.test(range.trim()))) {
		const cachedUrl = await readCachedStreamUrl(cache, videoId);
		if (cachedUrl) {
			try {
				const mediaRes = await fetchMedia(cachedUrl, upstreamHeaders);
				if (mediaRes.ok) {
					res = mediaRes;
					urlCacheHit = true;
				} else {
					await mediaRes.body?.cancel().catch(() => {});
					await cache.delete(urlCacheKey(videoId)).catch(() => false);
				}
			} catch {
				// network throw — keep the entry (not proof of death), run the live flow
			}
		}
	}
	for (let attempt = 0; attempt < URL_ATTEMPTS && !urlCacheHit; attempt++) {
		// 1+2. VISIONOS player POST (cached anonymous visitorData), retried on the bot gate with a
		// fresh token per retry (callPlayerGated, quick-261024-ytg). The visitorData promise goes
		// IN — the await lives inside callPlayer's try, so a getVisitorData throw is a graceful
		// null, not an uncaught crash (quick-261006-r2).
		const json = await callPlayerGated(videoId);
		if (!isPlayable(json)) {
			// Still gated after every retry → 503 so the client's cross-source fallback engages.
			// Never 502/504: Cloudflare's edge replaces the body AND headers of any 502/504 with
			// its own text page — the client would never see our error (same rule as /api/stream-url).
			// The playability status/reason ride as headers so the NEXT rot is diagnosable from a
			// plain curl instead of a guess (they are upstream strings, header-sanitized in
			// playabilityInfo; visitorData / the signed url are NEVER exposed, T-27-03-02).
			const info = playabilityInfo(json);
			const headers: Record<string, string> = { ...corsHeaders(origin) };
			if (info.status) headers['x-ytmusic-playability'] = info.status;
			if (info.reason) headers['x-ytmusic-reason'] = info.reason;
			return new Response('ytmusic: player not OK', { status: 503, headers });
		}

		// 3. Select the itag-140 AAC direct url (no cipher/throttle). null → 503.
		const streamUrl = selectAudioFormat(json);
		if (!streamUrl) {
			return new Response('ytmusic: no playable AAC format', {
				status: 503,
				headers: corsHeaders(origin)
			});
		}

		// quick-261024-ytu: remember the resolved URL for this PoP BEFORE spending the media
		// fetch, so even a play whose bytes never fully land still arms the fast path for the
		// next invocation. Inline-awaited (a ~1 KB put, milliseconds) — not waitUntil.
		if (cache) {
			try {
				await cache.put(
					urlCacheKey(videoId),
					new Response(streamUrl, {
						headers: {
							'content-type': 'text/plain',
							'Cache-Control': `public, max-age=${URL_CACHE_TTL_S}`
						}
					})
				);
			} catch {
				// a cache write failure must never break playback
			}
		}

		// 4. Proxy the googlevideo bytes in the SAME invocation (IP-lock). We fetch ONLY the
		//    adaptiveFormats url selected above — never a client-supplied URL (no open relay, T-27-03-01).
		try {
			res = await fetchMedia(streamUrl, upstreamHeaders);
		} catch {
			return new Response('ytmusic: upstream error', { status: 503, headers: corsHeaders(origin) });
		}
		if (res.status !== 403) break;
		await res.body?.cancel().catch(() => {});
	}
	if (!res) return new Response('ytmusic: upstream error', { status: 503, headers: corsHeaders(origin) });

	// itag 140 is always AAC/mp4 — set the content-type explicitly (the download flow + <audio> rely on it).
	const outHeaders: Record<string, string> = { ...corsHeaders(origin), 'content-type': 'audio/mp4' };
	if (urlCacheHit) outHeaders['x-ytmusic-urlcache'] = 'hit';
	if (!res.ok) {
		// Upstream error bodies are DROPPED, never relayed: Workers decompress a gzip body but keep the
		// upstream content-length, and that length/body mismatch reached users as Cloudflare's own
		// `error code: 502` (no CORS headers). An empty body with our headers is what the client expects.
		// A 502/504 from upstream must NOT be relayed verbatim either: the edge would replace the
		// body AND headers of our response with its own text page — map them to 503 (passes through
		// intact; the client's ≥500 handling is identical).
		await res.body?.cancel().catch(() => {});
		const status = res.status === 502 || res.status === 504 ? 503 : res.status;
		return new Response(null, { status, headers: outHeaders });
	}
	const acceptRanges = res.headers.get('accept-ranges');
	if (acceptRanges != null) outHeaders['Accept-Ranges'] = acceptRanges;
	const contentLength = res.headers.get('content-length');
	if (contentLength != null) outHeaders['Content-Length'] = contentLength;
	// quick-261024-ytc: if this response is the full file, tee a copy into the audio cache in
	// the background so the NEXT request in this PoP skips the gate entirely.
	const serveBody = storableBody(res, cache, videoId, platform?.ctx);
	// No client Range → the client asked for the whole file: answer 200 without range headers, even
	// though upstream answered our synthesized bytes=0- with a 206.
	if (!range) return new Response(serveBody, { status: 200, headers: outHeaders });
	const contentRange = res.headers.get('content-range');
	if (contentRange != null) outHeaders['Content-Range'] = contentRange;
	return new Response(serveBody, { status: res.status, headers: outHeaders });
};

export const OPTIONS: RequestHandler = ({ request }) => corsPreflight(request);
