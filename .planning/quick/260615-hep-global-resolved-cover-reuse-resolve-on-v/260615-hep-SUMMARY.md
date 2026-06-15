---
phase: quick-260615-hep
plan: 01
subsystem: cover-pipeline
tags: [covers, reactivity, svelte5-runes, cover-cache, lazyCover, now-playing, homepage]
requires:
  - src/lib/services/cover-cache.ts (pure getters/setters — UNCHANGED)
  - src/lib/services/cover-backfill.ts (resolveCoverForTrack/backfillCovers — UNCHANGED)
  - src/lib/actions/lazyCover.ts (resolve-on-view action — UNCHANGED)
provides:
  - global reactive cover cache-version signal (coverVersion/bumpCoverVersion)
  - canonical both-layers writer (writeCoverBoth) + reactive read helpers
  - now-playing write-back of every displayed https cover into both cache layers
  - homepage uid-first reactive reads + resolve-on-view on real-Track song tiles
affects:
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/+page.svelte
tech-stack:
  added: []
  patterns:
    - "wrap-don't-rewrite: a .svelte.ts reactive wrapper over a pure .ts store keeps node-vitest suites runnable"
    - "single global $state version counter as the cross-render repaint signal"
key-files:
  created:
    - src/lib/stores/cover-version.svelte.ts
  modified:
    - src/lib/stores/player.svelte.ts
    - src/routes/(app)/+page.svelte
decisions:
  - "Reactive signal is a module-scoped $state({n}) in a .svelte.ts wrapper, exposed via coverVersion() (call-to-depend); cover-cache.ts stays pure so its node tests + cover-backfill tests remain green."
  - "writeCoverBoth is the ONE place the both-layers write + bump are paired, so 'every write bumps' holds in a single location."
  - "Discovery tiles (no uid) keep the existing capped scheduleBackfill for resolve-on-view; lazyCover (needs a Track) is wired only on real-Track rows — no synthetic uid stub, no parallel resolver."
metrics:
  duration: ~7 min
  completed: 2026-06-15
---

# Phase quick-260615-hep Plan 01: Global resolved-cover reuse + resolve-on-view Summary

A song cover resolved on the now-playing page is now written into the shared two-layer cover-cache (uid + name) and broadcast via a single global Svelte 5 reactive version signal, so every mounted homepage/library tile for that song repaints live the instant the cover lands — and homepage song tiles now read uid-first and resolve-on-view via the existing lazyCover action. Built entirely on the existing cover-cache / cover-backfill / lazyCover pipeline; no parallel resolver, no second cache.

## What was built

### Task 1 — `src/lib/stores/cover-version.svelte.ts` (new) — commit `0b39d03`
A thin reactive wrapper over the pure cover-cache. Exports:
- `coverVersion()` — reads a module-scoped `$state({ n })`; call it inside a `$derived`/template to take the reactive dependency (global analogue of the old homepage `void coverVer`).
- `bumpCoverVersion()` — increments the signal; called after every cover write.
- `readCoverByUidOrName(uid, artist, title)` / `readCoverByName(artist, title)` / `readArtistCover(artist)` — reactive reads that depend on the signal then delegate to the PURE getters, enforcing the LOCKED uid-first → name → null read order.
- `writeCoverBoth(uid, artist, title, url)` — the canonical both-layers writer: `setCachedCoverByUid` + `setCachedCover` + `bumpCoverVersion`, so the "every write bumps" invariant lives in one place.

SSR-safe: imports only pure functions + runes; no browser globals at module top, no `$effect`/DOM. cover-cache.ts left untouched so cover-cache.test.ts / cover-backfill.test.ts stay node-runnable.

### Task 2 — `src/lib/stores/player.svelte.ts` — commit `42fd3b4`
Wired the now-playing display covers into the shared cache at the three documented sites, gated by a local `httpsOnly` guard (T-0bb-01: only non-empty https URLs are cached/rendered):
- **Site A** (sync set in `play()`): after `this.resolvedCover = track.cover ?? uid-cache ?? name-cache ?? null`, if https → `writeCoverBoth(...)`. Captures the `track.cover` path and re-writes a single-layer cache hit into BOTH layers + bumps.
- **Site B** (`resolved.cover` adoption after `library.adoptCover`): if https → `writeCoverBoth(resolved...)`. The ensureTrackDetails-fetched cover is shared for reuse.
- **Site C** (`resolveCoverAsync` async tier-chain land): `resolveCoverForTrack` already writes both layers internally, so only `bumpCoverVersion()` was added (no double-write) so a late async cover repaints other tiles.

