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

import { getCachedItunesId, setCachedItunesId } from '$lib/services/cover-cache';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const FETCH_TIMEOUT_MS = 6000;

/** Shape we read off an iTunes Search result (everything optional — untrusted external JSON). */
interface ItunesResult {
	artworkUrl100?: string;
	/** quick-260809-3uo — the numeric ids the share carrier tokenizes by (see rememberItunesId). */
	collectionId?: unknown;
	trackId?: unknown;
}
interface ItunesResponse {
	results?: ItunesResult[];
}

/**
 * Build an itunes.apple.com/search URL. `term` is encoded via URLSearchParams (no raw
 * spaces / special chars leak into the query), entity is set, limit is pinned to 1, and an
 * optional attribute (e.g. 'artistTerm') is appended only when provided.
 */
export function buildItunesSearchUrl(term: string, entity: string, attribute?: string): string {
	const params = new URLSearchParams();
	params.set('term', term);
	params.set('entity', entity);
	params.set('limit', '1');
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

// =============================================================================================
// quick-260809-3uo — retaining the NUMERIC id alongside the artwork URL
// =============================================================================================
// The share card carries an iTunes cover as `i:<digits>` (see coverToken in $lib/services/share and
// coverUrlFromToken in $lib/proxy/og-cover). Only the ID travels: an mzstatic URL is a ~90-char
// irregular path, so carrying it would be neither short nor structural, and it would reintroduce
// exactly the sharer-supplied-path property the token design removes.
//
// The id is NOT derivable from the artwork URL (the trailing number in the path is the release's
// UPC, not an Apple id), so it is retained HERE — the one place it is known, in the same response
// that produced the URL — and read back at share time. Retention rides the EXISTING cover cache
// under a disjoint `itunes:` key family, so it inherits that store's TTL, LRU cap and clear button
// instead of adding a second store.
//
// DEGRADES CLEANLY: a cover cached BEFORE this retention existed (or after its entry expires) has
// no id, so recallItunesId returns null → coverToken emits nothing → no carrier → the card falls
// through to /api/og's ordinary tier chain, i.e. exactly today's behaviour.

/** An Apple id is a positive integer; 12 digits is well past the current 9–10 and still bounded. */
const ITUNES_ID_RE = /^[0-9]{1,12}$/;

/**
 * The SIZE-INDEPENDENT identity of an mzstatic artwork URL: the `/image/thumb/` path with the
 * trailing `/<size>.<ext>` segment dropped, so `100x100bb`, `600x600bb` and `1200x1200bb` variants
 * of one asset all key to the same entry. https + `.mzstatic.com` only; anything else → null.
 * Pure, never throws.
 */
export function itunesArtworkKey(url: string | null | undefined): string | null {
	if (!url || typeof url !== 'string') return null;
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:') return null;
		if (!u.hostname.toLowerCase().endsWith('.mzstatic.com')) return null;
		const m = /^\/image\/thumb\/(.+)\/[0-9]+x[0-9]+[a-z-]*\.(?:jpg|png)$/i.exec(u.pathname);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

/**
 * Retain the numeric id for a resolved artwork URL. COLLECTION (album) id is preferred over track
 * id: `/lookup?id=` on either returns the same `artworkUrl100` (live-probed 2026-08-09 for
 * 446760418 / 446760995), and the album id is the artwork's own identity — it is also the only id
 * an `entity=album` artist lookup carries. A non-numeric / absent id retains NOTHING rather than
 * junk. Never throws (storage access is guarded one layer down).
 */
function rememberItunesId(artworkUrl: string | null, result: ItunesResult | undefined): void {
	const key = itunesArtworkKey(artworkUrl);
	if (!key || !result) return;
	const id = String(result.collectionId ?? result.trackId ?? '');
	if (!ITUNES_ID_RE.test(id)) return;
	setCachedItunesId(key, id);
}

/**
 * Read back the numeric id retained for an iTunes cover URL (any size variant), or null when it was
 * never seen / has expired / storage is unavailable. This is the CALLER-side lookup the pure
 * `coverToken` cannot do for itself — a store or storage never flows into a pure service (CLAUDE.md),
 * so the component reads it and passes the value in. Never throws.
 */
export function recallItunesId(coverUrl: string | null | undefined): string | null {
	const key = itunesArtworkKey(coverUrl);
	if (!key) return null;
	const id = getCachedItunesId(key);
	return id && ITUNES_ID_RE.test(id) ? id : null;
}

/**
 * Combine the caller's AbortSignal (if any) with a per-call timeout so a hung request always
 * settles. Returns null if the caller's signal is ALREADY aborted (the caller should not even
 * fetch). Uses AbortSignal.any when available, else falls back to the timeout signal alone
 * (still bounded — the caller's pre-fetch `aborted` check already short-circuits the common
 * case).
 */
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}

/**
 * Bounded, never-throws GET → parsed top result's artworkUrl100, upgraded to 600x600.
 * Returns null on: already-aborted caller signal, non-ok response, empty results, missing
 * artworkUrl100, malformed JSON, abort/timeout, or any thrown error.
 */
async function fetchTopArtwork(url: string, signal?: AbortSignal): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): `url` is an ABSOLUTE cross-origin
		// itunes.apple.com URL. apiFetch prepends the /api base (apiUrl) → would corrupt it. Not /api.
		const res = await fetch(url, { signal: combinedSignal(signal) });
		if (!res.ok) return null;
		const data = (await res.json()) as ItunesResponse;
		const top = data?.results?.[0];
		const art = upgradeArtwork(top?.artworkUrl100);
		// quick-260809-3uo: retain the numeric id beside the URL — the ONE moment both are in hand.
		rememberItunesId(art, top);
		return art;
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → miss → gradient.
		return null;
	}
}

/**
 * Resolve a song cover via iTunes Search (entity=song) for `${artist} ${title}`.
 * Returns the upgraded artwork URL or null on any miss/abort/throw (never throws).
 */
export async function itunesSongCover(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = `${artist ?? ''} ${title ?? ''}`.trim();
	if (!term) return null;
	return fetchTopArtwork(buildItunesSearchUrl(term, 'song'), signal);
}

/**
 * Resolve an artist image via iTunes Search. The musicArtist entity carries no artwork, so this
 * uses the artist's top ALBUM cover (entity=album&attribute=artistTerm&limit=1) as the standard
 * artist-image proxy. Returns the upgraded artwork URL or null on any miss/abort/throw.
 */
export async function itunesArtistCover(
	artist: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	const term = (artist ?? '').trim();
	if (!term) return null;
	return fetchTopArtwork(buildItunesSearchUrl(term, 'album', 'artistTerm'), signal);
}
