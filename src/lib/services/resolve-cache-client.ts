// resolve-cache-client — the client half of the edge resolve cache (/api/resolve).
//
// POSTURE (31-D-08, copied from deezer.ts — the house never-throw template):
//  - Every network path NEVER throws: a non-ok response / { hit: false } / malformed JSON /
//    a caller abort / the per-call timeout / an OPEN circuit breaker all return null. A null
//    means "no cached data — resolve normally", never a rejection into the render tree.
//  - That mapping is what makes 31-D-08's "the cache is ADVISORY, never AUTHORITATIVE" true in
//    code rather than just in the plan: the caller's pre-existing resolve path runs untouched on
//    every one of those outcomes, and the user sees nothing.
//  - 31-D-11 goes further and treats the FAILURE path as the load-bearing one: a globally-shared
//    audio URL can be IP- or region-bound and WILL 403 for some other user. reportDeadUrl is that
//    repair, and it is SELF-GATING (see the served-url registry below) so no caller has to know
//    whether a URL came from the cache.
//  - Every call goes through the apiFetch governor. A raw fetch to /api/* would bypass the
//    concurrency cap, the GET dedupe and the circuit breaker — the named `api-fetch-flood-freeze`
//    root cause. No second throttle/debounce is added here for the same reason.
//  - NO secret, NO new npm dependency, NO reactive state (this is a pure service, not a runes
//    store — nothing here is UI-read, so every module field is a plain Map/Set).
//
// Deliberately NOT wrapped in cached()/ttl-cache: catalog.ts documents that the client TTL cache
// caches search METADATA only and never short-lived resolved audio URLs. 31-D-06(b) breaks that
// rule at the EDGE layer only, where the TTL and the bust live together.
import type { ResolveEntry } from '$lib/proxy/resolve-cache';
import { apiFetch } from './api-base';

const RESOLVE_PATH = '/api/resolve';

/**
 * 31-D-08: the tight deadline. A cache MISS must not measurably delay a cold play, so the lookup
 * is bounded hard and falls straight through to the normal resolver. This is ONE own-origin
 * lookup placed serially ahead of ONE source resolve — NOT the 31-D-02-rejected hedged/parallel
 * multi-source race, and 31-D-01's RESOLVE_WATCHDOG_MS (6000) is untouched.
 */
const RESOLVE_CACHE_TIMEOUT_MS = 400;

/**
 * How many served URLs stay reportable. A handful of plays are ever in flight; the cap only
 * exists so a long session cannot grow these unboundedly. Oldest-out (Map/Set preserve insertion
 * order), plain fields — never reactive (C-02).
 */
const SERVED_CAP = 32;

/**
 * The served-url registry: every audio URL THIS cache handed out, mapped back to the terms that
 * would bust its entry. This is what makes reportDeadUrl self-gating — the player calls it
 * unconditionally on every audio.error and a URL that came from the normal resolver simply is not
 * in here, so it issues no request at all. Keeping the gate HERE rather than in the store is what
 * avoids adding a fourth provenance flag to an already ~3600-line god object.
 */
const servedUrls = new Map<string, { a: string; t: string }>();

/** URLs already reported once. apiFetch only dedupes body-less GETs, so a POST always reaches the
 *  server — a repeated audio.error on the same dead URL needs this client-side one-shot to not
 *  storm the bust endpoint (T-31-04-02). */
const reported = new Set<string>();

/** TEST-ONLY: drop the registry + one-shot set so module state cannot leak across tests. Mirrors
 *  api-base's `__resetGovernor`. No production caller. */
export function __resetResolveCacheClient(): void {
	servedUrls.clear();
	reported.clear();
}

/** Insert with oldest-out eviction, re-inserting to refresh recency. */
function remember(url: string, a: string, t: string): void {
	servedUrls.delete(url);
	servedUrls.set(url, { a, t });
	if (servedUrls.size > SERVED_CAP) {
		const oldest = servedUrls.keys().next().value;
		if (oldest !== undefined) servedUrls.delete(oldest);
	}
}

/**
 * Combine the caller's AbortSignal (if any) with the per-call deadline so a hung lookup always
 * settles. Copied from deezer.ts — AbortSignal.any with the `typeof` feature check and a
 * timeout-only fallback (still bounded; the caller's pre-fetch `aborted` check covers the common
 * supersede case).
 */
function combinedSignal(caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(RESOLVE_CACHE_TIMEOUT_MS);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}

/**
 * Bounded GET of the edge cache → the entry, or null for a genuine miss. THROWS on a non-ok
 * response, malformed JSON, abort/timeout or network failure; the exported boundary below maps
 * every one of those to null (the deezer.ts throw-inside / null-outside split).
 */
async function readOrThrow(
	a: string,
	t: string,
	signal?: AbortSignal
): Promise<ResolveEntry | null> {
	const path = `${RESOLVE_PATH}?a=${encodeURIComponent(a)}&t=${encodeURIComponent(t)}`;
	const res = await apiFetch(path, { signal: combinedSignal(signal) }); // governed; abort/timeout REJECT
	if (!res.ok) throw new Error(String(res.status));
	const body = (await res.json()) as { hit?: boolean; entry?: ResolveEntry | null } | null;
	const entry = body?.hit ? (body.entry ?? null) : null;
	// Only a real URL is registered — a dry/known-none entry has nothing to bust on failure.
	if (entry?.url) remember(entry.url, a, t);
	return entry;
}

/**
 * Look the song up in the edge resolve cache. Returns the entry (including a cached known-none,
 * whose `avail` hints still save a source call) or null on a miss OR on any failure whatsoever.
 * Never rejects — 31-D-08.
 */
export async function readResolveCache(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<ResolveEntry | null> {
	if (signal?.aborted) return null;
	const a = (artist ?? '').trim();
	const t = (title ?? '').trim();
	// Nothing to look up → no request at all (mirrors the route's own blank-input short-circuit).
	if (!a && !t) return null;
	return readOrThrow(a, t, signal).catch(() => null);
}

/**
 * 31-D-09 / 31-D-11: report a dead audio URL so the edge drops its entry.
 *
 * SELF-GATING BY CONSTRUCTION: a URL this cache never served is not in the registry, so the call
 * is a silent no-op and issues ZERO requests. That is the whole reason the player's error handler
 * can call this unconditionally with `audio.src` and gain exactly one line — a normally-resolved
 * URL that fails is never reported.
 *
 * One-shot per URL, fire-and-forget, returns void, never rejects. The bust is delete-only at the
 * edge and PoP-local, so the worst case of a spurious report is one cold resolve.
 */
export function reportDeadUrl(url: string): void {
	if (!url) return;
	const terms = servedUrls.get(url);
	if (!terms) return; // never served from the cache — nothing to repair
	servedUrls.delete(url);
	if (reported.has(url)) return;
	reported.add(url);
	if (reported.size > SERVED_CAP) {
		const oldest = reported.values().next().value;
		if (oldest !== undefined) reported.delete(oldest);
	}
	void apiFetch(RESOLVE_PATH, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ a: terms.a, t: terms.t })
	}).catch(() => {
		// Best-effort repair: a bust that does not land just means the next play in this PoP still
		// gets the stale entry and reports again. It must never surface as a playback failure.
	});
}
