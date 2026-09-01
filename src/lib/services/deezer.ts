// deezer — the thin, never-throws Deezer cover client (quick-260606-wv8, WV8-01).
//
// Deezer becomes the PRIMARY cover source for home discovery tiles (it has far stronger
// Western + decent CN album-cover coverage and — unlike Last.fm — real artist-picture
// coverage). This module ONLY builds the search URL and does a bounded fetch through
// the OWN-ORIGIN proxy /api/deezer/search. It does NOT call api.deezer.com directly: the
// browser fetch to Deezer is CORS-blocked (api.deezer.com sends no Access-Control-Allow-Origin),
// so the request MUST go through the edge proxy (which also gives caching + posture parity).
//
// POSTURE (mirrors the prior never-throws cover client this supersedes):
//  - Every network path NEVER throws: a non-ok response / { cover:null } / malformed JSON /
//    abort / any throw all return null. A null → the caller leaves the gradient (never a broken
//    image, never blocks first paint — callers fire this post-paint, capped + cached).
//  - WR-03 / T-17-13 cache posture: only SUCCESSFUL responses are cached. Failures (non-ok,
//    timeout, caller abort, malformed JSON) REJECT inside the cached() factory — never stored —
//    and are mapped to the null/[] sentinel OUTSIDE the cache, so the next call retries instead
//    of pinning "no result" for the 7d/6h TTL.
//  - The resolved value is a plain URL string consumed ONLY as an `<img src>` ATTRIBUTE
//    downstream (never a CSS url()); the proxy already host-allow-listed it to https *.dzcdn.net.
//  - NO secret/key/PII crosses the boundary (Deezer search is public); NO new env var, NO new
//    npm dependency (plain fetch + URL + URLSearchParams).
//  - Every call is bounded by AbortSignal.timeout(FETCH_TIMEOUT_MS) AND honors a caller signal
//    (short-circuits to null immediately if the caller's signal is already aborted), so a
//    slow/hung response can never pile up against the CAP=3 + total-max backfill pool.

import { cached } from './ttl-cache';
import { apiFetch } from './api-base';

const PROXY_PATH = '/api/deezer/search';
const CHART_PATH = '/api/deezer/chart';
const RELATED_PATH = '/api/deezer/related';
const RADIO_PATH = '/api/deezer/radio';
// Phase 17, ENRICH-04 — artist/album info enrichment proxy paths.
const ARTIST_PATH = '/api/deezer/artist';
const ALBUM_PATH = '/api/deezer/album';
// Phase 23, ART-01 / D-19 — artist-albums LIST proxy (each album carries nb_tracks natively).
const ARTIST_ALBUMS_PATH = '/api/deezer/artist-albums';
const FETCH_TIMEOUT_MS = 6000;
// k3y client-side TTLs (longer per lry-followup: a music app's catalogue + cover data is
// stable for days, and the same-session repeat hit pattern dominates the network surface).
// Covers basically never change for an existing track; search rankings drift slowly; related
// + chart change daily but the visible UX cost of a half-day-old chart is zero.
const TTL_COVER = 7 * 24 * 60 * 60 * 1000; // 7d — covers are effectively immutable for an existing release
const TTL_SEARCH = 6 * 60 * 60 * 1000;     // 6h — search/related rankings drift slowly
const TTL_RELATED = 6 * 60 * 60 * 1000;
// Phase 17 — artist/album info is stable (mirror TTL_COVER's 7d posture).
const TTL_ARTIST = 7 * 24 * 60 * 60 * 1000;

/** The proxy's client-facing reshape (mirrors the +server.ts DeezerCover interface). */
interface DeezerCover {
	cover: string | null;
	artistPicture: string | null;
	/** Top-N reshaped hits when the proxy was called with `&limit=N>1` (quick-260607-jau). */
	results?: DeezerHit[];
}

/** One reshaped Deezer search hit (jau). Mirrors the +server.ts DeezerHit interface. */
export interface DeezerHit {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	preview: string | null;
}

