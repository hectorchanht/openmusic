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
import { corsHeaders, fetchWithRetry, corsPreflight } from '$lib/proxy/http';
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
	playerBody,
	getVisitorData,
	innerTubePost,
	isPlayable,
	playabilityInfo,
	selectAudioFormat,
	PLAYER_UA,
	PLAYER_URL
} from '$lib/proxy/ytmusic';

const PLAYER_TIMEOUT_MS = 15000; // player JSON hop
// HEADERS-only deadline for the googlevideo hop: the timer is cleared once headers arrive, so the
// body streams uncapped (the quick-260930-x3q posture — Workers bill CPU, not wall time). The old
// whole-request AbortSignal.timeout(15 s) cut every range-less download at ~470 KB.
const MEDIA_HEAD_TIMEOUT_MS = 15000;
// googlevideo 403s ~1 in 6 edge byte fetches (sampled on prod 2026-10-04) even though the player said
// OK — the url is IP-locked and a Worker's subrequests do not always leave from the same IP. A fresh
// player call gets a fresh url, so retry the whole player→bytes hop on a 403.
const URL_ATTEMPTS = 3;
// quick-261024-ytg: the PLAYER call itself is bot-gated per subrequest — ~40% of live stream
// requests came back `player not OK` (12-request sample 2026-10-24: 5× 503; a second track: 4/8),
// while the identical VISIONOS call from a residential IP was 10/10 OK. The old shape made ONE
// cached-token call + ONE refresh and then 503'd — a coin flip per click ("plays on the 2nd/3rd
// click", per the user report). Each retry below uses a FRESH visitorData (a new subrequest can
// egress un-gated, same premise as the media-403 retry above), with a short escalating pause.
const PLAYER_GATE_ATTEMPTS = 3; // total player calls per media attempt: cached token + 2 fresh
const GATE_DELAY_MS = [250, 500]; // pause before gate retry 1 / 2

const gateDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/** POST the VISIONOS player. Returns the parsed JSON, or null on an upstream throw (so the caller
 *  can gate on isPlayable and refresh/503 rather than crash).
 *
 *  quick-261006-r2: `visitorData` arrives as a PROMISE and is awaited INSIDE the try. The old shape
 *  (`callPlayer(videoId, await getVisitorData())`) evaluated the await while building the arguments
 *  — OUTSIDE this try/catch — so a getVisitorData() throw was a real uncaught crash (a platform 502),
 *  not the graceful null this docstring promises. */
async function callPlayer(videoId: string, visitorData: Promise<string | null>): Promise<unknown> {
	try {
		return await innerTubePost(PLAYER_URL, playerBody(videoId, await visitorData), {
			headers: { 'user-agent': PLAYER_UA },
			signal: AbortSignal.timeout(PLAYER_TIMEOUT_MS)
		});
	} catch {
		return null;
	}
}

/**
 * quick-261024-ytg — one player call, retried on a non-OK playability with a FRESH visitorData
 * each time (see PLAYER_GATE_ATTEMPTS). First call uses the cached token (the fast, usually-OK
 * path — a gated token costs one refresh, not a cold grab per play). Returns the LAST player
 * response seen, playable or not, so the caller can gate / diagnose on it.
 */
async function callPlayerGated(videoId: string): Promise<unknown> {
	let json = await callPlayer(videoId, getVisitorData());
	for (let gate = 1; !isPlayable(json) && gate < PLAYER_GATE_ATTEMPTS; gate++) {
		await gateDelay(GATE_DELAY_MS[gate - 1] ?? 500);
		json = await callPlayer(videoId, getVisitorData(true));
	}
	return json;
}

/** One googlevideo byte fetch with a HEADERS-only deadline (see MEDIA_HEAD_TIMEOUT_MS). RAW edge
 *  fetch (fetchWithRetry) — NEVER the client fetch governor (api-base): a long-lived media stream
 *  must not hold a governor slot (T-27-03-03). */
async function fetchMedia(url: string, headers: Record<string, string>): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), MEDIA_HEAD_TIMEOUT_MS);
	try {
		return await fetchWithRetry(url, { redirect: 'follow', signal: ctrl.signal, headers }, 1);
	} finally {
		clearTimeout(timer);
	}
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
	for (let attempt = 0; attempt < URL_ATTEMPTS; attempt++) {
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
