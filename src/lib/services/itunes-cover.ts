// itunes-cover — the no-auth, CORS-open Western-catalog + ARTIST fallback cover SOURCE
// (quick-260606-v7k). Extends the cover pipeline; does NOT replace it.
//
// WHY iTunes Search (chosen over Deezer): the home discovery shelves are Last.fm GLOBAL
// charts/tags — overwhelmingly Western — and the existing CN-source backfill (searchAll →
// dedupeBest) has poor cover coverage for that catalog, so most Western track tiles stayed
// gradient. The iTunes Search API needs NO key, sends `Access-Control-Allow-Origin: *`
// (browser-callable client-side), has the strongest Western catalog plus decent CN coverage,
// and upgrades artwork resolution by a trivial string-token swap. Deezer would require
// object-key artwork selection and matches the chart-heavy Western titles this targets less
// reliably. No new npm dependency is added — this is plain `fetch` + `URL`.
//
// POSTURE (mirrors cover-art.ts / cover-backfill.ts):
//  - This module only BUILDS the search URL and does a BOUNDED `fetch`. Every network path
//    NEVER throws: a non-ok response / empty results / malformed JSON / abort / any throw all
//    return null. A null → the caller leaves the gradient (never a broken image, never blocks
//    first paint — callers fire this post-paint, capped and cached).
//  - The resolved value is a plain URL string consumed ONLY as an `<img src>` ATTRIBUTE
//    downstream (never a CSS `url()`), so — like caaReleaseGroupCover (T-nza-02) — NO
//    safeImageUrl / host allow-list change is needed.
//  - The query carries only artist/title text (already-public Last.fm data); NO secret/key/PII
//    crosses the boundary, and NO new env var is introduced (T-v7k-01).
//  - Every call is bounded by `AbortSignal.timeout(FETCH_TIMEOUT_MS)` AND honors a caller
//    signal (short-circuits to null immediately if the caller's signal is already aborted), so
//    a slow/hung iTunes response can never pile up against the CAP=3 + total-max pool
//    (T-v7k-02 self-DoS guard).
//
// ARTIST path note: the iTunes `entity=musicArtist` result does NOT carry an artwork field
// (it returns artistName / artistId only), so it cannot serve as an artist image. The standard
// proxy is the artist's top ALBUM cover via `entity=album&attribute=artistTerm&limit=1` →
// `results[0].artworkUrl100`. itunesArtistCover uses that album-art path.

import { isCoverOf } from '$lib/services/song-variant';
import { combinedSignal as combineWithTimeout } from './abort-signal';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const FETCH_TIMEOUT_MS = 6000;

/**
 * quick-261006-o9t (cover-bandwidth): the artwork size every INLINE display surface
 * (tiles, rows, the Now Playing hero) asks for. The chain's historic default was
 * 1200x1200bb (~330 KB per cover measured); a 400px image is plenty for the largest
 * display surface (the hero is ≤ ~390 CSS px wide on a phone) and cuts the bytes
 * several-fold. /api/og keeps its own OG_ARTWORK_SIZE (600) — it is not a display
 * surface, so it does not follow this constant.
 */
export const DISPLAY_ARTWORK_SIZE = '400x400bb';

/** This module's calls all share one deadline — bind it once so every call site stays
 *  `combinedSignal(signal)` and the timeout is named in exactly one place. */
const combinedSignal = (caller?: AbortSignal) => combineWithTimeout(FETCH_TIMEOUT_MS, caller);

/** Shape we read off an iTunes Search result (everything optional — untrusted external JSON). */
interface ItunesResult {
	artworkUrl100?: string;
	/** quick-261102-tdc: the candidate's own identity, checked by the cover gate. */
	trackName?: string;
	artistName?: string;
}
interface ItunesResponse {
	results?: ItunesResult[];
}

/**
 * Build an itunes.apple.com/search URL. `term` is encoded via URLSearchParams (no raw
 * spaces / special chars leak into the query), entity is set, limit is pinned to 1, and an
 * optional attribute (e.g. 'artistTerm') is appended only when provided.
 */
