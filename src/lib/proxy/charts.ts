// Edge chart primitives for /api/charts (39-D-13 / 39-D-14 / 39-D-15).
//
// WHY THIS MODULE EXISTS: a SvelteKit `+server.ts` may export ONLY HTTP verbs. A top-level
// non-verb `export function` in a route file 500s at REQUEST time ("Invalid export") and unit
// tests miss it entirely because they import the module directly (project finding
// `svelte-server-endpoint-only-verb-exports`). Same reason `resolve-cache.ts` exists. The route is
// a thin verb-only caller; allowlist, cache key, serve-stale, timeouts and upstream binding live here.
//
// Store: `caches.default` ONLY — no binding, no KV, no secret. Every upstream (Apple Music RSS,
// KKBOX kma, YouTube Charts) is keyless, so nothing secret is in scope on this route. The PARSING is
// not here either: the edge is a thin caller of the pure parsers in `$lib/services/chart-parse`,
// which carry the YouTube echo guard and the never-throw contract.
//
// Threats: T-39-10 (closed allowlist, no user string reaches a URL or body), T-39-11 (key built
// from the validated query only), T-39-12 (only a non-empty server-side parse is ever stored),
// T-39-13 (a YT global fallback parses to [] and is never cached), T-39-14 (5 s total budget).
import type { DiscoveryTrack, DiscoveryArtist } from '$lib/services/lastfm';
import {
	parseAppleRss,
	parseKkbox,
	parseYtCharts,
	type ChartAlbum,
	type ImageValidator
} from '$lib/services/chart-parse';
import { CHART_REGIONS, KKBOX_REGIONS, YT_REGIONS, type ChartRegion } from '$lib/services/home-layout';
import { type EdgeCache, ownOriginCacheKey } from './edge-cache';
import { fetchWithRetry } from './http';
import {
	safeImageUrl,
	APPLE_IMAGE_HOSTS,
	KKBOX_IMAGE_HOSTS,
	YOUTUBE_IMAGE_HOSTS,
	type ImageHostAllowlist
} from './safe-image-url';

export type ChartQuery =
	| { src: 'apple'; kind: 'songs' | 'albums'; cc: ChartRegion }
	| { src: 'kkbox'; kind: 'song' | 'newrelease'; cc: ChartRegion }
	| { src: 'yt'; kind: 'tracks' | 'artists'; cc: ChartRegion };

export type ChartItem = DiscoveryTrack | DiscoveryArtist | ChartAlbum;

/** One stored chart: the parsed pool plus the edge-clock stamp serve-stale ages it by. */
export interface ChartEntry {
	fetchedAt: number;
	items: ChartItem[];
}

/**
 * Entry-shape version, carried IN the key (resolve-cache.ts discipline). `cache.delete` is
 * PoP-local, so an old entry can never be purged globally — bumping `v` IS the migration: every PoP
 * misses onto the new namespace and the old one expires on its own max-age.
 */
export const CHART_CACHE_VERSION = '1';
/** Age past which a hit is served stale and refilled in the background (charts move daily/weekly). */
export const CHART_FRESH_MS = 6 * 3600_000;
/** Stored max-age: how long a stale entry can keep answering while upstreams fail (48 h). */
export const CHART_STALE_S = 172_800;
/** 39-D-14: browser cache ttl. Must never outlive the client's 6 h pool TTL. */
export const CHART_CLIENT_TTL_S = 1800;
/** 39-D-13: TOTAL upstream budget per load (Apple hangs ~2% of calls, in bursts). */
export const UPSTREAM_TIMEOUT_MS = 5000;

/**
 * YouTube Charts client version. PINNED like ANDROID_VR_VERSION in ytmusic-innertube.ts: '2.0'
 * works, '0.1' → 404 (spike 011). A 404 from charts.youtube.com here = bump this.
 */
export const YT_CHARTS_CLIENT_VERSION = '2.0';

/**
 * RESEARCH finding 2: `hl=zh-TW` localizes knowledge-graph artist names (48 of HK's top 100 switch
 * to native script, Western names unchanged). Derived from cc only, so it never fragments the cache.
 */
