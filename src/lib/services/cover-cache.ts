// cover-cache — the pure localStorage store of lazily-resolved CN-source covers.
//
// quick-260606-rvy FIX-A: chart/tag/geo discovery tiles with NO Last.fm image AND no
// MusicBrainz mbid render a bare color gradient. cover-backfill resolves a real album
// cover for them from the CN sources (searchAll → dedupeBest) AFTER first paint and
// stows it here, keyed by the normalized {artist,title} identity (matchKey, reused —
// NOT reinvented). On the next visit / re-render the cover is read back synchronously
// so the tile shows real art instantly with zero re-search.
//
// Stored shape is a single flat JSON `Record<string,string>` (matchKey → cover URL) at
// `openmusic:cover-cache:v1` — simpler than the home shelf cache since values are tiny.
// All localStorage access is wrapped in try/catch returning null / no-op on failure
// (corrupt JSON, quota, privacy-mode / unavailable storage). These functions run only
// in browser handlers / onMount, never SSR. Values are plain URL strings rendered into
// an `<img src>` ATTRIBUTE (never CSS url()) — no script/CSS-injection surface (T-rvy-01).
//
// quick-260606-v7k adds an ARTIST-ONLY cover key (artistCoverCacheKey) so the 熱門歌手
// (top-artist) tiles can cache a backfilled artist image (Deezer, wv8) WITHOUT colliding with
// a {artist,title} track row of the same name. The artist entry is `'artist:' + matchKey(name, '')`
// — the `artist:` prefix is provably disjoint from any track key (matchKey never emits a
// leading `artist:`), so artist + track entries safely coexist in the same flat record.

import { matchKey } from './match-key';

const CACHE_KEY = 'openmusic:cover-cache:v1';

/** The cache key for an {artist,title} pair — delegates to matchKey (artist-first, folded). */
export function coverCacheKey(artist: string, title: string): string {
	return matchKey(artist, title);
}

/**
 * The cache key for an ARTIST-only cover (distinct from coverCacheKey). Pinned form:
 * `'artist:' + matchKey(name, '')`. The `artist:` prefix guarantees it can never collide
 * with a track key (which is `matchKey(artist,title)` and never starts with `artist:`),
 * so 'Drake' the artist and a 'Drake'|'<title>' track are disjoint entries.
 */
export function artistCoverCacheKey(artist: string): string {
	return 'artist:' + matchKey(artist, '');
}

/**
 * The cache key for a UID-keyed cover (Phase 21 COVER-02, D-13 two-layer cache). Pinned form:
 * `'uid:' + uid` where `uid` is the RAW COLON-delimited Track.uid exactly as makeUid emitted it
 * (e.g. `'netease:12345'` → `'uid:netease:12345'`). Pitfall 7: do NOT transform the delimiter to a
 * hyphen — the uid is stored verbatim so the same song's stable identity is the cache key. The
 * `uid:` prefix is provably disjoint from both the track key (matchKey, never starts with `uid:`)
 * and the `artist:` key, so all three families coexist in the same flat record.
 *
 * READ ORDER (D-13): a caller reads `getCachedCoverByUid(uid) ?? getCachedCover(artist, title)` —
 * uid-first (the exact song), then the {artist,title} name layer as a fallback. On a SOLID resolve
 * the caller writes BOTH layers (setCachedCoverByUid + setCachedCover) so either lookup hits next time.
 */
export function uidCoverCacheKey(uid: string): string {
	return 'uid:' + uid;
}

/** Wipe the entire cover cache (used by the Data settings tab). Never throws. */
export function clearCoverCache(): void {
	try {
		localStorage.removeItem(CACHE_KEY);
	} catch {
		/* unavailable storage — no-op */
	}
}

/** Read the whole record; returns {} on absent / corrupt / unavailable storage (never throws). */
function readRecord(): Record<string, string> {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
		return {};
	} catch {
		return {};
	}
}

/**
 * Return the cached cover URL for {artist,title}, or null when absent / on corrupt /
 * unavailable storage. Pure read — never throws (mirrors +page.svelte loadCache).
 */
export function getCachedCover(artist: string, title: string): string | null {
	return readKey(coverCacheKey(artist, title));
}

/** Read the cached URL stored under `key`, or null when absent (never throws). */
function readKey(key: string): string | null {
	const url = readRecord()[key];
	return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Merge `{ [key]: url }` into the stored record and write it back. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache).
 */