export function buildItunesSearchUrl(
	term: string,
	entity: string,
	attribute?: string,
	// quick-261102-covgate: /api/og's tier asks for a few candidates so it can skip a
	// first-result identity mismatch instead of trusting results[0] blind. Default stays 1 —
	// every client caller (fetchTopArtwork above) is byte-identical.
	limit = 1
): string {
	const params = new URLSearchParams();
	params.set('term', term);
	params.set('entity', entity);
	params.set('limit', String(limit));
	if (attribute) params.set('attribute', attribute);
	return `${ITUNES_SEARCH}?${params.toString()}`;
}

/**
 * Upgrade an iTunes `artworkUrl100` (…/100x100bb.jpg) to a sharp tile (…/1200x1200bb.jpg, D-11).
 * The replacement is DEFENSIVE: it only swaps when the `100x100bb` token is present; otherwise
 * the URL is returned unchanged. Empty / whitespace-only / null / undefined → null.
 *
 * `size` exists for /api/og (OG-EP-01), which needs the 600x600bb variant: measured 101,186 B vs
 * 332,091 B for 1200x1200bb, and a social crawler's fetch budget is what that endpoint is built
 * to stay inside (Pitfall 6). The default keeps every client tile byte-identical.
 */
export function upgradeArtwork(
	url: string | null | undefined,
	size = '1200x1200bb'
): string | null {
	const clean = (url ?? '').trim();
	if (!clean) return null;
	return clean.includes('100x100bb') ? clean.replace('100x100bb', size) : clean;
}

/**
 * Combine the caller's AbortSignal (if any) with a per-call timeout so a hung request always
 * settles. Returns null if the caller's signal is ALREADY aborted (the caller should not even
 * fetch). Uses AbortSignal.any when available, else falls back to the timeout signal alone
 * (still bounded — the caller's pre-fetch `aborted` check already short-circuits the common
 * case).
 */

/**
 * Bounded, never-throws GET → parsed top result's artworkUrl100, upgraded to `size`.
 * Returns null on: already-aborted caller signal, non-ok response, empty results, missing
 * artworkUrl100, malformed JSON, abort/timeout, or any thrown error.
 */
async function fetchTopArtwork(
	url: string,
	signal?: AbortSignal,
	size = '1200x1200bb',
	accept?: (r: ItunesResult) => boolean
): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): `url` is an ABSOLUTE cross-origin
		// itunes.apple.com URL. apiFetch prepends the /api base (apiUrl) → would corrupt it. Not /api.
		const res = await fetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) return null;
		const data = (await res.json()) as ItunesResponse;
		// quick-261102-tdc: with `accept`, the first result passing the cover identity gate.
		const top = accept ? data?.results?.find(accept) : data?.results?.[0];
		const art = upgradeArtwork(top?.artworkUrl100, size);
		return art;
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → gradient.
		return null;
	}
}

/**
 * Resolve a song cover via iTunes Search (entity=song) for `${artist} ${title}`.
 * Returns the upgraded artwork URL or null on any miss/abort/throw (never throws).
 * `size` selects the artwork variant; the default keeps the historic 1200x1200bb byte-identical,
 * while inline display surfaces pass DISPLAY_ARTWORK_SIZE (quick-261006-o9t).
 */
export async function itunesSongCover(
	artist: string,
	title: string,
	signal?: AbortSignal,
	size = '1200x1200bb'
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = `${artist ?? ''} ${title ?? ''}`.trim();
	if (!term) return null;
	// quick-261102-tdc (DECISIONS.md §6): scan a few results through THE cover identity gate
	// (song-variant isCoverOf) instead of trusting results[0].
	const song = { artist: artist ?? '', title: title ?? '' };
	return fetchTopArtwork(buildItunesSearchUrl(term, 'song', undefined, 5), signal, size, (r) =>
		isCoverOf(song, { artist: r.artistName, title: r.trackName })
	);
}

/**
 * Resolve an artist image via iTunes Search. The musicArtist entity carries no artwork, so this
 * uses the artist's top ALBUM cover (entity=album&attribute=artistTerm&limit=1) as the standard
 * artist-image proxy. Returns the upgraded artwork URL or null on any miss/abort/throw.
 * `size` selects the artwork variant (same default contract as itunesSongCover).
 */
export async function itunesArtistCover(
	artist: string,
	signal?: AbortSignal,
	size = '1200x1200bb'
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = (artist ?? '').trim();
	if (!term) return null;
	return fetchTopArtwork(buildItunesSearchUrl(term, 'album', 'artistTerm'), signal, size);
}