const YT_HL: Record<string, string> = { hk: 'zh-TW', tw: 'zh-TW' };

/** Pool size per chart. A literal, never read from the request (Apple ≤ 100, KKBOX caps at 50). */
const POOL = 50;

const APPLE_KINDS = ['songs', 'albums'] as const;
const KKBOX_KINDS = ['song', 'newrelease'] as const;
const YT_KINDS = ['tracks', 'artists'] as const;

/** Narrow an untrusted query value to a member of a closed list (the list is widened, never the input). */
function isIn<T extends string>(list: readonly T[], v: string | null): v is T {
	return v !== null && (list as readonly string[]).includes(v);
}

/**
 * The closed allowlist (T-39-10). Only these combos exist; anything else is null, and the route
 * answers `{ items: [] }` without touching the cache or an upstream. Case-sensitive on purpose.
 *
 * T-39-11: bounded key space = 27×2 (apple) + 3×2 (kkbox) + 27×2 (yt) = 114 entries per PoP.
 */
export function validateChartQuery(params: URLSearchParams): ChartQuery | null {
	const src = params.get('src');
	const kind = params.get('kind');
	const cc = params.get('cc');
	if (src === 'apple' && isIn(APPLE_KINDS, kind) && isIn(CHART_REGIONS, cc)) return { src, kind, cc };
	if (src === 'kkbox' && isIn(KKBOX_KINDS, kind) && isIn(KKBOX_REGIONS, cc)) return { src, kind, cc };
	if (src === 'yt' && isIn(YT_KINDS, kind) && isIn(YT_REGIONS, cc)) return { src, kind, cc };
	return null;
}

/**
 * The versioned synthetic own-origin key. `/api/charts/_k` is NOT a route — a pure key namespace,
 * the `/api/resolve/_k` precedent. Built from the VALIDATED query only, never the raw request URL,
 * so junk params cannot mint new entries (RESEARCH anti-pattern: raw URL as key).
 */
export function chartCacheKey(origin: string, q: ChartQuery): Request {
	return ownOriginCacheKey(
		`${origin}/api/charts/_k?v=${CHART_CACHE_VERSION}&src=${q.src}&kind=${q.kind}&cc=${q.cc}`
	);
}

/** Read one entry. Best-effort: a miss, a broken Cache API or a malformed body are all `undefined`. */
export async function readChartEntry(
	cache: EdgeCache | null,
	key: Request
): Promise<ChartEntry | undefined> {
	if (!cache) return undefined;
	try {
		const hit = await cache.match(key);
		if (!hit) return undefined;
		const body: unknown = await hit.json();
		if (
			body &&
			typeof body === 'object' &&
			'fetchedAt' in body &&
			typeof body.fetchedAt === 'number' &&
			'items' in body &&
			Array.isArray(body.items)
		) {
			return { fetchedAt: body.fetchedAt, items: body.items };
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Write one entry. The CALLER guarantees `entry.items.length > 0`: an empty parse (schema drift, a
 * YT global fallback) must never overwrite a good stale entry and pin a blank shelf for 48 h.
 *
 * T-31-03-04: always a FRESH Response with an explicit two-header allow-list. Never cache the
 * response that passed through `src/hooks.server.ts` — it carries `Vary: Origin` (fragments the
 * entry per requester origin) and a requester's `Access-Control-Allow-Origin`.
 */
export async function writeChartEntry(
	cache: EdgeCache | null,
	key: Request,
	entry: ChartEntry
): Promise<void> {
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(entry), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'Cache-Control': `public, max-age=${CHART_STALE_S}`
				}
			})
		);
	} catch {
		// Caching is best-effort; a failed write only costs the next request a re-fill.
	}
}

