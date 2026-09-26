// Tiny reusable in-memory TTL cache (D-04). Mirrors the EDGE cache pattern in
// /api/lastfm/discovery/+server.ts (a Map keyed by request with a per-entry
// expiry), adapted to a client-side in-memory Map. Pure + node-testable.
//
// Caches the RESOLVED value only — never the in-flight promise — so a rejection
// is NOT cached (the next call retries) and an AbortSignal on a cache HIT is
// irrelevant (a hit has nothing in flight to abort). The store lives at module
// scope; on the Cloudflare worker that means it is shared across concurrent SSR
// requests for the worker lifetime, which is acceptable here because the cached
// value is public search/discovery metadata keyed by (query|sources|page) — it
// carries no per-user state (see threat T-14-02: the key prevents cross-query
// poisoning).
//
// quick-260926-l69 adds two optional seams, both backward compatible:
//  - `shouldStore`: a factory that NEVER rejects (catalog's DATA-03 contract maps a per-source
//    throw to a `status:'error'` row) needs a way to say "this value is not worth pinning", or a
//    transient miss replays for the whole TTL with zero network.
//  - `evictCached(prefix)`: an explicit user retry needs a SCOPED eviction that does not nuke the
//    deezer/lastfm/musicbrainz/chart entries sharing this store (they namespace their keys).

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Memoize an idempotent async `factory` under `key` for `ttlMs`.
 *
 * - First call (or after expiry / a prior rejection): invokes `factory`, and on
 *   SUCCESS stores the resolved value with `expiresAt = now + ttlMs`.
 * - A subsequent call within `ttlMs` with the same `key` returns the cached
 *   value WITHOUT invoking `factory` again.
 * - On rejection nothing is cached, so the next call re-invokes (retry).
 * - quick-260926-l69: when `shouldStore` is given and returns false for the resolved value, it is
 *   returned but NOT cached (same effect as a rejection, minus the rejection).
 */
export function cached<T>(
	key: string,
	ttlMs: number,
	factory: () => Promise<T>,
	shouldStore?: (value: T) => boolean
): Promise<T> {
	const hit = store.get(key);
	if (hit && hit.expiresAt > Date.now()) {
		return Promise.resolve(hit.value as T);
	}
	const p = factory();
	// Only cache on success; swallow rejection so a failed fetch is NOT cached
	// (the .catch here is just to drop — the original promise is what we return,
	// so the caller still sees the rejection).
	p.then((v) => {
		if (!shouldStore || shouldStore(v)) store.set(key, { value: v, expiresAt: Date.now() + ttlMs });
	}).catch(() => {});
	return p;
}

/** quick-260926-l69: drop every entry whose key starts with `prefix` (scoped user-retry eviction). */
export function evictCached(prefix: string): void {
	for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

/** Empty the cache. Exported so tests can reset between cases (`afterEach`). */
export function __clearSearchCache(): void {
	store.clear();
}
