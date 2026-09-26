// charts — the client chart services the home page calls, one per shelf kind (39-D-17).
//
// POSTURE (mirrors deezer.ts):
//  - NEVER throws: a non-ok response / malformed body / abort / timeout / any throw returns [], so
//    a shelf degrades to empty and never breaks the render tree.
//  - WR-03 cache posture: failures REJECT inside the cached() factory (never stored) and map to []
//    OUTSIDE it, so the next call retries instead of pinning "no result" for the 6 h TTL.
//  - An EMPTY answer is treated as a failure too: /api/charts answers `{ items: [] }` with a 200 on a
//    cold miss whose upstream failed (and sends no browser Cache-Control for it), so memoising it
//    here would pin a blank shelf for 6 h — the exact thing the edge refuses to do.
//  - Every request goes through the apiFetch governor (dedupe, 8-slot cap, 25 s timeout, breaker —
//    memory api-fetch-flood-freeze), is bounded by FETCH_TIMEOUT_MS and honours a caller signal
//    (an already-aborted signal returns [] with no fetch).
//  - Keys carry src/kind/cc or cc/genre, so one poisoned answer cannot cross keys (T-39-20).

import { cached } from './ttl-cache';
import { apiFetch } from './api-base';
import { combinedSignal as combineWithTimeout } from './abort-signal';
import { parseItunesGenreFeed, type ChartAlbum } from './chart-parse';
import { safeImageUrl, APPLE_IMAGE_HOSTS } from '$lib/proxy/safe-image-url';
import { CHART_GENRES, type ChartGenre, type ChartRegion } from './home-layout';
import { deezerGenreChart } from './deezer';
import type { DiscoveryTrack, DiscoveryArtist } from './lastfm';

const CHARTS_PATH = '/api/charts';
const FETCH_TIMEOUT_MS = 6000;

/**
 * The client memo TTL for every chart pool. The edge's 1800 s browser TTL (39-03) sits inside it,
 * and the edge's own 6 h freshness window matches it.
 */
export const CHART_POOL_TTL_MS = 6 * 60 * 60 * 1000;

/** This module's calls all share one deadline — bound once, named in one place. */
const combinedSignal = (caller?: AbortSignal) => combineWithTimeout(FETCH_TIMEOUT_MS, caller);

/** Throw on an empty list so cached() never stores it (see the header). */
function nonEmpty<T>(items: T[]): T[] {
	if (!items.length) throw new Error('empty chart');
	return items;
}

/** GET /api/charts?src&kind&cc → items, memoised per (src, kind, cc); [] on any failure. */
function fetchItems<T>(src: string, kind: string, cc: ChartRegion, signal?: AbortSignal): Promise<T[]> {
	if (signal?.aborted) return Promise.resolve([]);
	return cached(`ch:${src}:${kind}:${cc}`, CHART_POOL_TTL_MS, async () => {
		const url = `${CHARTS_PATH}?${new URLSearchParams({ src, kind, cc }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { items?: unknown };
		// The edge already validated the rows; this mirrors deezerChart's typed read of its body.
		return nonEmpty(Array.isArray(data.items) ? (data.items as T[]) : []);
	}).catch(() => []);
}

/** Apple Music RSS most-played songs for a region. */
export function appleSongs(cc: ChartRegion, signal?: AbortSignal): Promise<DiscoveryTrack[]> {
	return fetchItems<DiscoveryTrack>('apple', 'songs', cc, signal);
}

/** Apple Music RSS most-played albums for a region. */
export function appleAlbums(cc: ChartRegion, signal?: AbortSignal): Promise<ChartAlbum[]> {
	return fetchItems<ChartAlbum>('apple', 'albums', cc, signal);
}

/** KKBOX daily song chart (hk/tw/sg only — the edge answers [] for any other region). */
export function kkboxSongs(cc: ChartRegion, signal?: AbortSignal): Promise<DiscoveryTrack[]> {
	return fetchItems<DiscoveryTrack>('kkbox', 'song', cc, signal);
}

/** KKBOX daily new-release chart (hk/tw/sg only). */
export function kkboxNewReleases(cc: ChartRegion, signal?: AbortSignal): Promise<DiscoveryTrack[]> {
	return fetchItems<DiscoveryTrack>('kkbox', 'newrelease', cc, signal);
}

/** YouTube Charts weekly top tracks for a region. */
export function ytTracks(cc: ChartRegion, signal?: AbortSignal): Promise<DiscoveryTrack[]> {
	return fetchItems<DiscoveryTrack>('yt', 'tracks', cc, signal);
}

/** YouTube Charts weekly top artists for a region. */
export function ytArtists(cc: ChartRegion, signal?: AbortSignal): Promise<DiscoveryArtist[]> {
	return fetchItems<DiscoveryArtist>('yt', 'artists', cc, signal);
}

/**
 * The legacy iTunes RSS genre chart, fetched CLIENT-SIDE ONLY (39-D-18). Spike 012: itunes.apple.com
 * sits behind Cloudflare and 403/429s the SHARED Workers egress IP, while the browser gets CORS `*`
 * and each device uses its own IP (the Capacitor `https://localhost` WebView included).
 *
 * The absolute URL still goes through apiFetch: since 32-D-13 apiUrl() passes an absolute http(s) URL
 * through untouched on web AND native, so this call gets the dedupe, the slot cap, the timeout and the
 * breaker like any /api/* call. A 403 is a 4xx — the governor records it as a SUCCESS (a real answer),
 * so an iTunes refusal can never trip the breaker for the rest of the app.
 *
 * parseItunesGenreFeed keeps only rows carrying the requested genre id (a bogus id returns the overall
 * chart with a 200), handles the single-entry object form, resizes mzstatic art to 600x600, and every
 * image passes the Apple host allowlist (T-39-17).
 */
export function itunesGenreChart(
	cc: 'hk' | 'tw' | 'jp',
	genreId: number,
	signal?: AbortSignal
): Promise<DiscoveryTrack[]> {
	if (signal?.aborted) return Promise.resolve([]);
	return cached(`it:genre:${cc}:${genreId}`, CHART_POOL_TTL_MS, async () => {
		const res = await apiFetch(`https://itunes.apple.com/${cc}/rss/topsongs/limit=100/genre=${genreId}/json`, {
			signal: combinedSignal(signal)
		});
		if (!res.ok) throw new Error(String(res.status));
		return nonEmpty(
			parseItunesGenreFeed(await res.json(), genreId, (u) => safeImageUrl(u, APPLE_IMAGE_HOSTS))
		);
	}).catch(() => []);
}

/**
 * One genre shelf's tracks: iTunes genres read the client feed at their FIXED storefront, Deezer
 * genres read /api/deezer/chart?genre= (CHART_GENRES is the single source of that split).
 */
export function genreChart(genre: ChartGenre, signal?: AbortSignal): Promise<DiscoveryTrack[]> {
	const spec = CHART_GENRES[genre];
	return spec.src === 'itunes'
		? itunesGenreChart(spec.cc, spec.id, signal)
		: deezerGenreChart(spec.id, signal);
}
