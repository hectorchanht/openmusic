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
// 32-D-01: the fill upstream moved kuwo → qq (tang). That is also auth-free (`qqProxy.buildUrl`
// takes no `env`), so the "no secret in scope on this route" property is unchanged.
import { type EdgeCache, ownOriginCacheKey } from './edge-cache';
import { matchKey } from '$lib/services/match-key';

/**
 * Entry-shape version, carried IN the key. A shape change is a KEY change, never an in-place
 * migration: `cache.delete` is PoP-local (31-D-09) so old entries cannot be purged globally —
 * bumping `v` simply makes every PoP miss onto the new namespace and lets the old one expire.
 *
 * 32-D-10 bumped '1' → '2' for exactly the reason above: the payload dropped `url` and `songid`
 * changed MEANING (a kuwo rid became a qq song_mid). A v1 entry read as a v2 entry would hand a
 * kuwo rid to the qq resolver, and there is no global purge — so the version IS the migration.
 */
export const RESOLVE_CACHE_VERSION = '2';

/**
 * 15 minutes — NEGATIVE entries ONLY (narrowed by 32-D-10a; positives use RESOLVE_MID_TTL_S).
 *
 * 32-D-10a: the original wording of 32-D-10 said "no TTL, no bust", on the premise that a
 * `song_mid` never expires. That is true of a POSITIVE payload and FALSE of a negative one. qq
 * search is empirically flaky — it returns 0 rows intermittently under load with no throw
 * (`Skill("spike-findings-openmusic")`, source-resolution.md, 38-song spike) — and a clean 0-row
 * body is byte-indistinguishable from "this song genuinely has no qq version", which
 * `resolve-edge.ts` classifies as DRY and this module caches. Under 900s a false negative
 * self-heals in 15 minutes; permanent, it would pin that song to a LOSSY source for every user in
 * the PoP forever and unrepairably — the precise inverse of the phase goal.
 *
 * (Historical, still true of the shape this replaced: CN audio URLs are signed and short-lived, so
 * a long TTL just pinned dead URLs; an entry that died EARLIER was handled by the D-09 bust rather
 * than by a shorter TTL for everyone.)
 */
export const RESOLVE_TTL_S = 900;

/**
 * One year — POSITIVE entries (32-D-10). A qq `song_mid` is a permanent upstream identifier, so
 * the entry it holds genuinely never goes stale and is written `immutable` (the /api/og:68 proven
 * pattern). This is the whole point of the phase's cache-shape change: the mid outlives every
 * signed URL, so the repeat lookup cost drops to zero calls instead of one search per 15 minutes.
 * A permanent entry that is nonetheless WRONG (a matchKey collision) is repaired by the retained
 * POST bust — see bustResolveEntry.
 */
export const RESOLVE_MID_TTL_S = 31_536_000;

/** Ingress cap on `a`/`t` — the /api/og MAX_TERM_CHARS precedent (T-31-03-07). */
export const MAX_TERM_CHARS = 200;

/**
 * ONE entry, now TWO payload fields — D-06(a) the name+artist → songid lookup and D-06(c) the
 * per-source availability hint. Deliberately NOT separate cache layers: both payloads are tiny
 * JSON, and splitting them would double the key-management and the bust surface for no benefit.
 *
 * 32-D-10: `url` was REMOVED. It was the only reason this entry had to expire — a signed CN audio
 * URL dies in minutes. `songid` is now a PERMANENT qq `song_mid` (never a kuwo rid), and that is
 * the only reason a positive entry can be written permanent (RESOLVE_MID_TTL_S). A mid is NOT
 * playable on its own: the client still spends one qq detail call to turn it into a url + lyrics +
 * duration + cover, which is why 32-D-10b records this as the CALL-count win, not a latency win.
 *
 * A clean negative is the all-null form with `avail: { qq: 'dry' }`, and it keeps RESOLVE_TTL_S.
 */
export interface ResolveEntry {
	source: string | null;
	songid: string | null;
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
 * records: a CLEAN "qq searched and this song is not there" IS written
 * (`{ source: null, songid: null, avail: { qq: 'dry' } }`) because a genuine
 * negative makes the repeat crawl cost ZERO subrequests. An upstream FAULT (network error,
 * non-200, contract drift) must write NOTHING — a fault has to be retried next request, not
 * pinned for the whole TTL. Enforcing that is the CALLER's job: `resolveOnEdge` returns null
 * on a fault and the caller simply does not call this.
 *
 * 32-D-10a — THE TTL SPLIT, and the most dangerous thing in this file to "simplify": permanence is
 * a property of the PAYLOAD, not of the entry. A positive entry (a song_mid) is permanent +
 * immutable; a negative one keeps 900s, because a flaky 0-row qq search writes a negative that is
 * byte-identical to a genuine one, and a permanent false negative would pin that song to a lossy
 * source for the whole PoP forever with no repair. Never unify these two branches.
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
	// 32-D-10a: the PAYLOAD decides. `songid` present = a permanent qq mid; anything else (a DRY
	// negative, or a half-filled entry) gets the short TTL so a false negative self-heals.
	const maxAge = entry.songid ? RESOLVE_MID_TTL_S : RESOLVE_TTL_S;
	const cacheControl = entry.songid
		? `public, max-age=${maxAge}, immutable`
		: `public, max-age=${maxAge}`;
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(entry), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'Cache-Control': cacheControl
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
 *
 * 32-D-10a KEEPS this, against 32-D-10's original "no bust" wording. With a PERMANENT positive
 * entry the bust becomes MORE load-bearing, not less: a matchKey collision (two different songs
 * folding to one key) writes a mid that plays the WRONG song forever, and there is deliberately no
 * client write path (`resolve-edge.ts` header), so delete-on-encounter is the ONLY repair the
 * design has. 32-D-11 requires repair to be possible. Do not delete this or its POST handler.
 */
export async function bustResolveEntry(cache: EdgeCache | null, key: Request): Promise<boolean> {
	if (!cache) return false;
	try {
		return await cache.delete(key);
	} catch {
		return false;
	}
}