function writeKey(key: string, url: string): void {
	const clean = (url ?? '').trim();
	if (!clean) return; // no-op — never cache an empty cover (keeps the gradient)
	try {
		const rec = readRecord();
		rec[key] = clean;
		localStorage.setItem(CACHE_KEY, JSON.stringify(rec));
	} catch {
		/* quota or unavailable — non-fatal, the tile simply keeps its gradient */
	}
}

/**
 * Merge `{ [coverCacheKey] : url }` into the stored record. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache).
 * Persists across calls within the same storage.
 */
export function setCachedCover(artist: string, title: string, url: string): void {
	writeKey(coverCacheKey(artist, title), url);
}

/**
 * Return the cached ARTIST cover URL for `artist`, or null when absent / on corrupt /
 * unavailable storage. Pure read — never throws. Disjoint from the track lookup.
 */
export function getCachedArtistCover(artist: string): string | null {
	return readKey(artistCoverCacheKey(artist));
}

/**
 * Cache an ARTIST cover URL under the artist-only key. No-op on an empty / whitespace-only
 * url; swallows quota / unavailable-storage errors. Coexists with track entries.
 */
export function setCachedArtistCover(artist: string, url: string): void {
	writeKey(artistCoverCacheKey(artist), url);
}

/**
 * Return the cached cover URL for a Track uid (D-13 uid layer), or null when absent / on corrupt /
 * unavailable storage. Pure read — never throws. The intended read order is uid-first then the
 * name layer: `getCachedCoverByUid(uid) ?? getCachedCover(artist, title)`.
 */
export function getCachedCoverByUid(uid: string): string | null {
	return readKey(uidCoverCacheKey(uid));
}

/**
 * Cache a cover URL under the uid key (D-13 uid layer). No-op on an empty / whitespace-only url;
 * swallows quota / unavailable-storage errors (reuses writeKey). On a SOLID resolve the caller
 * writes BOTH this and setCachedCover so either lookup hits next time. Disjoint from track/artist keys.
 */
export function setCachedCoverByUid(uid: string, url: string): void {
	writeKey(uidCoverCacheKey(uid), url);
}

/**
 * Delete EXACTLY one entry from the stored record (mirrors writeKey's try/catch shape). Reads the
 * whole record, deletes the single key, writes the record back. Skips the write when the key is
 * absent so a remove-missing is a true no-op. Swallows corrupt-JSON / quota / unavailable-storage
 * errors — NEVER throws. Pure: does NOT touch the reactive cover-version (that bump lives in the
 * `.svelte.ts` wrapper, LOCKED decision #2). Does NOT remove the whole CACHE_KEY blob — that is
 * clearCoverCache's job (the per-entry remover deletes ONE key, leaving every other entry intact).
 */
function removeKey(key: string): void {
	try {
		const rec = readRecord();
		if (key in rec) {
			delete rec[key];
			localStorage.setItem(CACHE_KEY, JSON.stringify(rec));
		}
	} catch {
		/* unavailable / quota / corrupt — non-fatal, no-op */
	}
}

/**
 * Evict the cover cached under a Track uid (D-13 uid layer). Keys by the RAW colon uid (Pitfall 7,
 * no hyphen folding). Deletes exactly that one entry — the coexisting name + artist families are
 * untouched. Pure, never throws, NO rune/bump (the reactive bump lives in cover-version.svelte.ts).
 */
export function removeCachedCoverByUid(uid: string): void {
	removeKey(uidCoverCacheKey(uid));
}

/**
 * Evict the cover cached for an {artist,title} name layer. Keys via the SAME coverCacheKey as the
 * setter (matchKey folding parity — 'A','B (Live)' removes what 'a','b' set). Deletes exactly that
 * one entry — coexisting uid + artist families untouched. Pure, never throws, NO rune/bump.
 */
export function removeCachedCover(artist: string, title: string): void {
	removeKey(coverCacheKey(artist, title));
}

/**
 * Evict the cover cached under the ARTIST-only key. Keys via the SAME artistCoverCacheKey as the
 * setter (matchKey folding parity). Deletes exactly that one entry — coexisting track families
 * untouched. Pure, never throws, NO rune/bump (the reactive bump lives in cover-version.svelte.ts).
 */
export function removeCachedArtistCover(artist: string): void {
	removeKey(artistCoverCacheKey(artist));
}
