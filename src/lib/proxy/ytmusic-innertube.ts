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

/** quick-260925-wa7 — the ONLY search locales a client may ask for; `gl` FOLLOWS `hl` from this table,
 *  it is never a second client-controlled param. zh-TW exists so the Chinese-name rescue
 *  (services/name-rescue.ts) can read YTM's zh-TW title/artist for the same videoId. */
export const INNERTUBE_LOCALES = { en: 'US', 'zh-TW': 'TW' } as const;

/**
 * quick-260925-wa7 — SSRF/param-tampering allowlist (T-wa7-01): map a raw `?hl=` value to an InnerTube
 * `{hl, gl}` pair. Exact OWN-key match only (no trim, no case-fold; hasOwnProperty so 'constructor' /
 * '__proto__' cannot match) — anything else is en/US. The raw query value is never forwarded; only a
 * table-derived pair is.
 */
export function innerTubeLocale(hl: string | null | undefined): { hl: string; gl: string } {
	if (typeof hl === 'string' && Object.prototype.hasOwnProperty.call(INNERTUBE_LOCALES, hl)) {
		return { hl, gl: INNERTUBE_LOCALES[hl as keyof typeof INNERTUBE_LOCALES] };
	}
	return { hl: 'en', gl: 'US' };
}

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

// PLAYER CLIENT = VISIONOS (fast 2026-10-04; was ANDROID_VR since spike 006). YouTube now enforces a
// GVS PoToken on ANDROID_VR 1.65.10 (yt-dlp: "since 2026.08.17, ALL formats are 403'd"): the player
// still says OK, but googlevideo serves only the first ~1.07 MB of itag 140 — a bare GET or the
// `Range: bytes=0-` that <audio> sends is 403, so every ytmusic track failed → cross-source fallback
// (ytmusic is off the auto-resolve floor) → "not found on any source". Bumping ANDROID_VR past 1.65
// returns SABR-only streams, so it is a dead end. VISIONOS is yt-dlp's default JS-less client: no
// PoToken, no signature cipher, direct itag-140 url serving the FULL file (verified 2026-10-04: 206
// for `bytes=0-`, 200 for a bare GET, from a residential IP; bytes are not UA-bound).
// visitorData stays MANDATORY (no visitorData → LOGIN_REQUIRED on VISIONOS too).
// ROTTING PIN (quick-260915-30m): the ONE place the player client lives — the edge stream route AND
// the native resolver (src/lib/services/ytmusic-native.ts) both read it, so one edit fixes both.
// THE FIX WHEN IT ROTS AGAIN: check yt-dlp's INNERTUBE_CLIENTS / _DEFAULT_JSLESS_CLIENTS
// (yt_dlp/extractor/youtube/_base.py + _video.py) for the current no-PoToken, no-JS-player client.
export const PLAYER_CLIENT_VERSION = '1.02';
export const PLAYER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

/** Build the fixed VISIONOS player body. videoId goes ONLY here (no open relay). visitorData is
 *  omitted when null so we never send `"visitorData":null` (which the upstream would reject). */
export function playerBody(videoId: string, visitorData: string | null) {
	const client: Record<string, unknown> = {
		clientName: 'VISIONOS',
		clientVersion: PLAYER_CLIENT_VERSION,
		deviceMake: 'Apple',
		deviceModel: 'RealityDevice17,1',
		osName: 'visionOS',
		osVersion: '26.5.23O471',
		hl: 'en',
		gl: 'US'
	};
	if (visitorData) client.visitorData = visitorData;
	return { context: { client }, videoId, contentCheckOk: true, racyCheckOk: true };
}

/**
 * quick-261029-meta1 — METADATA-ONLY alternate player clients. Description text and
 * caption-track metadata do NOT need a streamable format, so clients that are useless
 * for googlevideo bytes (WEB / WEB_REMIX / ANDROID — byte-walled or PoToken-gated for
 * streaming) are perfectly good metadata sources. Hector's layNDqkZQnQ case proved the
 * point: on a PoP where the VISIONOS player was bot-gated (LOGIN_REQUIRED), the SAME
 * video's description/lyrics 503'd even though other clients could have answered.
 * These bodies are used ONLY by callPlayerForMetadata — never for media bytes.
 */
export const METADATA_PLAYER_CLIENTS = ['WEB_REMIX', 'WEB', 'ANDROID'] as const;
export type MetadataPlayerClient = (typeof METADATA_PLAYER_CLIENTS)[number];

