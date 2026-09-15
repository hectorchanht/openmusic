// PURE InnerTube primitives — data + pure functions ONLY, dependency-free and CLIENT-IMPORTABLE.
//
// Carved out of ./ytmusic.ts + the /api/ytmusic/stream/[videoId] route for quick-260915-3ng so the
// native on-device resolver (src/lib/services/ytmusic-native.ts) and the edge stream route share ONE
// copy of every InnerTube constant — above all the ANDROID_VR version pin, whose two-place drift was
// the bug fixed in quick-260915-30m.
//
// This module MUST stay import-free: no edge fetch/cache helper, no SvelteKit app module, no native
// bridge. That is the whole point — none of those may be dragged into the client bundle.
// Client code importing from $lib/proxy/* has precedent: src/lib/services/track-ready.ts imports
// RESOLVE_URL_TTL_S from $lib/proxy/resolve-cache.

// --- Verified InnerTube constants (spikes 005/006/007) — SCREAMING_SNAKE, one rotation point. ---

/** WEB_REMIX key — PUBLIC: it ships in YouTube Music's own web client JS, so it is not a secret and
 *  carries no account/user identity. As of quick-260915-3ng it also ships in the NATIVE bundle,
 *  because on the APK the device itself is the InnerTube client (see services/ytmusic-native.ts).
 *  What holds regardless: (a) no /api/ytmusic response body ever echoes the key or visitorData,
 *  (b) ZERO auth — anonymous visitor token only, no OAuth/cookie/PoToken, (c) ONE rotation point. */
export const WEB_REMIX_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

/** InnerTube client context interface — WEB_REMIX for metadata; the optional fields (visitorData /
 *  androidSdkVersion / deviceModel) let the player context be built with the same shape. */
export interface InnerTubeContext {
	client: {
		clientName: string;
		clientVersion: string;
		hl: string;
		gl: string;
		visitorData?: string;
		androidSdkVersion?: number;
		deviceModel?: string;
	};
}

/** Anonymous WEB_REMIX metadata context (spike 005). Metadata endpoints are NOT bot-gated, so
 *  search/lyrics need no visitorData at all — only the `player` call does. */
export const WEB_REMIX_CONTEXT: InnerTubeContext = {
	client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' }
};

// Endpoint URLs (key appended in the URL). music.youtube.com for the metadata endpoints
// (spikes 005/007); www.youtube.com for the player/stream endpoint (spike 006).
export const SEARCH_URL =
	'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=' + WEB_REMIX_KEY;
/** Player endpoint (spike 006) — used by the edge stream route AND the native resolver. */
export const PLAYER_URL =
	'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + WEB_REMIX_KEY;

/** Base headers every InnerTube POST carries (origin/referer make the request look like the web
 *  client). A caller may add/override (e.g. the ANDROID_VR user-agent) on top of this spread. */
export const INNERTUBE_HEADERS: Record<string, string> = {
	'content-type': 'application/json',
	origin: 'https://music.youtube.com',
	referer: 'https://music.youtube.com/'
};

// ANDROID_VR client (spike 006 — the ONLY context that returns playabilityStatus OK from a
// datacenter IP once a visitorData token is attached). UA must match the VR client or the gate re-fires.
// ROTTING VERSION PIN (quick-260915-30m) — the ONE place the ANDROID_VR client version lives (the UA
// string and androidVrPlayerBody() both read it, so the two pins can no longer drift apart). YouTube
// gates STALE ANDROID_VR clientVersions with `playabilityStatus.status === 'LOGIN_REQUIRED'` ("Sign in
// to confirm you're not a bot") and zero adaptiveFormats, so isPlayable() is false on BOTH the initial
// player call and the visitorData-refresh retry → the stream route hard-502s → the client's
// cross-source fallback trips and EVERY ytmusic track is silently skipped (diag symptom:
// `resolve.ok hasUrl:true` → `src.set` → `audio.error hasPlayed:false` → advance, never `playing`).
// THE FIX WHEN IT ROTS AGAIN: bump this to a current ANDROID_VR release. The prior 1.60.x pin died
// 2026-09; 1.65.10 verified OK (22 adaptiveFormats, itag-140 direct url serving 206 audio/mp4).
// Isolation-tested: the version ALONE flips LOGIN_REQUIRED→OK; UA/osName/osVersion are irrelevant;
// visitorData stays MANDATORY (no visitorData → LOGIN_REQUIRED even on 1.65.10).
// quick-260915-3ng: the native resolver (src/lib/services/ytmusic-native.ts) reads this SAME
// constant, so bumping it here fixes BOTH the edge route and the APK in one edit.
export const ANDROID_VR_VERSION = '1.65.10';
export const ANDROID_VR_UA = `com.google.android.apps.youtube.vr.oculus/${ANDROID_VR_VERSION} (Linux; U; Android 12; Quest 3) gzip`;

