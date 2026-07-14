// YouTube Music STREAM byte-proxy (Plan 27-03, YT-PLAY-01 / YT-DOWNLOAD-01) — THE WALL (spike 006).
//
// GET /api/ytmusic/stream/:videoId — the money route. It POSTs the InnerTube ANDROID_VR `player`
// endpoint (clientVersion 1.60.19 + a cached anonymous visitorData token) edge-side, selects itag 140
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
//  - bot gate (T-27-03-04): ANDROID_VR + cached visitorData clears the gate anonymously;
//    refresh-once-then-502 avoids hammering a challenging upstream (never hang).
import type { RequestHandler } from './$types';
import { corsHeaders, fetchWithRetry } from '$lib/proxy/http';
// selectAudioFormat + isPlayable live in the shared proxy module, NOT here: SvelteKit `+server.ts`
// only permits HTTP-verb (or `_`-prefixed) exports, so a top-level `export function` in this route
// throws `Invalid export` at request time (quick-270715 — caught by E2E, missed by the fixture unit
// test which imported the module directly).
import {
	getVisitorData,
	innerTubePost,
	isPlayable,
	selectAudioFormat,
	PLAYER_URL
} from '$lib/proxy/ytmusic';

// ANDROID_VR client (spike 006 — the ONLY context that returns playabilityStatus OK from a
// datacenter IP once a visitorData token is attached). UA must match the VR client or the gate re-fires.
const ANDROID_VR_UA =
	'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; Quest 3) gzip';
const PLAYER_TIMEOUT_MS = 15000; // player JSON hop
const MEDIA_TIMEOUT_MS = 15000; // googlevideo bytes are heavier than JSON (audius posture)

/** Build the fixed ANDROID_VR player body. videoId goes ONLY here (no open relay). visitorData is
 *  omitted when null so we never send `"visitorData":null` (which the upstream would reject). */
function playerBody(videoId: string, visitorData: string | null) {
	const client: Record<string, unknown> = {
		clientName: 'ANDROID_VR',
		clientVersion: '1.60.19',
		androidSdkVersion: 32,
		deviceModel: 'Quest 3',
		hl: 'en',
		gl: 'US'
	};
	if (visitorData) client.visitorData = visitorData;
	return { context: { client }, videoId, contentCheckOk: true, racyCheckOk: true };
}

/** POST the ANDROID_VR player. Returns the parsed JSON, or null on an upstream throw (so the caller
 *  can gate on isPlayable and refresh/502 rather than crash). */
async function callPlayer(videoId: string, visitorData: string | null): Promise<unknown> {
	try {
		return await innerTubePost(PLAYER_URL, playerBody(videoId, visitorData), {
			headers: { 'user-agent': ANDROID_VR_UA },
			signal: AbortSignal.timeout(PLAYER_TIMEOUT_MS)
		});
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ params, request }) => {
	const origin = request.headers.get('origin');
	const videoId = (params.videoId ?? '').trim();
	if (!videoId) return new Response('missing videoId', { status: 400, headers: corsHeaders(origin) });

	// 1. ANDROID_VR player POST with the cached anonymous visitorData.
	let json = await callPlayer(videoId, await getVisitorData());

	// 2. Bot gate / expiry → refresh visitorData ONCE and retry the player POST once. Never hang.
	if (!isPlayable(json)) {
		json = await callPlayer(videoId, await getVisitorData(true));
		if (!isPlayable(json)) {
			// Still not OK → 502 so the client's cross-source fallback engages.
			return new Response('ytmusic: player not OK', { status: 502, headers: corsHeaders(origin) });
		}
	}

	// 3. Select the itag-140 AAC direct url (no cipher/throttle). null → 502.
	const streamUrl = selectAudioFormat(json);
	if (!streamUrl) {
		return new Response('ytmusic: no playable AAC format', {
			status: 502,
			headers: corsHeaders(origin)
		});
	}

	// 4. Proxy the googlevideo bytes in the SAME invocation (IP-lock). RAW edge fetch (fetchWithRetry)
	//    — NEVER the client fetch governor (api-base): a long-lived media stream must not hold a
	//    governor slot (T-27-03-03). We fetch ONLY the adaptiveFormats url selected above — never a
	//    client-supplied URL (no open relay, T-27-03-01).
	const upstreamHeaders: Record<string, string> = {};
	const range = request.headers.get('range');
	if (range) upstreamHeaders['Range'] = range; // forward Range so googlevideo serves a 206

	try {
		const res = await fetchWithRetry(
			streamUrl,
			{ redirect: 'follow', signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS), headers: upstreamHeaders },
			1
		);
		// itag 140 is always AAC/mp4 — set the content-type explicitly (the download flow + <audio> rely
		// on it). Propagate range headers only when present so 206 + <audio> seeking work end-to-end.
		const outHeaders: Record<string, string> = {
			...corsHeaders(origin),
			'content-type': 'audio/mp4'
		};
		const acceptRanges = res.headers.get('accept-ranges');
		if (acceptRanges != null) outHeaders['Accept-Ranges'] = acceptRanges;
		const contentRange = res.headers.get('content-range');
		if (contentRange != null) outHeaders['Content-Range'] = contentRange;
		const contentLength = res.headers.get('content-length');
		if (contentLength != null) outHeaders['Content-Length'] = contentLength;

		return new Response(res.body, { status: res.status, headers: outHeaders });
	} catch {
		return new Response('ytmusic: upstream error', { status: 502, headers: corsHeaders(origin) });
	}
};

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};
