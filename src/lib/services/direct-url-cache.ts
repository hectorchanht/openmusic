// quick-261006-r2 — CLIENT-SIDE DIRECT-URL RESOLVE CACHE.
//
// fetchDirectStreamUrl's JSON hop is sub-second, but replaying a song (or seeking back after an
// <audio> error) paid it AGAIN every time: the adapter only reuses a direct URL it still has on the
// TRACK, and recovery paths (reresolveCurrent) deliberately null audioUrl before re-resolving. So
// every replay was a fresh /api/stream-url round-trip for a URL that was resolved seconds earlier.
// This cache memoizes successful resolves in memory.
//
// SAFETY CONTRACT (why a 10-minute fixed TTL is the right call, not expiry parsing):
//   - Keyed by `source:songid` — nothing else affects the returned URL: the edge allowlist maps
//     `source` to a FIXED upstream template and the same songid always answers the same CDN URL.
//   - FIXED 10-minute TTL, comfortably under typical signed-URL lifetimes (the netease CDN URLs the
//     edge follows live ~hours; audius GCS signatures longer). Reads expire entries; a URL is NEVER
//     served past the TTL — when in doubt we re-resolve. Deliberately NOT parsed out of URL
//     formats: too many formats (query sigs, path tokens), too brittle, and a wrong parse is worse
//     than a short TTL.
//   - The 10-minute window sits strictly INSIDE track-ready's 15-minute hasFreshAudioUrl guard, so
//     the two TTLs cannot disagree: anything this cache serves is fresh by the track guard's
//     definition too.
//   - ONLY successes are cached — failures are never written (a dead URL must not pin the track).
//   - reportDeadDirectUrl(url) invalidates any entry that served that URL. It is SELF-GATING (a URL
//     the cache never served is a no-op, same contract as reportDeadUrl in resolve-cache-client),
//     so the player calls it unconditionally on every audio.error and the download leg calls it
//     whenever its direct-first attempt falls back to the proxy. A dead URL is never re-served.
//   - Downloads do NOT consult this cache: they resolve through ensureTrackDetails + the
//     hasFreshAudioUrl age check (their own leg, their own 15-min TTL). They DO report into it,
//     so a URL a download just proved dead is gone for playback too.
//   - Bounded (64 entries, oldest-out): an in-memory Map on a phone must not grow unbounded.
//   - In-memory only: nothing survives a page reload, which is the natural staleness bound.
//
// Pure, dependency-free (type-only import), node-testable — the repo's "pure functions extracted
// for testability" convention. Plain module fields, never reactive (nothing here is UI-read).
import type { DirectSource } from './stream-url';

/** 10 minutes — comfortably under typical signed-URL lifetimes; never served past it. */
const DIRECT_URL_TTL_MS = 10 * 60 * 1000;

/** A long session replays at most a handful of distinct songs; the cap only stops unbounded growth. */
const DIRECT_URL_CACHE_CAP = 64;

type CacheEntry = { url: string; expiresAt: number };

/** Keyed `${source}:${songid}` — the only two inputs that affect the resolved URL. Insertion-ordered. */
const cache = new Map<string, CacheEntry>();

function keyOf(source: DirectSource, songid: string): string {
	return `${source}:${songid}`;
}

/**
 * The cached direct URL for (source, songid), or null on miss/expiry. Expired entries are evicted
 * on read so a later reportDeadDirectUrl scan never trips over them.
 */
export function getCachedDirectUrl(source: DirectSource, songid: string): string | null {
	const key = keyOf(source, songid);
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() >= entry.expiresAt) {
		cache.delete(key);
		return null;
	}
	return entry.url;
}

/**
 * Memoize a SUCCESSFUL resolve. Callers only ever write successes — failures are never cached, so
 * a transient /api/stream-url failure cannot pin a track to "no direct URL" for ten minutes.
 */
export function setCachedDirectUrl(source: DirectSource, songid: string, url: string): void {
	if (cache.size >= DIRECT_URL_CACHE_CAP) {
		// Oldest-out — Map preserves insertion order, so the first key is the oldest.
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	// delete-then-set: re-caching the same key refreshes its recency AND its TTL.
	cache.delete(keyOf(source, songid));
	cache.set(keyOf(source, songid), { url, expiresAt: Date.now() + DIRECT_URL_TTL_MS });
}

/** Key-based invalidation (the caller knows source+songid). */
export function invalidateDirectUrl(source: DirectSource, songid: string): void {
	cache.delete(keyOf(source, songid));
}

/**
 * URL-based invalidation for failure paths that only have the URL in hand (the player's
 * audio.error handler, the download leg's direct-first fallback). SELF-GATING: a URL this cache
 * never served is a silent no-op — callers need no provenance check. Removes every entry serving
 * the URL (pathological duplicates included) so a dead URL is never re-served.
 */
export function reportDeadDirectUrl(url: string): void {
	if (!url) return;
	for (const [key, entry] of cache) {
		if (entry.url === url) cache.delete(key);
	}
}

/** TEST-ONLY: drop all entries so module state cannot leak across tests. Mirrors `__resetGovernor`. */
export function __resetDirectUrlCache(): void {
	cache.clear();
}
