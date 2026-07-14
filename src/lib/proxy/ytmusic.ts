// Shared YouTube Music (InnerTube) edge module — the ONE place that owns the verified InnerTube
// constants + the low-level POST/visitorData/lyrics-parse helpers reused by the /api/ytmusic/*
// routes (search + lyrics here in Plan 27-02; the stream route imports getVisitorData in 27-03).
//
// ZERO auth: only the PUBLIC WEB_REMIX key + the anonymous client context. `getVisitorData()` grabs
// an ANONYMOUS InnerTube visitor token (responseContext.visitorData) — NOT a user credential, NOT
// account auth. No OAuth / device-flow / cookie / user-token / library-sync code lives here or
// anywhere in Plan 27 (spike 008 is a separate, later, legal-gated milestone).
//
// Everything here is SERVER-SIDE (Cloudflare edge / SvelteKit endpoint): it uses the RAW edge fetch
// via fetchWithRetry — NEVER apiFetch (apiFetch is the CLIENT governor seam and must not run
// edge-side). The WEB_REMIX key + visitorData stay edge-side; no /api/ytmusic response body ever
// echoes them to the client (threat T-27-02-02).
import { fetchWithRetry } from './http';
import { edgeCache } from './edge-cache';

// --- Verified InnerTube constants (spikes 005/006/007) — SCREAMING_SNAKE, one rotation point. ---

/** Public WEB_REMIX key shipped in the YTM web client — NOT a secret, but kept edge-side so no
 *  /api/ytmusic response leaks it and there is a single place to rotate (spikes 005/006/007). */
export const WEB_REMIX_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

/** InnerTube `params` for the search "Songs" chip — a clean song shelf, no Top-result/Videos/Albums
 *  noise. Verbatim from spike 005 (sent as-is in the POST body; the upstream accepts it, status 200). */
export const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

/** InnerTube client context interface — WEB_REMIX for metadata; the optional fields (visitorData /
 *  androidSdkVersion / deviceModel) let Plan 27-03 build the ANDROID_VR player context of the same
 *  shape. */
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
 *  search/lyrics need no visitorData at all — only the stream `player` call (27-03) does. */
export const WEB_REMIX_CONTEXT: InnerTubeContext = {
	client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' }
};

// Endpoint URLs (key appended server-side; the client never sees these). music.youtube.com for the
// metadata endpoints (spikes 005/007); www.youtube.com for the player/stream endpoint (spike 006).
export const SEARCH_URL =
	'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=' + WEB_REMIX_KEY;
export const NEXT_URL =
	'https://music.youtube.com/youtubei/v1/next?prettyPrint=false&key=' + WEB_REMIX_KEY;
export const BROWSE_URL =
	'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&key=' + WEB_REMIX_KEY;
/** Player endpoint (spike 006) — used by the Plan 27-03 stream route, exported here so the key +
 *  URL live in ONE place. */
export const PLAYER_URL =
	'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + WEB_REMIX_KEY;

// Base headers every InnerTube POST carries (origin/referer make the request look like the web
// client). A caller may add/override (e.g. the ANDROID_VR user-agent in 27-03) via opts.headers.
const INNERTUBE_HEADERS: Record<string, string> = {
	'content-type': 'application/json',
	origin: 'https://music.youtube.com',
	referer: 'https://music.youtube.com/'
};
const INNERTUBE_TIMEOUT_MS = 12000;
// Adversarial upstream (spike 006 note): one retry on 429/5xx is enough for a metadata hop; the
// route maps a final failure to its own sentinel (empty envelope / {} / null visitorData).
const INNERTUBE_RETRIES = 1;

// --- visitorData cache (edge-managed, NEVER exposed to the client). Module-scope var + timestamp
// survives across requests in one worker; edgeCache() (when present) shares it across invocations.
// A `refresh` clears it (27-03 refreshes on LOGIN_REQUIRED / expiry). ---
let cachedVisitorData: string | null = null;
let cachedVisitorAt = 0;
// Soft staleness ceiling; the primary refresh path is the explicit `refresh` flag.
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000; // ~6h
// Synthetic own-origin key for the Cloudflare edge cache (never the key-bearing upstream URL).
const VISITOR_CACHE_KEY = new Request('https://openmusic.lol/__ytmusic__/visitorData');