/** Build a metadata player body for an alternate client (see METADATA_PLAYER_CLIENTS). */
export function metadataPlayerBody(videoId: string, client: MetadataPlayerClient) {
	const base: Record<string, unknown> =
		client === 'WEB_REMIX'
			? { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_CONTEXT.client.clientVersion, hl: 'en', gl: 'US' }
			: client === 'WEB'
				? { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' }
				: {
						clientName: 'ANDROID',
						clientVersion: '19.44.38',
						androidSdkVersion: 30,
						deviceModel: 'Pixel 8',
						hl: 'en',
						gl: 'US'
					};
	return { context: { client: base }, videoId, contentCheckOk: true, racyCheckOk: true };
}

/**
 * quick-261029-meta1 — a player response carries USABLE metadata when it is playable
 * (a definitive answer, description possibly empty) OR it carries a non-empty
 * description OR at least one caption track — even when its playability is gated,
 * because the metadata fields ride in the same envelope a gate may still return.
 */
export function hasUsableMetadata(playerJson: unknown): boolean {
	return (
		isPlayable(playerJson) ||
		extractDescription(playerJson).length > 0 ||
		extractCaptionTracks(playerJson).length > 0
	);
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
	/** Pixel dimensions — present on video formats, absent on audio (quick-261024-vid1). */
	width?: number;
	height?: number;
	/** Direct googlevideo URL — present for itag 140 (spike 006: no signatureCipher, no n-throttle). */
	url?: string;
	/** A ciphered format has this INSTEAD of `url`; we ignore it (we solve no signature cipher). */
	signatureCipher?: string;
}
export interface YtPlayerJson {
	playabilityStatus?: { status?: string; reason?: string };
	streamingData?: { adaptiveFormats?: YtAdaptiveFormat[] };
	/** quick-261024-lyr: the lyrics-fallback fields (captions + description). */
	videoDetails?: { shortDescription?: string };
	captions?: {
		playerCaptionsTracklistRenderer?: {
			captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
		};
	};
}

/**
 * True only when `playabilityStatus.status === 'OK'`. LOGIN_REQUIRED / UNPLAYABLE / a bot challenge
 * are all false — the caller retries with a fresh visitorData before giving up (quick-261024-ytg).
 * Pure (spike 006).
 */
export function isPlayable(playerJson: unknown): boolean {
	return (playerJson as YtPlayerJson)?.playabilityStatus?.status === 'OK';
}

/**
 * quick-261024-ytg — the playability status + reason of a player response, for DIAGNOSTICS ONLY
 * (the stream route surfaces them as `x-ytmusic-*` response headers on a 503 so a gated play is
 * debuggable from the outside instead of a bare "player not OK"). Reason is header-sanitized:
 * printable ASCII only, single line, ≤120 chars — a reason can never smuggle a second header.
 * Nulls when the body carries no playabilityStatus at all (a throw / malformed body upstream).
 */
export function playabilityInfo(playerJson: unknown): { status: string | null; reason: string | null } {
	const ps = (playerJson as YtPlayerJson)?.playabilityStatus;
	const clean = (v: unknown): string | null =>
		typeof v === 'string' && v.length > 0
			? v.replace(/[^\x20-\x7E]/g, '?').slice(0, 120)
			: null;
	return { status: clean(ps?.status), reason: clean(ps?.reason) };
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

/** The video pick for the Now Playing video layer (quick-261024-vid1). */
export interface YtVideoPick {
	url: string;
	itag: number;
	height: number;
	/** Full mimeType incl. codecs — the client hands it verbatim to `SourceBuffer`. */
	mimeType: string;
}

/**
 * quick-261024-vid1 — pick the video format for the muted MSE video layer. The VISIONOS
 * player response is DASH-only (verified live 2026-10-24 on 7 MVs: NO progressive itag
 * 18/22 exists), so the layer must mux a video-only format itself. Policy:
 *  - direct `url` only (never a ciphered format);
 *  - `video/mp4` + avc1 ONLY — vp9/av01 break Safari's MSE, and the layer must degrade to
 *    the cover there, not to a black rectangle;
 *  - video-only (carries a height; audio formats never do);
 *  - prefer the highest rung at or below 720p (data + decode sanity), tie-break bitrate;
 *    if every avc rung is above 720p, take the smallest of them rather than nothing.
 * Returns the full pick (the client needs the exact codec string for its SourceBuffer).
 */
/** One caption track from the player response (quick-261024-lyr). */
export interface YtCaptionTrack {
	baseUrl: string;
	languageCode: string;
	/** 'asr' for auto-generated; absent for a human-uploaded track. */
	kind?: string;
}

/**
 * quick-261024-lyr — the caption tracks of a player response, validated: the timedtext
 * URL must be YouTube's own endpoint (the route fetches it — never fetch an arbitrary URL
 * a response handed us).
 */
export function extractCaptionTracks(playerJson: unknown): YtCaptionTrack[] {
	const tracks = (playerJson as YtPlayerJson)?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
	return tracks.filter(
		(c): c is YtCaptionTrack =>
			typeof c?.baseUrl === 'string' &&
			c.baseUrl.startsWith('https://www.youtube.com/api/timedtext') &&
			typeof c?.languageCode === 'string'
	);
}

/**
 * quick-261024-lyr — which caption track serves as lyrics: a HUMAN track beats ASR at any
 * language; within a class, Traditional Chinese (Hant/HK/TW) > Simplified > other zh >
 * English > anything. Null for an empty list.
 */
export function pickCaptionTrack(tracks: YtCaptionTrack[]): YtCaptionTrack | null {
	if (tracks.length === 0) return null;
	const langRank = (code: string): number => {
		const c = code.toLowerCase();
		if (c === 'zh-hant' || c.startsWith('zh-hk') || c.startsWith('zh-tw')) return 0;
		if (c === 'zh-hans' || c.startsWith('zh-cn') || c.startsWith('zh-sg')) return 1;
		if (c.startsWith('zh')) return 2;
		if (c.startsWith('en')) return 3;
		return 4;
	};
	const score = (c: YtCaptionTrack) => (c.kind === 'asr' ? 10 : 0) + langRank(c.languageCode);
	return [...tracks].sort((a, b) => score(a) - score(b))[0];
}

/** quick-261024-lyr — the video description (videoDetails.shortDescription), trimmed. */
export function extractDescription(playerJson: unknown): string {
	return ((playerJson as YtPlayerJson)?.videoDetails?.shortDescription ?? '').trim();
}

interface CaptionJson3 {
	events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

/**
 * quick-261024-lyr — timedtext `fmt=json3` → LRC text for the lyrics tab. Events without
 * segments (window/style definitions) and blank lines drop out; consecutive duplicate
 * lines collapse (ASR roll-up repeats itself); a `\n` inside an event flattens to a
 * space. Returns null when fewer than 4 usable lines survive — a track with a couple of
 * caption fragments is not lyrics, and the caller falls through to the description.
 */
export function captionsToLrc(json3: unknown): string | null {
	const events = (json3 as CaptionJson3)?.events ?? [];
	const pad = (n: number) => String(n).padStart(2, '0');
	const lines: string[] = [];
	for (const e of events) {
		const text = (e?.segs ?? []).map((seg) => seg?.utf8 ?? '').join('').replace(/\s*\n\s*/g, ' ').trim();
		if (!text) continue;
		if (lines.length > 0 && lines[lines.length - 1].endsWith(text)) continue;
		const ms = typeof e?.tStartMs === 'number' ? e.tStartMs : 0;
		const stamp = `[${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor(ms / 10) % 100)}]`;
		lines.push(`${stamp}${text}`);
	}
	return lines.length >= 4 ? lines.join('\n') : null;
}

export function selectVideoFormat(playerJson: unknown, maxHeight = 720): YtVideoPick | null {
	const formats = (playerJson as YtPlayerJson)?.streamingData?.adaptiveFormats ?? [];
	const candidates = formats.filter(
		(f) =>
			typeof f?.url === 'string' &&
			f.url.length > 0 &&
			typeof f?.itag === 'number' &&
			typeof f?.height === 'number' &&
			f.height > 0 &&
			(f?.mimeType ?? '').startsWith('video/mp4') &&
			(f?.mimeType ?? '').includes('avc1')
	) as (YtAdaptiveFormat & { url: string; itag: number; height: number })[];
	if (candidates.length === 0) return null;
	const byHeightThenBitrate = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
		a.height - b.height || (a.bitrate ?? 0) - (b.bitrate ?? 0);
	const atOrBelowCap = candidates.filter((f) => f.height <= maxHeight).sort(byHeightThenBitrate);
	const pick = atOrBelowCap.length > 0 ? atOrBelowCap[atOrBelowCap.length - 1] : candidates.sort(byHeightThenBitrate)[0];
	return { url: pick.url, itag: pick.itag, height: pick.height, mimeType: pick.mimeType ?? 'video/mp4' };
}
