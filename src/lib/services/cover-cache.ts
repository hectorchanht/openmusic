// cover-cache — the pure localStorage store of lazily-resolved CN-source covers.
//
// quick-260606-rvy FIX-A: chart/tag/geo discovery tiles with NO Last.fm image AND no
// MusicBrainz mbid render a bare color gradient. cover-backfill resolves a real album
// cover for them from the CN sources (searchAll → dedupeBest) AFTER first paint and
// stows it here, keyed by the normalized {artist,title} identity (matchKey, reused —
// NOT reinvented). On the next visit / re-render the cover is read back synchronously
// so the tile shows real art instantly with zero re-search.
//
// Stored shape is a single flat JSON `Record<string, { u: string; t: number } | string>` at
// `openmusic:cover-cache:v1` (matchKey → timestamped cover entry). Each value is `{ u, t }`
// where u=cover URL and t=write-time in ms; the bare `string` arm exists ONLY to tolerate
// legacy `v1` values already on disk (grandfathered — never cold-flushed, lazily upgraded).
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
//
// quick-260704-2xq adds proactive TTL expiry (~14 days) + a write-time-LRU size cap (~2000)
// over the timestamped `{u,t}` entry shape — the root fix for the recurring stale-cover bug
// cluster and the unbounded-localStorage-growth concern (CONCERNS.md optimization backlog #2):
//   - TTL is READ-SIDE ONLY: an entry with `Date.now() - t > TTL_MS` reads as a MISS (null) with
//     NO write side-effect (the pure-read contract lazyCover depends on — no eviction on read; the
//     expired entry stays on disk until it is overwritten or cap-evicted).
//   - The cap is WRITE-SIDE: after each insert, if the record exceeds MAX_ENTRIES, the oldest
//     write-time entries are evicted first ("oldest-write-first"). This is an intentional
//     approximation of access-LRU — true access-time LRU would require a write on every read
//     (churning storage on every scroll) and would violate the pure-read contract.
//   - LEGACY bare-string entries (pre-`{u,t}` `v1` values) are GRANDFATHERED: TTL-exempt (they
//     have no `t`) so they read as valid hits, and cap-eviction treats them as the OLDEST
//     (`t = -Infinity`, evict-first) so the store naturally migrates + trims over time. Their
//     next write rewrites them as `{u,t}` (lazy upgrade). No re-resolve storm.
//   - The `v1` CACHE_KEY is deliberately PRESERVED (NOT bumped to v2): bumping would cold-flush
//     every user's cache — the exact re-resolve storm this change avoids.

import { matchKey } from './match-key';

const CACHE_KEY = 'openmusic:cover-cache:v1';

/** A stored cover entry: `u` = cover URL, `t` = write-time in ms (Date.now()). */
type CoverEntry = { u: string; t: number };

// TTL of the cached cover URL. 14 days = the midpoint of the backlog's 7–30 day range: long
// enough that a healthy CDN cover survives normal usage without a re-resolve, short enough that
// a URL nearing its typical CDN expiry window is dropped proactively (complementing lazyCover's
// reactive dead-URL probe) so fewer broken paints occur.
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Write-time-LRU cap. Cover URLs are tiny (~80–150 bytes/entry as `{u,t}` JSON), so 2000 entries
// is well under the ~5 MB localStorage budget (a few hundred KB) while comfortably covering an
// active user's browsed catalogue; the cap exists to bound worst-case unbounded growth, not to
// be tight.
const MAX_ENTRIES = 2000;

/**
 * Effective write-time for eviction ordering. A valid `{u,t}` entry uses its `t`; a legacy
 * bare-string (or any malformed entry with no numeric `t`) sorts as `-Infinity` (oldest /
 * evict-first) so the store naturally migrates + trims over time.
 */
function entryTime(v: CoverEntry | string | undefined): number {
	return v && typeof v === 'object' && typeof v.t === 'number' ? v.t : -Infinity;
}

/**
 * Resolve a raw stored value to a live URL, applying the shape guard + TTL:
 *   - a non-empty legacy `string` → returned directly (grandfathered hit, TTL-EXEMPT);
 *   - a `{u,t}` entry → null if `Date.now() - t > TTL_MS` (expired MISS), else `u` when non-empty;
 *   - anything else (missing, wrong shape, empty `u`) → null.
 * Pure — never writes (TTL expiry is read-side-null-only, no delete-on-read).
 */
function readUrlFromEntry(v: CoverEntry | string | undefined): string | null {
	if (typeof v === 'string') return v.length > 0 ? v : null; // legacy grandfathered hit
	if (v && typeof v === 'object' && typeof v.u === 'string' && typeof v.t === 'number') {
		if (Date.now() - v.t > TTL_MS) return null; // expired — strict `>`, no write side-effect
		return v.u.length > 0 ? v.u : null;
	}
	return null;
}

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

/**
 * Read the whole record; returns {} on absent / corrupt / unavailable storage (never throws).
 * Shape-agnostic — entries may be `{u,t}` (current) or a legacy bare `string` (grandfathered);
 * normalization + TTL expiry live in readKey so writeKey/removeKey still see raw entries.
 */
function readRecord(): Record<string, CoverEntry | string> {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return {};
		const v: unknown = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v))
			return v as Record<string, CoverEntry | string>;
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

/**
 * Read the cached URL stored under `key`, or null when absent / expired (never throws).
 * Applies the shape guard + TTL via readUrlFromEntry. PURE — must NOT call setItem (a TTL miss
 * returns null without deleting the entry; the legacy string arm is TTL-exempt / grandfathered).
 */
function readKey(key: string): string | null {
	return readUrlFromEntry(readRecord()[key]);
}

/**
 * Merge `{ [key]: { u, t } }` into the stored record and write it back. No-op on an empty /
 * whitespace-only url; swallows quota / unavailable-storage errors (mirrors saveCache). Always
 * writes the new `{u,t}` shape — this is the lazy-upgrade point for a previously-legacy key.
 * After insert, enforces MAX_ENTRIES by evicting the oldest-write-time entries first (legacy /
 * no-`t` entries sort as `-Infinity`, so they are evicted first — the store trims + migrates).
 */
function writeKey(key: string, url: string): void {
	const clean = (url ?? '').trim();
	if (!clean) return; // no-op — never cache an empty cover (keeps the gradient)
	try {
		const rec = readRecord();
		rec[key] = { u: clean, t: Date.now() }; // lazy upgrade: always the new timestamped shape
		if (Object.keys(rec).length > MAX_ENTRIES) {
			// Evict oldest-write-first: sort by ascending effective-t, drop from the front until
			// at/under the cap. O(n log n) on an infrequent write path — clear and correct.
			const ordered = Object.entries(rec).sort((a, b) => entryTime(a[1]) - entryTime(b[1]));
			let i = 0;
			while (Object.keys(rec).length > MAX_ENTRIES && i < ordered.length) {
				delete rec[ordered[i][0]];
				i++;
			}
		}
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
