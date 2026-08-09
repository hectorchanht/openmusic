// Edge resolve-cache primitives for /api/resolve (phase 31, D-06/D-07/D-09).
//
// WHY THIS MODULE EXISTS: a SvelteKit `+server.ts` may export ONLY HTTP verbs. A top-level
// non-verb `export function` in a route file 500s at REQUEST time ("Invalid export") and unit
// tests miss it entirely because they import the module directly (project finding
// `svelte-server-endpoint-only-verb-exports`). Same reason `$lib/proxy/deezer-cover.ts` exists
// (C-16). Pure, edge-side, no route logic — node-testable.
//
// 31-D-07: store is `caches.default` ONLY. No new Cloudflare binding, no KV, no secret. The
// key is always built through `ownOriginCacheKey` so a secret-bearing upstream URL can never
// become a cache key (T-09-05 / T-wv8-06) — kuwo needs no auth, so nothing is even in scope.
import { type EdgeCache, ownOriginCacheKey } from './edge-cache';
import { matchKey } from '$lib/services/match-key';

/**
 * Entry-shape version, carried IN the key. A shape change is a KEY change, never an in-place
 * migration: `cache.delete` is PoP-local (31-D-09) so old entries cannot be purged globally —
 * bumping `v` simply makes every PoP miss onto the new namespace and lets the old one expire.
 */
export const RESOLVE_CACHE_VERSION = '1';

/**
 * 15 minutes. CN audio URLs are signed and short-lived, so a long TTL just pins dead URLs;
 * an entry that dies EARLIER is handled by the D-09 bust (the client reports the failure and
 * the edge drops the entry) rather than by a shorter TTL for everyone.
 */
export const RESOLVE_TTL_S = 900;

/** Ingress cap on `a`/`t` — the /api/og MAX_TERM_CHARS precedent (T-31-03-07). */
export const MAX_TERM_CHARS = 200;

/**
 * ONE entry, three payload fields — D-06(a) the name+artist → songid lookup, D-06(b) the
 * resolved audio URL, D-06(c) the per-source availability hint. Deliberately NOT three
 * separate cache layers: both payloads are tiny JSON, and splitting them would double the
 * key-management and the bust surface for no benefit.
 *
 * A clean negative is the all-null form with `avail: { kuwo: 'dry' }`.
 */
export interface ResolveEntry {
	source: string | null;
	songid: string | null;
	url: string | null;
	avail: Record<string, 'ok' | 'dry'>;
}

/**
 * The versioned, NORMALIZED synthetic own-origin cache key. `/api/resolve/_k` is NOT a real
 * route — it is a pure key namespace, exactly like `/api/og/_resolve`. Normalizing through
 * `matchKey()` collapses case, spacing, punctuation and query-order variants onto ONE entry.
 *
 * The route takes RAW `a`/`t` and normalizes here because `matchKey` is lossy (a key cannot be
 * turned back into a search query) — which also means a client can never hand-craft a key
 * namespace of its own.
 */
export function resolveCacheKey(origin: string, artist: string, title: string): Request {
	return ownOriginCacheKey(
		`${origin}/api/resolve/_k?v=${RESOLVE_CACHE_VERSION}&k=${encodeURIComponent(matchKey(artist, title))}`
	);
}

/** Trim + cap one request term so a pathological input cannot build a giant upstream URL. */
export function capTerm(v: string | null): string {
	return (v ?? '').trim().slice(0, MAX_TERM_CHARS);
}

/**
 * Read the resolve entry. THREE-VALUED, mirroring `/api/og`'s readResolveCache contract:
 * `undefined` = cache miss (go fill), an entry = cached hit, `null` = a cached KNOWN-NONE.
 * Cache reads are best-effort — a broken Cache API degrades to "miss", never to a 500
 * (T-31-03-09).
 */
export async function readResolveEntry(
	cache: EdgeCache | null,
	key: Request
): Promise<ResolveEntry | null | undefined> {
	if (!cache) return undefined;
	try {
		const hit = await cache.match(key);
		if (!hit) return undefined;
		const body = (await hit.json()) as ResolveEntry | null;
		return body ?? null;
	} catch {
		return undefined;
	}
}

/**
 * Write the resolve entry. NEGATIVE-CACHING RULE (D-06(c)), the same discipline `/api/og`
 * records: a CLEAN "kuwo searched and this song is not there" IS written
 * (`{ source: null, songid: null, url: null, avail: { kuwo: 'dry' } }`) because a genuine
 * negative makes the repeat crawl cost ZERO subrequests. An upstream FAULT (network error,
 * non-200, contract drift) must write NOTHING — a fault has to be retried next request, not
 * pinned for the whole TTL. Enforcing that is the CALLER's job: `resolveOnEdge` returns null
 * on a fault and the caller simply does not call this.
 *
 * The stored Response is a FRESH one with an explicit two-header allow-list (T-31-03-04).
 * Never cache the response object that passed through `src/hooks.server.ts` — it carries
 * `Vary: Origin` (which fragments the entry per requester origin) and could carry a
 * requester's `Access-Control-Allow-Origin`; a `Vary: *` would make `cache.put` throw outright.
 */
export async function writeResolveEntry(
	cache: EdgeCache | null,
	key: Request,
	entry: ResolveEntry
): Promise<void> {
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(entry), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'Cache-Control': `public, max-age=${RESOLVE_TTL_S}`
				}
			})
		);
	} catch {
		// Caching is best-effort; a failed write only costs the next request a re-fill.
	}
}

/**
 * 31-D-09 bust. PoP-LOCAL repair-on-encounter: the client reports a dead entry and the data
 * center it reached drops it. Returns false on any failure — a bust that does not land just
 * means the next play in that PoP still gets the stale entry and reports again.
 */
export async function bustResolveEntry(cache: EdgeCache | null, key: Request): Promise<boolean> {
	if (!cache) return false;
	try {
		return await cache.delete(key);
	} catch {
		return false;
	}
}
