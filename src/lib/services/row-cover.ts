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
//      preference applies any more — and in particular it must beat rung 4 (`track.cover`), which
//      is exactly where the first-solid-wins chain's wrong answer usually sits. Like rung 5 it is
//      passed IN so the CALL SITE takes the `coverVersion()` dependency and this module stays a
//      pure, node-testable `.ts`. A pin is NEVER skipped as dead: dropping a user's explicit choice
//      is healCover's deliberate narrow path (failed probe → unpinCover), not a read's job.
//      Phase 40 D-14: the call site now passes the CHOSEN cover — the pin, then the crowd-shared
//      pick — as `readChosenCover(uid, artist, title)`. A pin still beats the crowd.
//   1. `explicit` — a cover the HOST deliberately passed for this row (the `cover` prop: an album
//      page's uniform album art). NEW as its own rung in quick-261020-latest — it used to be merged
//      into `seeded`, which would now rank it below the cache. A host's deliberate art must never
//      lose to an auto-resolved one.
//   2. `cached`   — the shared cover cache, read NAME-FIRST (quick-261020-latest). Every writer
//      persists the same URL to both layers, so the name entry is always the LATEST cover written
//      for the song — Hector's 2026-10-20 directive: the same song shows the same cover everywhere,
//      the latest one. (The old uid-first read let a stale per-uid entry shadow the newer name art:
//      the "row shows A while the nowbar shows B" report.) The caller passes
//      `readCoverByUidOrName(uid, artist, title)` IN, so the CALL SITE takes the `coverVersion()`
//      dependency (its row repaints the instant a cover lands anywhere) while this module stays a
//      pure `.ts` — no runes, no store, no cache import, node-Vitest-testable like
//      upnext-covers.ts / match-key.ts.
//   3. `resolved` — the surface's component-local lazyCover result. Ranks below the cache now: a
//      newer cross-surface write (the cache rung) must win over this row's older one-shot result —
//      that staleness was the other half of the "row shows A while the nowbar shows B" report. (The
//      old D-15 rationale — a repaired URL beating a broken `track.cover` — is preserved through
//      the cache rung: lazyCover's chain path writes both layers before reporting, and the dead
//      seeded URL is skipped at rung 4 regardless.)
//   4. `seeded`   — `track.cover`: a real source cover or the Gap 3 (26-07) Last.fm seed. Ranks below
//      the cache per the latest-wins directive — UNLESS it is a known-dead URL (quick-261020-dcvr),
//      in which case it is skipped outright so it can never shadow the live cache: a dead seeded
//      URL painted a broken tile (→ gradient) while the nowbar showed the healed art, and
//      lazyCover's one-shot never re-probed it. Dead marks come from Image() probes (lazyCover
//      D-15, player.healCover), so a skipped URL is proven-unloadable, never a guess.
//
// `''` is a MISS at every rung: an empty string would otherwise render `url()` (a broken tile).
// A total miss returns null and the caller paints its gradient.
//
// This is a READ, never a fetch: binding a row to rung 2 costs zero network. Do NOT "improve" it by
// adding a per-row resolve — the Up-Next / Related lists are fed by ONE capped `backfillCovers`
// pass precisely because per-tile `use:lazyCover` there was the observed /api/deezer/search flood
// (T-26-10-01).

import { isCoverUrlDead } from '$lib/services/dead-cover-urls';

/**
 * A track row's cover URL: `pinned` → `explicit` → `cached` (name-first = latest) → `resolved` →
 * `seeded` (skipped when known-dead) → null (gradient). See the module header for what each rung is
 * and why the pin + cache reads are passed in rather than read here.
 */
export function pickRowCover(
	pinned: string | null | undefined,
	explicit: string | null | undefined,
	resolved: string | null | undefined,
	seeded: string | null | undefined,
	cached: string | null
): string | null {
	if (pinned) return pinned;
	if (explicit) return explicit;
	// quick-261020-latest: the shared cache (name-first) outranks this row's older one-shot result —
	// a newer cover written anywhere wins everywhere.
	if (cached) return cached;
	if (resolved) return resolved;
	// quick-261020-dcvr: a seeded URL proven dead by an Image() probe must not shadow the live
	// cache — skip it so the gradient (or nothing) shows instead of a broken tile.
	if (seeded && !isCoverUrlDead(seeded)) return seeded;
	return null;
}
