// PURE — no SW runtime, node-testable.
//
// This module is the node-Vitest-testable core of the service-worker fetch handler
// (OFFL-01). The service worker (src/service-worker.ts, Plan 03) merely WRAPS these
// helpers — exactly as the runes sleep-timer store wraps src/lib/services/sleep-timer.ts.
//
// The branchy, security-load-bearing bypass decision (what the SW must NEVER cache:
// live /api/* metadata, cross-origin audio CDN responses, 206 range streams, and any
// non-GET) lives HERE so it can be unit-tested in the node project with NO SW runtime.
// `shouldBypass` takes STRUCTURAL inputs (a plain `{ method, headers }`, not a real
// Request) and `selfOrigin` as an explicit string param — it does NOT read
// `location`/`self`, which are not node-testable; the SW wrapper passes `location.origin`.
//
// NO imports from `$app/environment`, `$service-worker`, or any runtime global.

/**
 * True when the SW must bypass its cache and let the request hit the network directly.
 * Order of the four bypass rules (T-24-01 mitigation — guarantees no stale-auth / cross-user
 * metadata leak / stale media is ever served from cache):
 *   1. non-GET method                       → never cache mutations
 *   2. cross-origin (`url.origin !== selfOrigin`) → covers ALL audio CDNs
 *   3. a `range` header is present          → 206 partial streams are never cacheable
 *   4. same-origin `/api/*` path            → live metadata is never cached
 * Otherwise (same-origin, GET, non-/api/, no range) → false (cacheable app-shell asset).
 */
export function shouldBypass(
	url: URL,
	request: { method: string; headers: Headers },
	selfOrigin: string
): boolean {
	if (request.method !== 'GET') return true;
	if (url.origin !== selfOrigin) return true;
	if (request.headers.has('range')) return true;
	if (url.pathname.startsWith('/api/')) return true;
	return false;
}

/**
 * The version-keyed cache name (T-24-02 mitigation). A new build ships a new `version`
 * hash → a new cache name → the activate handler (Plan 03) deletes every cache !== this
 * one, so a deploy rotates the cache and stale shells cannot poison the new build.
 */
export function cacheNameFor(version: string): string {
	return `cache-${version}`;
}