No control-flow / generation-guard / MediaMetadata logic changed.

### Task 3 — `src/routes/(app)/+page.svelte` — commit `435dc9f`
- `tileCover()` now depends on the GLOBAL `coverVersion()` (was local `void coverVer`); track branch routes through `readCoverByName` (DiscoveryTrack has no uid), artist branch through `readArtistCover`.
- `libraryRowCover(track)` and `librarySongRow`'s `rowCover` now read `track.cover ?? readCoverByUidOrName(track.uid, track.artist, track.title)` — fixing the previously-skipped uid layer AND making the read reactive to the global signal.
- `librarySongRow`'s `.al-cover` span gained `use:lazyCover={{ track, onResolved: () => bumpCoverVersion() }}` (mirrors CompactRow's track variant) for resolve-on-view; lazyCover writes both cache layers internally and the bump makes the reactive `rowCover` recompute + the `<img>` paint.
- All FOUR backfill `onResolved` callbacks (topHits/tags/countries, top-artists, and both fav-artist sites) migrated from `coverVer++` to `bumpCoverVersion()` so the homepage backfill feeds the SAME global signal.
- Removed the local `let coverVer = $state(0)`.
- Discovery comfortable `.album` tiles kept the existing capped `scheduleBackfill` for resolve-on-view (no uid → lazyCover not applicable); a one-line comment documents this. No synthetic uid stub, no parallel resolver.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Import path needed the `.svelte` suffix**
- **Found during:** Task 2 (and applied in Task 3)
- **Issue:** The plan specified `import ... from '$lib/stores/cover-version'`, but the project's `.svelte.ts` rune modules are imported WITHOUT the `.ts` extension yet WITH the `.svelte` suffix (e.g. `'$lib/stores/settings.svelte'`). Importing `'$lib/stores/cover-version'` failed module resolution under both svelte-check and the node vitest server project ("Cannot find module").
- **Fix:** Used `'$lib/stores/cover-version.svelte'` in both player.svelte.ts and +page.svelte, matching the established convention.
- **Files modified:** src/lib/stores/player.svelte.ts, src/routes/(app)/+page.svelte
- **Commit:** included in 42fd3b4 / 435dc9f

**2. [Rule 2 - Missing critical functionality] Two additional `coverVer++` sites migrated**
- **Found during:** Task 3
- **Issue:** Beyond the plan-cited backfill onResolved sites, two fav-artist `backfillArtistCovers` callbacks (in the library-cache refresh and the cache-restore paths) still used `coverVer++`. Leaving them would have left a dangling reference to the removed local `coverVer` (compile error) and excluded those resolves from the global repaint.
- **Fix:** Migrated both to `bumpCoverVersion()`.
- **Files modified:** src/routes/(app)/+page.svelte
- **Commit:** 435dc9f

## Verification Results

- `npm run check` → **0 ERRORS 0 WARNINGS** (4280 files).
- Four protected suites (`cover-cache`, `cover-backfill`, `lazyCover`, `player.svelte`) → **4 files / 155 tests passed** (cover-cache.ts + cover-backfill.ts source unchanged).
- Full suite `npx vitest --run` → **62 test files, 845 tests, all passed** (matches the prior baseline of 845 in STATE.md — no regressions, no new tests added since the existing suites + check cover the change per the plan).

## Manual Verification — PENDING (human-verify, non-blocking)

Eyeball after deploy/dev:
1. Play a song on the now-playing page whose homepage tile was a gradient → after its cover resolves, navigate Home → the SAME song tile shows that cover live (uid or name match), no refresh.
2. Scroll a coverless library-song tile into view → it resolves on view (lazyCover) and paints.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. The only DOM-rendered strings are https-gated cover URLs (T-hep-01 / T-0bb-01 invariant preserved at every new write site); the reactive wrapper touches no browser globals at module top (T-hep-03).

## Self-Check: PASSED
- FOUND: src/lib/stores/cover-version.svelte.ts
- FOUND: src/lib/stores/player.svelte.ts
- FOUND: src/routes/(app)/+page.svelte
- FOUND commit: 0b39d03 (Task 1)
- FOUND commit: 42fd3b4 (Task 2)
- FOUND commit: 435dc9f (Task 3)
