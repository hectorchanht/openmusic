// row-cover — the ONE shared cover read order for every track row (quick-260910-qwt).
//
// WHY THIS EXISTS: the resolve side was already unified (one `resolveCoverForTrack` chain, one
// two-layer cache) but the READ side was not — search, library (×4), artist hit-songs and CompactRow
// each painted from a component-local `resolvedCovers` map that only fills when THAT surface's
// `use:lazyCover` fires on intersection. A cover resolved on one surface was cached but invisible to
// every other one until its next fresh render. `upNextTileCover` (quick-260910-q5a) already solved
// this for the Up-Next tile with a three-rung read; this module is that helper MOVED and generalised
// so every row surface shares the ONE read order:
//
//   0. `pinned`   — the cover the USER explicitly chose in the TrackMenu cover picker
//      (quick-260915-w4f). It leads because the whole point of a pin is that no resolver
//      preference applies any more — and in particular it must beat rung 2 (`track.cover`), which
//      is exactly where the first-solid-wins chain's wrong answer usually sits. Like rung 3 it is
//      passed IN so the CALL SITE takes the `coverVersion()` dependency and this module stays a
//      pure, node-testable `.ts`. A pin is NEVER skipped as dead: dropping a user's explicit choice
//      is healCover's deliberate narrow path (failed probe → unpinCover), not a read's job.
//      Phase 40 D-14: the call site now passes the CHOSEN cover — the pin, then the crowd-shared
//      pick — as `readChosenCover(uid, artist, title)`. A pin still beats the crowd.
//   1. `resolved` — the surface's component-local lazyCover / carousel map. Kept FIRST so a D-15
//      repaired URL (lazyCover probed `track.cover`, found it dead, re-resolved) still beats the
//      broken `track.cover` sitting in rung 2.
//   2. `seeded`   — `track.cover`: a real source cover, the Gap 3 (26-07) Last.fm seed, or a
//      quick-260910-piz attached ALBUM cover. MUST stay ahead of the cache so an album's art is
//      never displaced by a per-track image — UNLESS it is a known-dead URL (quick-261020-dcvr):
//      a dead seeded URL painted a broken tile (→ gradient) while SHADOWING the live cache at
//      rung 3, and lazyCover's one-shot never re-probed it. Dead marks come from Image() probes
//      (lazyCover D-15, player.healCover), so a skipped URL is proven-unloadable, never a guess.
//   3. `cached`   — the shared cover cache. The caller passes `readCoverByUidOrName(uid, artist,
//      title)` IN, so the CALL SITE takes the `coverVersion()` dependency (its row repaints the
//      instant a cover lands anywhere) while this module stays a pure `.ts` — no runes, no store, no
//      cache import, node-Vitest-testable like upnext-covers.ts / match-key.ts.
//
// `''` is a MISS at every rung: an empty string would otherwise render `url()` (a broken tile).
// A total miss returns null and the caller paints its gradient.
//
// This is a READ, never a fetch: binding a row to rung 3 costs zero network. Do NOT "improve" it by
// adding a per-row resolve — the Up-Next / Related lists are fed by ONE capped `backfillCovers`
// pass precisely because per-tile `use:lazyCover` there was the observed /api/deezer/search flood
// (T-26-10-01).

import { isCoverUrlDead } from '$lib/services/dead-cover-urls';

/**
 * A track row's cover URL: `pinned` → `resolved` → `seeded` (skipped when known-dead) →
 * `cached` → null (gradient). See the module header for what each rung is and why the pin +
 * cache reads are passed in rather than read here.
 */
export function pickRowCover(
	pinned: string | null | undefined,
	resolved: string | undefined,
	seeded: string | null | undefined,
	cached: string | null
): string | null {
	if (pinned) return pinned;
	if (resolved) return resolved;
	// quick-261020-dcvr: a seeded URL proven dead by an Image() probe must not shadow the live
	// cache — skip it so rung 3 shows through. Anything not marked dead keeps its rung.
	if (seeded && !isCoverUrlDead(seeded)) return seeded;
	return cached || null;
}

