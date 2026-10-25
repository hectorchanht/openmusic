// YouTube Music (InnerTube) EDGE module — the low-level POST / visitorData / lyrics-parse helpers
// behind the /api/ytmusic/* routes (search + lyrics from Plan 27-02; the stream route imports
// getVisitorData from 27-03).
//
// The PURE InnerTube constants + player-response helpers moved to ./ytmusic-innertube.ts in
// quick-260915-3ng so the native on-device resolver can import them without dragging fetchWithRetry /
// edgeCache into the client bundle. They are RE-EXPORTED below, so every existing
// `$lib/proxy/ytmusic` importer keeps working unchanged.
//
// ZERO auth: only the PUBLIC WEB_REMIX key + the anonymous client context. `getVisitorData()` grabs
// an ANONYMOUS InnerTube visitor token (responseContext.visitorData) — NOT a user credential, NOT
// account auth. No OAuth / device-flow / cookie / user-token / library-sync code lives here or
// anywhere in Plan 27 (spike 008 is a separate, later, legal-gated milestone).
//
// Everything in THIS file is SERVER-SIDE (Cloudflare edge / SvelteKit endpoint): it uses the RAW edge
// fetch via fetchWithRetry — NEVER apiFetch (apiFetch is the CLIENT governor seam and must not run
// edge-side). No /api/ytmusic response body ever echoes the key or a visitorData token to the client
// (threat T-27-02-02); that invariant is about our RESPONSES and is unaffected by the key also
// shipping in the native bundle (quick-260915-3ng — the key is public either way).
import { fetchWithRetry } from './http';
import { edgeCache } from './edge-cache';
import {
	extractVisitorData,
	INNERTUBE_HEADERS,
	SEARCH_URL,
	WEB_REMIX_CONTEXT,
	WEB_REMIX_KEY,
	PLAYER_URL,
	PLAYER_UA,
	playerBody,
	isPlayable
} from './ytmusic-innertube';

// Re-export every pure primitive so existing importers ('$lib/proxy/ytmusic') need zero edits.
export * from './ytmusic-innertube';

// --- Search filter params (spike 005) — SCREAMING_SNAKE. The client/URL/player constants live
// in ./ytmusic-innertube.ts, still one rotation point each. ---

/** InnerTube `params` for the search "Songs" chip — a clean song shelf, no Top-result/Videos/Albums
 *  noise. Verbatim from spike 005 (sent as-is in the POST body; the upstream accepts it, status 200). */
export const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

/** InnerTube `params` for the search "Videos" chip — surfaces community/video uploads that never
 *  appear in the Songs catalog (the whole point of this source for niche, CN-unavailable tracks;
 *  e.g. `dUlAfTZkjpE` 港耆 shows up ONLY under Videos). Verified against live InnerTube — the
 *  upstream returns the same `musicShelfRenderer → musicResponsiveListItemRenderer` shape the Songs
 *  parser already handles, so the search route merges both shelves (quick-260715-jdj). */
export const VIDEOS_FILTER = 'EgWKAQIQAWoKEAkQChAFEAMQBBAV';

// Metadata endpoint URLs local to this module (SEARCH_URL / PLAYER_URL live in ./ytmusic-innertube).
export const NEXT_URL =
	'https://music.youtube.com/youtubei/v1/next?prettyPrint=false&key=' + WEB_REMIX_KEY;
export const BROWSE_URL =
	'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&key=' + WEB_REMIX_KEY;
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
 * POST a WEB_REMIX search for one filter chip (`params`) and return the raw InnerTube envelope.
 * Shared by the search route so the Songs + Videos filters run through one edge helper instead of
 * duplicating the fixed-URL POST (quick-260715-jdj). Metadata endpoint — anonymous, NO visitorData.
 * Throws on a non-OK upstream (via innerTubePost) so the route's Promise.allSettled records the
 * per-filter failure and can still return the other shelf.
 */
