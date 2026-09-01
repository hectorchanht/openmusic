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
 *
 * 32-D-20 bumps '2' → '3': the payload GAINED `url`/`urlExp`/`urlQuality`. A v2 entry read as v3
 * would present as "this song never has a url", which is survivable — but the rule above is
 * CATEGORICAL on purpose. There is no remediation after deploy (`cache.delete` is PoP-local), so
 * "survivable" is not a licence to skip the bump; the next shape change might not be survivable and
 * the discipline is what makes that safe.
 */
export const RESOLVE_CACHE_VERSION = '3';

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

/**
 * 15 minutes — how long a cached PLAYABLE URL is trusted (32-D-20).
 *
 * Same NUMBER as RESOLVE_TTL_S, deliberately a different NAME: `RESOLVE_TTL_S` now means "how long
 * a NEGATIVE is pinned" and this means "how long a signed CN audio url is trusted". The two
 * concepts must stay independently tunable, so never collapse them back into one constant.
 *
 * 900s is the value Phase 31 shipped and MEASURED working (0.44s to playable on a hit). A url that
 * dies INSIDE the window is not the TTL's job — that is the 31-D-09 bust plus the client's
 * reported-dead strip, because a signed url can be IP/region-bound and 403 for one user while
 * serving another perfectly (31-D-11).
 *
 * `urlExp` is BAKED AT WRITE (`Date.now() + RESOLVE_URL_TTL_S * 1000`), so a read is one integer
 * comparison and a re-tune applies to new writes only — fine for a 15-minute window.
 */
export const RESOLVE_URL_TTL_S = 900;

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
 * 32-D-20 PUTS `url` BACK, beside the permanent mid — a deliberate partial reversal of the line
 * above, not a drift. That reasoning ("it was the only reason this entry had to expire") was true
 * when the entry had ONE lifetime; 32-D-10a then made permanence a property of the PAYLOAD, which
 * turns a mixed-lifetime entry into a solved problem. So the mid keeps its year and the url keeps
 * its own 15 minutes, expressed as an in-payload `urlExp` the EDGE checks at read time. Motive:
 * a mid still costs a 2.0-3.8s tang detail RTT to become playable, whereas a cached url is the
 * Phase-31-measured 0.44s-to-playable path.
 *
 * ACCEPTED RISK, re-accepted with eyes open (31-D-11): a globally shared signed CN url can be IP-
 * or region-bound and WILL 403 for some other user in this PoP. Three mitigations carry it, and
 * all three must stay: the entry is ADVISORY and never authoritative (31-D-08 — a url that does
 * not work falls through to the mid path and plays); a dead url is repaired by the POST bust
 * (31-D-09); and the client strips a url it has already reported dead at its ONE read seam
 * (resolve-cache-client.ts), which closes the async-bust race. From the user's seat a 403 hit must
 * be indistinguishable from a url MISS.
 *
 * A clean negative is the all-null form with `avail: { qq: 'dry' }`, and it keeps RESOLVE_TTL_S.
 */
export interface ResolveEntry {
	source: string | null;
	songid: string | null;
	avail: Record<string, 'ok' | 'dry'>;
	/** The playable audio url, or null when the entry has never been (or is no longer) url-warm. */
	url: string | null;
	/** Epoch ms this url stops being trusted. EDGE-clock bookkeeping: the route nulls a stale url
	 *  out of the view it serves, so the CLIENT never reads this field and never judges freshness —
	 *  one clock, one authority. */
	urlExp: number | null;
	/** The effective tier the url serves ('lossless' by construction today). A shared single url
	 *  cannot serve two tiers, so the client adopts it only for a tier-MATCHING caller — a cellular
	 *  'auto' user must never be handed a 50MB FLAC url. */
	urlQuality: string | null;
}

/**
 * Is this entry's url still trusted? 32-D-20 — the whole freshness rule, in one pure predicate so
 * the route has no clock logic of its own. A url with no `urlExp` is never fresh (fail closed).
 */
export function urlIsFresh(entry: ResolveEntry, now: number): boolean {
	return Boolean(entry.url && entry.urlExp !== null && entry.urlExp > now);
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
 * 32-D-20 leaves this branch BYTE-IDENTICAL: the `songid` alone still decides the stored
 * Cache-Control. The url deliberately does NOT influence it — its lifetime is `urlExp` INSIDE the
 * payload, because the Cache API stores one Response per key with one max-age and a mixed-lifetime
 * entry is only expressible that way. Shortening this max-age "because the entry now holds a url"
 * would silently throw away 32-D-10's permanent-mid win.
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
