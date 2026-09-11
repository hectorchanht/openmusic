// upnext-covers — the two PURE decisions behind Up-Next cover art (quick-260910-q5a).
//
// WHY THIS EXISTS: Gap 3 (26-07) seeds a similarity stub's cover from the Last.fm `track.getSimilar`
// image, and Gap 3 (26-10) then deliberately removed the per-tile `use:lazyCover` chain from the
// Up-Next list because it was the observed /api/deezer/search flood (T-26-10-01). That left the list
// depending entirely on the 26-07 seed — and the seed is DEAD IN PRACTICE: a live probe of 20
// `track.getSimilar` pairs returned `withImage: 0`. So a similarity-generated Up Next renders as 20
// gradients and nothing that lands later can ever repaint it (the tile read was not bound to the
// shared reactive cover cache either).
//
// The fix is a bounded, post-paint fill through the EXISTING sanctioned `backfillCovers` (Deezer →
// iTunes → CN, CAP=6 pool, skip-cached, 5-min negative-miss memo), fired from ONE gated `$effect` in
// NowPlaying.svelte. This module owns the two pure decisions that effect needs, so the component
// stays a thin caller and both decisions are node-testable:
//   - upNextCoverNeeds() — which rows are worth submitting (and how many).
//   - upNextTileCover()  — the tile's cover read order.
// Pure `.ts`: no runes, no store import, no cache read — node-Vitest-testable like match-key.ts.
import { matchKey } from '$lib/services/match-key';
import type { CoverNeed } from '$lib/services/cover-backfill';
import type { Track } from '$lib/sources/types';

/**
 * Hard bound on rows submitted per fill. Equals SIMILAR_TRACK_LIMIT — one attempt per generated row.
 * The stated cost: ≤20 tier-1 `/api/deezer/search` calls per fill, ≤6 in flight (backfillCovers'
 * CAP=6 pool). iTunes (a direct CORS-open fetch, not `/api`) and the CN `searchAll` tier fire ONLY
 * per Deezer-miss row, so the worst case (all 20 miss Deezer — a CN-heavy list) is
 * 20 × (1 Deezer + 1 iTunes + one CN fan-out), still behind the `apiFetch` governor (8 concurrent,
 * GET dedupe, circuit breaker) and the 5-min negative-miss memo.
 *
 * Do NOT add another throttle in this module: composing local bounds on top of the governor was the
 * `api-fetch-flood-freeze` root cause. One cap, one pool, one governor.
 */
export const UPNEXT_COVER_MAX = 20;

/** SOLID = a non-empty https URL — the only thing worth keeping (mirrors cover-backfill's isSolidCover
 *  and similar.ts / share.ts `isHttpsUrl`; kept INLINE so this module stays store- and cache-free). */
function isHttps(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
}

/**
 * Pick the Up-Next rows that still need a cover, de-duped and capped.
 *
 * Skips any row that already carries an https cover — that covers a real source cover AND a
 * quick-260910-piz album seed, so an album-installed queue is never even submitted to the backfill.
 * Drops fully blank rows, de-dupes by `matchKey` (first occurrence wins), then slices to `max`.
 *
 * It deliberately does NOT consult the cover cache: `backfillCovers` already skips cached and
 * recently-missed rows, and keeping cache reads OUT of here means the calling `$effect` never takes a
 * `coverVersion()` dependency — i.e. `onResolved → bumpCoverVersion` cannot re-trigger the effect
 * that started the fill (cf. `restore-effect-self-invalidation-loop`, T-q5a-03).
 */
export function upNextCoverNeeds(
	list: ReadonlyArray<Pick<Track, 'artist' | 'title' | 'cover'>>,
	max: number = UPNEXT_COVER_MAX
): CoverNeed[] {
	const seen = new Set<string>();
	const needs: CoverNeed[] = [];
	for (const t of list) {
		if (isHttps(t.cover)) continue; // already has art (source cover / piz album seed)
		const artist = t.artist ?? '';
		const title = t.title ?? '';
		if (!artist && !title) continue;
		const key = matchKey(artist, title);
		if (seen.has(key)) continue;
		seen.add(key);
		needs.push({ artist, title });
	}
	return needs.slice(0, Math.max(0, max));
}

/**
 * The Up-Next tile's cover read order — `resolved` → `seeded` → `cached` → null (gradient).
 *
 *  - `resolved`: the 26-10 carousel-fed `resolvedCovers[uid]` map, kept FIRST exactly as before.
 *  - `seeded`:   `track.cover` (a real source cover or a quick-260910-piz attached album cover) —
 *                MUST stay ahead of the cache so an album's art is never displaced by a per-track image.
 *  - `cached`:   the shared reactive cover cache (its name layer bridges a synthetic stub uid to the
 *                real uid), which is what lets a cover landing from ANY surface repaint the tile live.
 *
 * `''` is a MISS at every rung (an empty string would otherwise render `url()`).
 */
export function upNextTileCover(
	resolved: string | undefined,
	seeded: string | null | undefined,
	cached: string | null
): string | null {
	return resolved || seeded || cached || null;
}