export interface InnerTubePostOptions {
	signal?: AbortSignal;
	headers?: Record<string, string>;
}

// --- Untrusted InnerTube JSON shapes for the lyrics walkers (every field optional; accessed via
// optional chaining — no `as any`, mirroring the search-adapter typing in src/lib/sources/ytmusic.ts). ---
interface YtTabRenderer {
	title?: string;
	endpoint?: { browseEndpoint?: { browseId?: string } };
}
interface YtNextJson {
	contents?: {
		singleColumnMusicWatchNextResultsRenderer?: {
			tabbedRenderer?: {
				watchNextTabbedResultsRenderer?: { tabs?: Array<{ tabRenderer?: YtTabRenderer }> };
			};
		};
	};
}
interface YtLyricRun {
	text?: string;
}
interface YtDescriptionShelf {
	description?: { runs?: YtLyricRun[] };
	footer?: { runs?: YtLyricRun[] };
}

/**
 * POST a JSON body to an InnerTube endpoint (RAW edge fetch via fetchWithRetry — never apiFetch).
 * Returns the parsed JSON. A non-OK response THROWS so the caller can pick its own sentinel rather
 * than silently returning garbage. The thrown message strips the query string so the key never
 * lands in a log (threat T-27-02-02).
 */
export async function innerTubePost(
	url: string,
	body: unknown,
	opts: InnerTubePostOptions = {}
): Promise<unknown> {
	const headers = { ...INNERTUBE_HEADERS, ...(opts.headers ?? {}) };
	// Native AbortSignal.timeout (RESEARCH "Don't Hand-Roll") — caller may pass its own.
	const signal = opts.signal ?? AbortSignal.timeout(INNERTUBE_TIMEOUT_MS);
	const res = await fetchWithRetry(
		url,
		{ method: 'POST', headers, body: JSON.stringify(body), signal },
		INNERTUBE_RETRIES
	);
	if (!res.ok) {
		// Drain so the connection can be reused, then surface. Strip the query-string from the
		// message so the key in `?key=` never lands in a log (threat T-27-02-02).
		await res.body?.cancel().catch(() => {});
		throw new Error(`ytmusic: InnerTube POST ${url.split('?')[0]} -> HTTP ${res.status}`);
	}
	return res.json();
}

/**
 * Return a cached anonymous visitorData token. First call (or refresh===true) POSTs a WEB_REMIX
 * search and reads responseContext.visitorData, caches it (module-scope + edgeCache when available)
 * and reuses it thereafter. NEVER throws to the caller — returns null on a grab miss so the 27-03
 * stream route can 502. NOT a user credential (anonymous visitor token).
 */
export async function getVisitorData(refresh = false): Promise<string | null> {
	const cache = edgeCache();
	const fresh = cachedVisitorData !== null && Date.now() - cachedVisitorAt < VISITOR_TTL_MS;
	if (!refresh && fresh) return cachedVisitorData;

	// Cross-invocation edge cache (Cloudflare) — only when not forcing a refresh and no module token.
	if (!refresh && cachedVisitorData === null && cache) {
		try {
			const hit = await cache.match(VISITOR_CACHE_KEY);
			if (hit) {
				const j = (await hit.json()) as { visitorData?: string };
				if (j?.visitorData) {
					cachedVisitorData = j.visitorData;
					cachedVisitorAt = Date.now();
					return cachedVisitorData;
				}
			}
		} catch {
			// edge-cache read miss — fall through to a live grab.
		}
	}

	// Grab a fresh anonymous token from any WEB_REMIX response. NEVER throw to the caller.
	try {
		const json = await innerTubePost(SEARCH_URL, { context: WEB_REMIX_CONTEXT, query: 'music' });
		const vd =
			(json as { responseContext?: { visitorData?: string } })?.responseContext?.visitorData ??
			null;
		if (vd) {
			cachedVisitorData = vd;
			cachedVisitorAt = Date.now();
			if (cache) {
				try {
					await cache.put(
						VISITOR_CACHE_KEY,
						new Response(JSON.stringify({ visitorData: vd }), {
							status: 200,
							headers: { 'content-type': 'application/json' }
						})
					);
				} catch {
					// edge-cache write miss — module-scope cache still serves this invocation.
				}
			}
			return vd;
		}
		// Grab succeeded but no token present — clear any (now-suspect) cached token; return null.
		cachedVisitorData = null;
		return null;
	} catch {
		// Upstream failure — clear the cache (a refresh means the old token is bad) and 502-signal.
		cachedVisitorData = null;
		return null;
	}
}

