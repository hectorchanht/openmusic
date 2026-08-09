// Shared Cloudflare edge-cache accessor for the /api/* proxy routes (quick-260713-mqv).
//
// Consolidates the EdgeCache/EdgeCacheStorage narrowing + the `edgeCache()` accessor that was
// copy-pasted across 11 proxy routes (a CLAUDE.md Anti-Pattern: cache-write duplication). This
// is a pure no-behavior-change extraction — every consumer's caching behavior, TTLs, CORS
// re-application and cache-key construction stay exactly as they were.
//
// The Cloudflare Cache API extends the standard CacheStorage with a `default` cache
// (caches.default). The DOM lib's CacheStorage (pulled in by SvelteKit's generated tsconfig)
// does NOT declare `default` and shadows @cloudflare/workers-types' global, so we narrow
// through a minimal local interface for the subset we use. Absent in the dev runtime
// (`vite dev`) — guarded with `typeof caches` before use.
export interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
	/**
	 * 31-D-09: drop one entry. The bust is PoP-LOCAL — `cache.delete` purges only the data center
	 * this Worker instance ran in, so this is repair-on-encounter, never a global purge. A proper
	 * interface member (never a cast at the call site); do NOT reach for @cloudflare/workers-types'
	 * CacheStorage instead — the DOM lib shadows it, which is the whole reason this narrowing
	 * interface exists.
	 */
	delete(request: Request): Promise<boolean>;
}
interface EdgeCacheStorage {
	default?: EdgeCache;
}

/**
 * The Cloudflare `caches.default` edge cache, or `null` under a runtime without the Cache API
 * (`vite dev`) so local dev still hits live upstream. Every /api/* route reads through this so
 * there is exactly ONE `typeof caches` guard in the repo (quick-260713-mqv).
 */
export function edgeCache(): EdgeCache | null {
	if (typeof caches === 'undefined') return null;
	return (caches as unknown as EdgeCacheStorage).default ?? null;
}

/**
 * Build the OWN-ORIGIN cache key for a request. The cache key MUST be the own-origin URL, NEVER
 * the secret-bearing upstream URL (a LASTFM_KEY / JOOX-token upstream URL must never leak into a
 * cache key — T-09-05 / T-2os-02 / T-wv8-06). Centralizing this documents the invariant in one
 * place (quick-260713-mqv).
 */
export function ownOriginCacheKey(url: URL | string): Request {
	return new Request(url.toString());
}