/** The YouTube Charts browse request. Every value comes from the validated query. */
export function ytChartsInit(
	cc: string,
	kind: 'tracks' | 'artists',
	signal: AbortSignal
): RequestInit {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		signal,
		body: JSON.stringify({
			context: {
				client: {
					clientName: 'WEB_MUSIC_ANALYTICS',
					clientVersion: YT_CHARTS_CLIENT_VERSION,
					hl: YT_HL[cc] ?? 'en',
					gl: cc.toUpperCase()
				}
			},
			browseId: 'FEmusic_analytics_charts_home',
			query: `perspective=CHART_DETAILS&chart_params_country_code=${cc}&chart_params_chart_type=${
				kind === 'tracks' ? 'TRACKS' : 'ARTISTS'
			}&chart_params_period_type=WEEKLY`
		})
	};
}

const imageFrom =
	(hosts: ImageHostAllowlist): ImageValidator =>
	(u) =>
		safeImageUrl(u, hosts);
const appleImg = imageFrom(APPLE_IMAGE_HOSTS);
const kkboxImg = imageFrom(KKBOX_IMAGE_HOSTS);
const ytImg = imageFrom(YOUTUBE_IMAGE_HOSTS);

/** One upstream call inside the shared budget. Non-2xx and non-JSON both throw (never cached). */
async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
	// 39-D-13: retries=1 with ONE shared timeout signal = a 5 s TOTAL budget. A timed-out attempt is
	// never retried (the signal is already aborted); only a fast 5xx/429 gets its second try.
	const res = await fetchWithRetry(url, init, 1);
	if (!res.ok) throw new Error(`chart upstream ${res.status}`);
	return res.json();
}

/**
 * Fetch + parse one chart. THROWS on a network / HTTP / JSON failure and returns [] on an empty
 * parse — serveChart treats both as "do not cache".
 */
export async function loadChartUpstream(q: ChartQuery): Promise<ChartItem[]> {
	const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
	if (q.src === 'apple') {
		const data = await fetchJson(
			`https://rss.marketingtools.apple.com/api/v2/${q.cc}/music/most-played/${POOL}/${q.kind}.json`,
			{ signal }
		);
		return q.kind === 'songs'
			? parseAppleRss(data, 'songs', appleImg)
			: parseAppleRss(data, 'albums', appleImg);
	}
	if (q.src === 'kkbox') {
		const data = await fetchJson(
			`https://kma.kkbox.com/charts/api/v1/daily?type=${q.kind}&terr=${q.cc}&lang=tc&category=297&limit=${POOL}`,
			{ signal }
		);
		return parseKkbox(data, q.kind, kkboxImg);
	}
	const data = await fetchJson(
		'https://charts.youtube.com/youtubei/v1/browse?alt=json',
		ytChartsInit(q.cc, q.kind, signal)
	);
	return q.kind === 'tracks'
		? parseYtCharts(data, q.cc, 'tracks', ytImg)
		: parseYtCharts(data, q.cc, 'artists', ytImg);
}

/**
 * Serve-stale over `caches.default`, which has no native SWR (P39-02):
 *  - fresh hit (≤ 6 h)  → served, no subrequest;
 *  - stale hit (> 6 h)  → served NOW, refill scheduled via `ctx.waitUntil`; the refill only
 *                          overwrites when it parses non-empty, so a drift keeps yesterday's chart;
 *  - miss               → one awaited load; a non-empty result is stored, a failure or an empty
 *                          parse answers [] and stores nothing (the next request retries).
 *
 * ponytail: no in-flight marker, so N concurrent stale reads in one PoP can each schedule one
 * refill — bounded (one subrequest each, 5 s budget). Add a marker entry if refill volume ever shows.
 */
export async function serveChart(
	cache: EdgeCache | null,
	key: Request,
	load: () => Promise<ChartItem[]>,
	ctx: { waitUntil(p: Promise<unknown>): void } | undefined
): Promise<ChartItem[]> {
	const hit = await readChartEntry(cache, key);
	if (hit) {
		if (Date.now() - hit.fetchedAt > CHART_FRESH_MS) {
			ctx?.waitUntil(
				load()
					.then((items) =>
						items.length ? writeChartEntry(cache, key, { fetchedAt: Date.now(), items }) : undefined
					)
					.catch(() => {})
			);
		}
		return hit.items;
	}
	const items = await load().catch((): ChartItem[] => []);
	if (items.length) await writeChartEntry(cache, key, { fetchedAt: Date.now(), items });
	return items;
}