/**
 * Walk a `next` response for the "Lyrics" tab. Returns its browseId (null when there is no lyrics
 * tab, or the tab is present but unselectable → disabled). Pure — ported from spike 007.
 */
export function findLyricsTab(nextJson: unknown): { browseId: string | null; disabled: boolean } {
	const j = (nextJson ?? {}) as YtNextJson;
	const tabs =
		j.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
			?.watchNextTabbedResultsRenderer?.tabs ?? [];
	for (const t of tabs) {
		const tr = t?.tabRenderer;
		if (!tr) continue;
		if (/lyric/i.test(tr.title ?? '')) {
			// A present-but-unselectable tab has no browseId → no lyrics for this track.
			const browseId = tr.endpoint?.browseEndpoint?.browseId ?? null;
			return { browseId, disabled: !browseId };
		}
	}
	return { browseId: null, disabled: true };
}

/**
 * Extract plain lyric text + licensor attribution from a lyrics `browse` response
 * (musicDescriptionShelfRenderer). Missing shelf → { text: null, attribution: null }. Pure — ported
 * from spike 007 (plain path only; YT has no reliable timed LRC, handled by the app's existing
 * crossSourceLyric fallback in Plan 27-04).
 */
export function extractLyrics(browseJson: unknown): {
	text: string | null;
	attribution: string | null;
} {
	let text: string | null = null;
	let attribution: string | null = null;
	// The shelf is nested inconsistently across responses — walk for the first
	// musicDescriptionShelfRenderer (same recursive-walk idiom as the search parse in ytmusic.ts).
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		const obj = node as Record<string, unknown>;
		const shelfRaw = obj.musicDescriptionShelfRenderer;
		if (shelfRaw && typeof shelfRaw === 'object') {
			const shelf = shelfRaw as YtDescriptionShelf;
			const runs = shelf.description?.runs ?? [];
			if (runs.length) text = runs.map((r) => r.text ?? '').join('');
			const foot = shelf.footer?.runs?.[0]?.text;
			if (foot) attribution = foot;
		}
		for (const k of Object.keys(obj)) walk(obj[k]);
	};
	walk(browseJson);
	return { text, attribution };
}

// --- Player-response helpers (Plan 27-03 stream route). These live HERE, not in the +server.ts
// route, because SvelteKit `+server.ts` only permits HTTP-verb (or `_`-prefixed) exports — a
// top-level `export function selectAudioFormat` in the route throws `Invalid export` at request
// time (caught by E2E, not by the fixture unit test which imports the module directly). Keeping
// them in this shared module also matches the project convention of extracting pure, testable
// logic out of the endpoint. ---

/** Untrusted InnerTube player-response shapes — every field optional, accessed via optional
 *  chaining (no `as any`, mirroring the search-adapter + lyrics-walker typing above). */
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
 * are all false — the stream route refreshes visitorData once then 502s. Pure (spike 006).
 */
export function isPlayable(playerJson: unknown): boolean {
	return (playerJson as YtPlayerJson)?.playabilityStatus?.status === 'OK';
}

/**
 * Pick the streamable audio URL from a player response's adaptiveFormats:
 *   1. itag 140 (AAC-LC / mp4, 128 kbps) with a direct `url` — the codec iOS Safari `<audio>` plays
 *      (Opus/webm itag 251 does NOT play in Safari, so it is NEVER chosen).
 *   2. else the highest-bitrate `audio/mp4` format with a direct `url` (a safety fallback).
 *   3. else null (no playable AAC — the route 502s so cross-source fallback engages).
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
