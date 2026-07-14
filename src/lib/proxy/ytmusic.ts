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

export interface InnerTubePostOptions {
	signal?: AbortSignal;
	headers?: Record<string, string>;
}

/**
 * POST a JSON body to an InnerTube endpoint (RAW edge fetch via fetchWithRetry — never apiFetch).
 * Returns the parsed JSON. A non-OK response THROWS so the caller can pick its own sentinel rather
 * than silently returning garbage. The thrown message strips the query string so the key never
 * lands in a log (threat T-27-02-02).
 */
export async function innerTubePost(
	_url: string,
	_body: unknown,
	_opts: InnerTubePostOptions = {}
): Promise<unknown> {
	// RED stub — real POST lands in GREEN.
	throw new Error('ytmusic: innerTubePost not implemented (RED)');
}

/**
 * Return a cached anonymous visitorData token. First call (or refresh===true) POSTs a WEB_REMIX
 * search and reads responseContext.visitorData, caches it (module-scope + edgeCache when available)
 * and reuses it thereafter. NEVER throws to the caller — returns null on a grab miss so the 27-03
 * stream route can 502. NOT a user credential (anonymous visitor token).
 */
export async function getVisitorData(_refresh = false): Promise<string | null> {
	// RED stub — real grab/cache lands in GREEN.
	return null;
}

/**
 * Walk a `next` response for the "Lyrics" tab. Returns its browseId (null when there is no lyrics
 * tab, or the tab is present but unselectable → disabled). Pure — ported from spike 007.
 */
export function findLyricsTab(_nextJson: unknown): { browseId: string | null; disabled: boolean } {
	// RED stub — real walk lands in GREEN.
	return { browseId: null, disabled: true };
}

/**
 * Extract plain lyric text + licensor attribution from a lyrics `browse` response
 * (musicDescriptionShelfRenderer). Missing shelf → { text: null, attribution: null }. Pure — ported
 * from spike 007 (plain path only; YT has no reliable timed LRC, handled by the app's existing
 * crossSourceLyric fallback in Plan 27-04).
 */
export function extractLyrics(
	_browseJson: unknown
): { text: string | null; attribution: string | null } {
	// RED stub — real walk lands in GREEN.
	return { text: null, attribution: null };
}

// Referenced in GREEN — declared here so the skeleton typechecks without unused-import noise.
void fetchWithRetry;
void edgeCache;
void INNERTUBE_HEADERS;
void INNERTUBE_TIMEOUT_MS;
void INNERTUBE_RETRIES;