/** Build the fixed ANDROID_VR player body. videoId goes ONLY here (no open relay). visitorData is
 *  omitted when null so we never send `"visitorData":null` (which the upstream would reject). */
export function androidVrPlayerBody(videoId: string, visitorData: string | null) {
	const client: Record<string, unknown> = {
		clientName: 'ANDROID_VR',
		clientVersion: ANDROID_VR_VERSION,
		androidSdkVersion: 32,
		deviceModel: 'Quest 3',
		hl: 'en',
		gl: 'US'
	};
	if (visitorData) client.visitorData = visitorData;
	return { context: { client }, videoId, contentCheckOk: true, racyCheckOk: true };
}

/** Pull the anonymous visitor token out of ANY InnerTube response envelope. One copy of the walk —
 *  the edge getVisitorData() and the native resolver both call it (quick-260915-3ng). */
export function extractVisitorData(json: unknown): string | null {
	return (
		(json as { responseContext?: { visitorData?: string } })?.responseContext?.visitorData ?? null
	);
}

// --- Player-response helpers (Plan 27-03 stream route). These live HERE, not in the +server.ts
// route, because SvelteKit `+server.ts` only permits HTTP-verb (or `_`-prefixed) exports — a
// top-level `export function selectAudioFormat` in the route throws `Invalid export` at request
// time (caught by E2E, not by the fixture unit test which imports the module directly). Keeping
// them in a shared module also matches the project convention of extracting pure, testable
// logic out of the endpoint. ---

/** Untrusted InnerTube player-response shapes — every field optional, accessed via optional
 *  chaining (no `as any`, mirroring the search-adapter + lyrics-walker typing in proxy/ytmusic.ts). */
export interface YtAdaptiveFormat {
	itag?: number;
	mimeType?: string;
	bitrate?: number;
	/** Direct googlevideo URL — present for itag 140 (spike 006: no signatureCipher, no n-throttle). */
	url?: string;
	/** A ciphered format has this INSTEAD of `url`; we ignore it (we solve no signature cipher). */
	signatureCipher?: string;
}
export interface YtPlayerJson {
	playabilityStatus?: { status?: string; reason?: string };
	streamingData?: { adaptiveFormats?: YtAdaptiveFormat[] };
}

/**
 * True only when `playabilityStatus.status === 'OK'`. LOGIN_REQUIRED / UNPLAYABLE / a bot challenge
 * are all false — the caller refreshes visitorData once then gives up. Pure (spike 006).
 */
export function isPlayable(playerJson: unknown): boolean {
	return (playerJson as YtPlayerJson)?.playabilityStatus?.status === 'OK';
}

/**
 * Pick the streamable audio URL from a player response's adaptiveFormats:
 *   1. itag 140 (AAC-LC / mp4, 128 kbps) with a direct `url` — the codec iOS Safari `<audio>` plays
 *      (Opus/webm itag 251 does NOT play in Safari, so it is NEVER chosen).
 *   2. else the highest-bitrate `audio/mp4` format with a direct `url` (a safety fallback).
 *   3. else null (no playable AAC — the caller 502s / returns null so cross-source fallback engages).
 * Ciphered formats (signatureCipher, no `url`) are ignored — we solve no signature cipher (spike 006).
 */
export function selectAudioFormat(playerJson: unknown): string | null {
	const formats = (playerJson as YtPlayerJson)?.streamingData?.adaptiveFormats ?? [];

	// 1. itag 140 = AAC-LC/mp4 128k — the primary pick (spike 006).
	const itag140 = formats.find(
		(f) => f?.itag === 140 && typeof f?.url === 'string' && f.url.length > 0
	);
	if (itag140?.url) return itag140.url;

	// 2. Fallback: highest-bitrate audio/mp4 with a DIRECT url (never Opus/webm, never ciphered).
	const mp4 = formats
		.filter(
			(f) =>
				typeof f?.url === 'string' &&
				f.url.length > 0 &&
				(f?.mimeType ?? '').startsWith('audio/mp4')
		)
		.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));

	return mp4[0]?.url ?? null;
}
