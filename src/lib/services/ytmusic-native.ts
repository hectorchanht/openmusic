// NATIVE-ONLY YouTube Music stream resolver — the DEVICE performs both InnerTube hops itself
// (quick-260915-3ng).
//
// WHY. googlevideo signs the itag-140 url with `ip` inside `sparams` (no `ipbits`), i.e. FULL-IP-
// locked to whoever called `player`. When the Cloudflare edge makes the player call and then fetches
// the bytes from that same datacenter IP, googlevideo refuses them with 403 (observed in production:
// the 403 carries OUR step-4 `content-type: audio/mp4` + `content-length: 0`, proving the player call
// itself SUCCEEDED and only the byte fetch was refused). The identical chain from a residential IP
// returns 206 with real bytes. A browser can never make the player call either — InnerTube sends no
// CORS headers and actively rejects an `Origin: https://openmusic.lol` POST with 403. So on native we
// make the PHONE the InnerTube client via CapacitorHttp, which bypasses WebView CORS and lets us set
// `origin` / `user-agent`. The url comes back signed for the phone's own IP, and `<audio src=…>` plays
// it directly — googlevideo sends no ACAO, but a media element performs no CORS check.
//
// ZERO auth: anonymous visitorData token only. No OAuth, no cookie, no PoToken, no account. Account /
// library sync remains a separate legal-gated milestone (spike 008).
//
// DELIBERATE: CapacitorHttp is called EXPLICITLY at this ONE site. The global CapacitorHttp
// fetch/XHR patch in capacitor.config.ts is NOT enabled — turning it on would silently reroute every
// request in the app through the native bridge.
//
// This module is native-only by CALLER CONTRACT: src/lib/sources/ytmusic.ts guards the call with
// Capacitor.isNativePlatform(). It does not re-check.
import { CapacitorHttp } from '@capacitor/core';
import {
	androidVrPlayerBody,
	extractVisitorData,
	isPlayable,
	selectAudioFormat,
	ANDROID_VR_UA,
	INNERTUBE_HEADERS,
	PLAYER_URL,
	SEARCH_URL,
	WEB_REMIX_CONTEXT
} from '$lib/proxy/ytmusic-innertube';

// Anonymous visitor token, memory-only (never persisted, never sent to our own edge). TTL mirrors the
// edge's VISITOR_TTL_MS in proxy/ytmusic.ts; the primary refresh path is the explicit retry below.
let cachedVisitorData: string | null = null;
let cachedVisitorAt = 0;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000; // ~6h
// Per-hop ceiling (mirrors the stream route's PLAYER_TIMEOUT_MS) so a hung upstream cannot hang
// resolve() — HttpOptions exposes no AbortSignal, so this timeout IS the only hard stop.
const HOP_TIMEOUT_MS = 15000;

/** One InnerTube POST over the native bridge. NEVER throws: a rejected bridge call, a non-2xx status
 *  or an unparseable body all return null. `data` arrives pre-parsed when the upstream sets a json
 *  content-type, and as a raw string otherwise — handle both. */
async function post(
	url: string,
	data: unknown,
	headers: Record<string, string>
): Promise<unknown> {
	try {
		const res = await CapacitorHttp.post({
			url,
			method: 'POST',
			headers,
			data,
			connectTimeout: HOP_TIMEOUT_MS,
			readTimeout: HOP_TIMEOUT_MS
		});
		if (!(res.status >= 200 && res.status < 300)) return null;
		if (typeof res.data === 'string') {
			try {
				return JSON.parse(res.data);
			} catch {
				return null;
			}
		}
		return res.data;
	} catch {
		return null;
	}
}

/** Cached anonymous visitorData. `refresh` forces a live grab (the bot gate fired). Null on a miss. */
async function getVisitorData(refresh: boolean): Promise<string | null> {
	if (!refresh && cachedVisitorData !== null && Date.now() - cachedVisitorAt < VISITOR_TTL_MS) {
		return cachedVisitorData;
	}
	const json = await post(SEARCH_URL, { context: WEB_REMIX_CONTEXT, query: 'music' }, INNERTUBE_HEADERS);
	const vd = extractVisitorData(json);
	if (vd) {
		cachedVisitorData = vd;
		cachedVisitorAt = Date.now();
	} else {
		// A miss means the cached token (if any) is suspect — drop it rather than reuse it.
		cachedVisitorData = null;
	}
	return vd;
}

/** POST the ANDROID_VR player. videoId goes ONLY into the fixed body (no open relay, T-3ng-02). */
function callPlayer(videoId: string, visitorData: string | null): Promise<unknown> {
	return post(PLAYER_URL, androidVrPlayerBody(videoId, visitorData), {
		...INNERTUBE_HEADERS,
		'user-agent': ANDROID_VR_UA
	});
}

/**
 * Resolve a videoId to a DIRECT googlevideo itag-140 url signed for THIS device's IP, or null.
 *
 * NEVER throws — every failure (bridge rejection, non-2xx, malformed JSON, bot gate, ciphered-only
 * formats) returns null so the caller falls back to the edge proxy path. Refresh-once-then-null
 * mirrors the edge route's refresh-once-then-502 posture: never hammer a challenging upstream, never
 * hang, never loop.
 *
 * HttpOptions carries no AbortSignal, so `signal` is checked BETWEEN hops only: a superseded resolve
 * wastes at most one in-flight native request and never stamps a stale track.
 */
export async function nativeResolveStreamUrl(
	videoId: string,
	signal: AbortSignal
): Promise<string | null> {
	try {
		let vd = await getVisitorData(false);
		if (signal.aborted) return null;
		let json = await callPlayer(videoId, vd);
		if (signal.aborted) return null;

		if (!isPlayable(json)) {
			// Bot gate / expired token → refresh the token ONCE and retry the player ONCE.
			vd = await getVisitorData(true);
			if (signal.aborted) return null;
			json = await callPlayer(videoId, vd);
			if (signal.aborted) return null;
			if (!isPlayable(json)) return null;
		}
		return selectAudioFormat(json);
	} catch {
		return null;
	}
}

/** Test hook — drops the module-scope token (house precedent: __resetGovernor in api-base.ts). */
export function __resetNativeVisitorCache(): void {
	cachedVisitorData = null;
	cachedVisitorAt = 0;
}