/** Chart item shapes (mirror the /api/deezer/chart +server.ts reshape + lastfm Discovery* shapes). */
export interface DeezerChartTrack {
	artist: string;
	title: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChartArtist {
	name: string;
	image: string | null;
	mbid: null;
}
export interface DeezerChartResult {
	tracks: DeezerChartTrack[];
	artists: DeezerChartArtist[];
}

const EMPTY_CHART: DeezerChartResult = { tracks: [], artists: [] };

/**
 * Fetch the Deezer top-tracks + top-artists chart through the OWN-ORIGIN proxy. Each item
 * carries its cover/picture NATIVELY (no per-tile backfill), so this is the PRIMARY home
 * top-hits + top-artists source. Never throws: any non-ok / abort / timeout / malformed JSON
 * returns { tracks: [], artists: [] } so the caller falls back to the Last.fm chart.
 *
 * WR-03 / T-17-13: the failure→sentinel mapping lives OUTSIDE cached() — a transient failure
 * REJECTS inside the factory (so it is never cached; the next call retries) and only the
 * `.catch` maps it to the empty sentinel for the caller.
 */
export async function deezerChart(limit = 18, signal?: AbortSignal): Promise<DeezerChartResult> {
	if (signal?.aborted) return EMPTY_CHART;
	return cached(`dz:chart:${limit}`, TTL_RELATED, async () => {
		const url = `${CHART_PATH}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as Partial<DeezerChartResult>;
		return { tracks: data.tracks ?? [], artists: data.artists ?? [] };
	}).catch(() => EMPTY_CHART);
}

/**
 * Build the OWN-ORIGIN proxy URL for a search `term`. The term is encoded via URLSearchParams
 * (no raw spaces / special chars leak into the query). Points at /api/deezer/search — NEVER
 * api.deezer.com (the browser fetch to Deezer is CORS-blocked, so it must be proxied).
 */
export function buildDeezerSearchUrl(term: string): string {
	return `${PROXY_PATH}?${new URLSearchParams({ q: term }).toString()}`;
}

/**
 * Combine the caller's AbortSignal (if any) with a per-call timeout so a hung request always
 * settles. Uses AbortSignal.any when available, else falls back to the timeout signal alone
 * (still bounded — the caller's pre-fetch `aborted` check short-circuits the common case).
 */
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}

/**
 * Bounded GET of the proxy → the parsed { cover, artistPicture } reshape. THROWS on a non-ok
 * response, malformed JSON, abort/timeout, or network failure (WR-03 / T-17-13): a transient
 * failure must REJECT inside cached() so the sentinel is never pinned for the TTL — the
 * exported callers map the rejection to null OUTSIDE the cache.
 */
async function fetchDeezerOrThrow(term: string, signal?: AbortSignal): Promise<DeezerCover> {
	const res = await apiFetch(buildDeezerSearchUrl(term), { signal: combinedSignal(signal) });
	if (!res.ok) throw new Error(String(res.status));
	return (await res.json()) as DeezerCover;
}

/**
 * Resolve a song album cover via the Deezer proxy for `${artist} ${title}`. Returns the cover
 * URL or null on any miss/abort/throw (never throws). Only a SUCCESSFUL response is cached
 * (a genuine `{ cover: null }` answer included); a transient failure rejects inside cached()
 * and is mapped to null outside, so the next call retries (WR-03 / T-17-13).
 */
export async function deezerSongCover(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = `${artist ?? ''} ${title ?? ''}`.trim();
	if (!term) return null;
	// k3y client cache: memo the resolved cover so repeat lookups skip the edge round-trip.
	return cached(`dz:cover:song:${term}`, TTL_COVER, async () => {
		const result = await fetchDeezerOrThrow(term, signal);
		return result?.cover ?? null;
	}).catch(() => null);
}

/**
 * Resolve an artist picture via the Deezer proxy for the artist name. Returns the artist
 * picture URL or null on any miss/abort/throw (never throws). Deezer (unlike Last.fm)
 * carries a real artist picture, so this is the artist-tile cover source. Transient
 * failures are never cached (WR-03 / T-17-13).
 */
export async function deezerArtistCover(
	artist: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = (artist ?? '').trim();
	if (!term) return null;
	return cached(`dz:cover:artist:${term}`, TTL_COVER, async () => {
		const result = await fetchDeezerOrThrow(term, signal);
		return result?.artistPicture ?? null;
	}).catch(() => null);
}

/**
 * Search Deezer for top-N normalized hits (quick-260607-jau). Used for cross-source dedupe
 * signals + metadata enrichment. Returns [] on miss/abort/throw (never throws). The proxy
 * caps `limit` to [1,25].
 */
export async function deezerSearchTopN(
	term: string,
	limit = 10,
	signal?: AbortSignal
): Promise<DeezerHit[]> {
	if (signal?.aborted) return [];
	const clean = (term ?? '').trim();
	if (!clean) return [];
	// k3y client cache: key by (term, limit). Repeat callers (dedupe-deezer hot path) skip
	// the network entirely for an hour. WR-03: a transient failure rejects inside cached()
	// (never pinned for the TTL) and maps to [] outside, so the next call retries.
	return cached(`dz:search:${clean}|${limit}`, TTL_SEARCH, async () => {
		const url = `${PROXY_PATH}?${new URLSearchParams({ q: clean, limit: String(limit) }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as DeezerCover;
		return data.results ?? [];
	}).catch(() => [] as DeezerHit[]);
}

/**
 * Fetch related artists (by name) via Deezer's `artist/{id}/related` endpoint, proxied as
 * `/api/deezer/related?artist=…&limit=…`. Returns the cleaned name list, or [] on
 * miss/abort/throw. Used as a fallback for similar.ts when LASTFM_KEY is absent / Last.fm
 * returns empty (quick-260607-jau).
 */
export async function deezerRelatedArtists(
	artist: string,
	limit = 8,
	signal?: AbortSignal
): Promise<string[]> {
	if (signal?.aborted) return [];
	const clean = (artist ?? '').trim();
	if (!clean) return [];
	// WR-03: failure rejects inside cached() (never pinned) → [] outside (retry next call).
	return cached(`dz:related:${clean}|${limit}`, TTL_RELATED, async () => {
		const url = `${RELATED_PATH}?${new URLSearchParams({ artist: clean, limit: String(limit) }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { artists?: string[] };
		return Array.isArray(data?.artists) ? data!.artists! : [];
	}).catch(() => [] as string[]);
}

/** One {artist,title,image} pair from Deezer's artist radio (the /api/deezer/radio reshape). */
export interface DeezerRadioPair {
	artist: string;
	title: string;
	image?: string;
}

/**
 * Deezer artist RADIO — a ready-made taste-based track list in ONE call
 * (debug/upnext-diverse-fallback-kuwo-dead, 2026-08-31).
 *
 * Used by similar.ts as the path between Last.fm `track.getSimilar` (dry for any track without
 * scrobble history) and the expensive per-similar-artist search fallback. The pairs map straight
 * onto similar.ts's `nameStub`, so the Up-Next entries stay lazy name stubs — no per-song search
 * at build time. Never-throws: any failure returns [] and the caller falls through unchanged
 * (same WR-03 discipline as deezerRelatedArtists — failure rejects INSIDE cached() so it is never
 * pinned, and maps to [] outside).
 */
export async function deezerArtistRadio(
	artist: string,
	limit = 20,
	signal?: AbortSignal
): Promise<DeezerRadioPair[]> {
	if (signal?.aborted) return [];
	const clean = (artist ?? '').trim();
	if (!clean) return [];
	return cached(`dz:radio:${clean}|${limit}`, TTL_RELATED, async () => {
		const url = `${RADIO_PATH}?${new URLSearchParams({ artist: clean, limit: String(limit) }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { tracks?: DeezerRadioPair[] };
		return Array.isArray(data?.tracks) ? data!.tracks! : [];
	}).catch(() => [] as DeezerRadioPair[]);
}

// ---- Phase 17, ENRICH-04 — Deezer artist/album info enrichment client fns -----------------
// Mirror deezerRelatedArtists exactly: signal-aborted guard → trim → empty→null → cached() →
// own-origin /api/deezer/* fetch with combinedSignal → non-ok/throw → null (never throws). A
// null → the page's Deezer section is silently absent (D-14). The reshape interfaces are
// exported so the page-level field-precedence merge (D-15, enrich-merge.ts) can type them.

/** Client-facing artist reshape (mirrors the /api/deezer/artist +server.ts ArtistResult). */
export interface DeezerArtistInfo {
	picture: string | null;
	fans: number | null;
	albums: number | null;
}

/** Client-facing album reshape (mirrors the /api/deezer/album +server.ts AlbumResult). */
export interface DeezerAlbumInfo {
	cover: string | null;
	releaseDate: string | null;
	tracks: number | null;
	fans: number | null;
	label: string | null;
	genres: string[];
	duration: number | null;
}

/**
 * Resolve Deezer artist info (hi-res picture, fan count, album count) via the OWN-ORIGIN proxy.
 * Returns null on already-aborted signal / empty name / non-ok / abort / throw (never throws) —
 * a null leaves the artist-page Deezer section silently absent (D-14).
 */
export async function deezerArtist(
	name: string,
	signal?: AbortSignal
): Promise<DeezerArtistInfo | null> {
	if (signal?.aborted) return null;
	const clean = (name ?? '').trim();
	if (!clean) return null;
	// WR-03 / T-17-13: a timeout/abort/non-ok must NOT pin "no artist info" for 7 days —
	// the failure rejects inside cached() (never stored) and maps to null OUTSIDE the cache,
	// so the next visit retries instead of hiding the Deezer section all session.
	return cached(`dz:artist:${clean}`, TTL_ARTIST, async () => {
		const url = `${ARTIST_PATH}?${new URLSearchParams({ name: clean }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as DeezerArtistInfo;
	}).catch(() => null); // never throws → caller leaves section absent (D-14)
}

/**
 * Resolve Deezer album info (hi-res cover, release date, label, genres, track count, fans,
 * duration) via the OWN-ORIGIN proxy. The title + artist combine into the search query for a
 * better hit. Returns null on already-aborted signal / empty title / non-ok / abort / throw
 * (never throws) — a null leaves the album-page Deezer section silently absent (D-14).
 */
export async function deezerAlbum(
	title: string,
	artist?: string,
	signal?: AbortSignal
): Promise<DeezerAlbumInfo | null> {
	if (signal?.aborted) return null;
	const cleanTitle = (title ?? '').trim();
	if (!cleanTitle) return null;
	const cleanArtist = (artist ?? '').trim();
	// WR-03 / T-17-13: same posture as deezerArtist — transient failures reject inside
	// cached() (never pinned for 7d) and map to null outside, so the next visit retries.
	return cached(`dz:album:${cleanTitle}|${cleanArtist}`, TTL_ARTIST, async () => {
		const params = new URLSearchParams({ title: cleanTitle });
		if (cleanArtist) params.set('artist', cleanArtist);
		const url = `${ALBUM_PATH}?${params.toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		return (await res.json()) as DeezerAlbumInfo;
	}).catch(() => null); // never throws → caller leaves section absent (D-14)
}

// ---- Phase 23, ART-01 / D-19 — artist-albums LIST with native nb_tracks --------------------
// The artist page uses this to hide trackless albums with ZERO per-album fetches: Deezer's
// artist/{id}/albums endpoint returns nb_tracks per album natively (UI-SPEC §8.2 AUGMENT path).
// Last.fm getArtistTopAlbums stays the graceful fallback for artists Deezer does not cover.

/** Client-facing artist-album reshape (mirrors the /api/deezer/artist-albums DeezerArtistAlbum). */
export interface DeezerArtistAlbum {
	title: string;
	nb_tracks: number;
	cover: string | null;
}

/**
 * List an artist's albums (each with its native `nb_tracks`) via the OWN-ORIGIN proxy. Returns
 * the reshaped array, or [] on already-aborted signal / empty name / non-ok / abort / throw /
 * malformed JSON (never throws). Mirrors deezerSearchTopN's WR-03 cache posture exactly: a
 * transient failure REJECTS inside cached() (never pinned for the TTL) and maps to [] OUTSIDE
 * the cache, so the next visit retries; a SUCCESSFUL response (incl. a genuine empty list) IS
 * cached. A [] result → the artist page falls back to the Last.fm album list (§8.2).
 */
export async function deezerArtistAlbums(
	name: string,
	signal?: AbortSignal
): Promise<DeezerArtistAlbum[]> {
	if (signal?.aborted) return [];
	const clean = (name ?? '').trim();
	if (!clean) return [];
	return cached(`dz:artistalbums:${clean}`, TTL_ARTIST, async () => {
		const url = `${ARTIST_ALBUMS_PATH}?${new URLSearchParams({ q: clean }).toString()}`;
		const res = await apiFetch(url, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
		if (!res.ok) throw new Error(String(res.status));
		const data = (await res.json()) as { data?: DeezerArtistAlbum[] };
		return Array.isArray(data?.data) ? data!.data! : [];
	}).catch(() => [] as DeezerArtistAlbum[]); // never throws → caller falls back to Last.fm (§8.2)
}
