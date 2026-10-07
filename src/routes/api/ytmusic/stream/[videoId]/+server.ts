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
//    refresh-once-then-503 avoids hammering a challenging upstream (never hang).
import type { RequestHandler } from './$types';
import { corsHeaders, fetchWithRetry } from '$lib/proxy/http';
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

export const GET: RequestHandler = async ({ params, request }) => {
	const origin = request.headers.get('origin');
	const videoId = (params.videoId ?? '').trim();
	if (!videoId) return new Response('missing videoId', { status: 400, headers: corsHeaders(origin) });

	// googlevideo throttles a range-less GET to a trickle but serves `Range: bytes=0-` at full speed, so
	// a range-less request (the download path) asks upstream for bytes=0- and answers the client a
	// plain 200 below. A client Range (<audio> seeking) is forwarded verbatim.
	const range = request.headers.get('range');
	const upstreamHeaders: Record<string, string> = { Range: range ?? 'bytes=0-' };

	let res: Response | null = null;
	for (let attempt = 0; attempt < URL_ATTEMPTS; attempt++) {
		// 1. VISIONOS player POST with the cached anonymous visitorData. The promise goes IN —
		// the await lives inside callPlayer's try, so a visitorData throw is a graceful null,
		// not an uncaught crash (quick-261006-r2).
		let json = await callPlayer(videoId, getVisitorData());

		// 2. Bot gate / expiry → refresh visitorData ONCE and retry the player POST once. Never hang.
		if (!isPlayable(json)) {
			json = await callPlayer(videoId, getVisitorData(true));
			if (!isPlayable(json)) {
				// Still not OK → 503 so the client's cross-source fallback engages. Never 502/504:
				// Cloudflare's edge replaces the body AND headers of any 502/504 with its own text
				// page — the client would never see our error (same rule as /api/stream-url).
				return new Response('ytmusic: player not OK', { status: 503, headers: corsHeaders(origin) });
			}
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
	// No client Range → the client asked for the whole file: answer 200 without range headers, even
	// though upstream answered our synthesized bytes=0- with a 206.
	if (!range) return new Response(res.body, { status: 200, headers: outHeaders });
	const contentRange = res.headers.get('content-range');
	if (contentRange != null) outHeaders['Content-Range'] = contentRange;
	return new Response(res.body, { status: res.status, headers: outHeaders });
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