export async function searchInnerTube(
	query: string,
	params: string,
	signal?: AbortSignal,
	locale?: { hl: string; gl: string }
): Promise<unknown> {
	// quick-260925-wa7: an (already allowlisted — innerTubeLocale) locale overrides hl/gl only; no
	// locale posts the SAME WEB_REMIX_CONTEXT object as before, so existing callers are unchanged.
	const context = locale
		? { client: { ...WEB_REMIX_CONTEXT.client, hl: locale.hl, gl: locale.gl } }
		: WEB_REMIX_CONTEXT;
	return innerTubePost(SEARCH_URL, { context, query, params }, { signal });
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
		const vd = extractVisitorData(json);
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

// --- Shared gated player resolve (quick-261024-vid1) -------------------------------------
// Moved out of the audio stream route so the VIDEO route resolves through the exact same
// gate machinery — one implementation of the bot-gate dance for every media route. The
// doc-comments travel with the code; their quick-ids are the decision record.
const PLAYER_TIMEOUT_MS = 15000; // player JSON hop
// HEADERS-only deadline for the googlevideo hop: the timer is cleared once headers arrive, so
// the body streams uncapped (the quick-260930-x3q posture — Workers bill CPU, not wall time).
const MEDIA_HEAD_TIMEOUT_MS = 15000;
// quick-261024-ytg: the PLAYER call itself is bot-gated per subrequest (~40% LOGIN_REQUIRED
// from the edge). Each retry uses a FRESH visitorData; quick-261024-ytr races the retries in
// parallel (see callPlayerGated).
const PLAYER_GATE_ATTEMPTS = 3; // total player calls per resolve: cached token + 2 fresh
const GATE_DELAY_MS = [250, 500]; // stagger before parallel gate retry 1 / 2
const gateDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST the VISIONOS player. Returns the parsed JSON, or null on an upstream throw (so the
 *  caller can gate on isPlayable and refresh/503 rather than crash).
 *
 *  quick-261006-r2: `visitorData` arrives as a PROMISE and is awaited INSIDE the try — an
 *  await while building the arguments would sit outside the try/catch, and a getVisitorData()
 *  throw would become an uncaught crash instead of the graceful null promised here. */
export async function callPlayer(videoId: string, visitorData: Promise<string | null>): Promise<unknown> {
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
 * quick-261024-ytg — one player call, retried on a non-OK playability with a FRESH
 * visitorData each time (see PLAYER_GATE_ATTEMPTS). First call uses the cached token (the
 * fast, usually-OK path). Returns a playable response when one is found, otherwise the LAST
 * retry's response, so the caller can gate / diagnose on it.
 *
 * quick-261024-ytr — the fresh-token retries race in PARALLEL (staggered by GATE_DELAY_MS):
 * the edge probe that night proved no other InnerTube client survives the edge (ANDROID_VR /
 * iOS byte-wall at ~1.5 MB, embedded/TV unusable), so VISIONOS stays the only client and the
 * levers left are decorrelation + latency. First playable response wins.
 */
export async function callPlayerGated(videoId: string): Promise<unknown> {
	const first = await callPlayer(videoId, getVisitorData());
	if (isPlayable(first)) return first;
	const retries = await Promise.all(
		Array.from({ length: PLAYER_GATE_ATTEMPTS - 1 }, async (_, i) => {
			await gateDelay(GATE_DELAY_MS[i] ?? 500);
			return callPlayer(videoId, getVisitorData(true));
		})
	);
	return retries.find((j) => isPlayable(j)) ?? retries[retries.length - 1] ?? first;
}

/** One googlevideo byte fetch with a HEADERS-only deadline (see MEDIA_HEAD_TIMEOUT_MS). RAW
 *  edge fetch (fetchWithRetry) — NEVER the client fetch governor (api-base): a long-lived
 *  media stream must not hold a governor slot (T-27-03-03). */
export async function fetchMedia(url: string, headers: Record<string, string>): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), MEDIA_HEAD_TIMEOUT_MS);
	try {
		return await fetchWithRetry(url, { redirect: 'follow', signal: ctrl.signal, headers }, 1);
	} finally {
		clearTimeout(timer);
	}
}
