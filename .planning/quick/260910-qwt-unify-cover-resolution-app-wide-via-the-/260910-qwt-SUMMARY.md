---
phase: quick-260910-qwt
plan: 01
subsystem: covers
tags: [cover-cache, row-cover, lazyCover, nowplaying, related, search, library, artist]
requires: [cover-backfill, cover-version, cover-cache, upnext-covers]
provides: [row-cover]
affects: [NowPlaying.svelte, CompactRow.svelte, search/+page.svelte, library/+page.svelte, artist/[name]/+page.svelte, lazyCover.ts, cover-version.svelte.ts, upnext-covers.ts]
tech_stack:
  added: []
  patterns: ["pure .ts read-order helper, cache read passed IN by the caller", "caller-owns-the-bump (pure services never touch runes)", "{@const} as a direct {#each} child for the shared row read", "one capped backfillCovers pool shared by two tabs"]
key_files:
  created:
    - src/lib/services/row-cover.ts
    - src/lib/services/row-cover.test.ts
  modified:
    - src/lib/actions/lazyCover.ts
    - src/lib/actions/lazyCover.test.ts
    - src/lib/stores/cover-version.svelte.ts
    - src/lib/services/upnext-covers.ts
    - src/lib/services/upnext-covers.test.ts
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/CompactRow.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
decisions:
  - "One read-order authority (pickRowCover) for every row surface; upNextTileCover moved into it rather than duplicated"
  - "lazyCover owns the bumpCoverVersion() after a SOLID chain resolve — resolveCoverForTrack stays a pure .ts that never bumps (LOCKED)"
  - "Only a chain resolve bumps; a cache hit / kept probe / null result does not (nothing new landed)"
  - "readCoverByUidOrName skips the uid layer for an empty uid, matching the write/evict-side charts-tags guards"
  - "Related art reuses the SAME single capped backfillCovers effect (tab selects the row list); never per-row use:lazyCover"
metrics:
  duration: ~14 min
  tasks: 2 of 3 (task 3 is the orchestrator-run browser checkpoint)
  completed: 2026-09-10
---

# Quick 260910-qwt: Unify cover resolution app-wide via the shared cache — Summary

Cover art is now a single shared pipeline on the READ side as well as the resolve side: every track
row paints `resolved → track.cover → shared cache`, and `lazyCover` finally bumps the reactive
version after a chain resolve, so a cover landing on any surface is visible on every other one. The
Related list, which had no art at all, gains a 36px tile filled by the same single capped backfill
pass Up Next uses.

## What was built

**`src/lib/services/row-cover.ts`** (new, pure `.ts` — no runes, no store, no cache import):
`pickRowCover(resolved, seeded, cached)` — `upNextTileCover` moved out of `upnext-covers.ts` and
generalised, since the read stopped being Up-Next-specific. Rung 1 `resolved` (the surface's local
lazyCover/carousel map) stays FIRST so a D-15 repaired URL beats a broken `track.cover`; rung 2
`seeded` (`track.cover`) stays ahead of the cache so a quick-260910-piz album seed always wins; rung
3 `cached` is passed IN by the caller, so the CALL SITE takes the `coverVersion()` dependency and the
module stays node-testable. `''` is a miss at every rung.

**The missing write-side signal** (`src/lib/actions/lazyCover.ts`, one branch):
`resolveCoverForTrack` writes both cache layers but by LOCKED design never bumps (pure `.ts`) — the
bump is the caller's job, and `lazyCover` is that caller for search / library / artist / CompactRow /
charts. It never bumped, so a cover resolved by a search row was cached silently and nothing else
repainted. Now `if (isHttps(url)) { bumpCoverVersion(); onResolved(...) }`. Cache hits and kept
probes deliberately do NOT bump (nothing new landed). The home page's own
`onResolved: () => bumpCoverVersion()` now double-bumps; the two collapse into one increment via the
rAF latch (quick-260704-45c), so the home page was left untouched.

**Empty-uid read guard** (`cover-version.svelte.ts`): `readCoverByUidOrName` now reads the uid layer
only for a truthy uid. The uid layer is a flat record keyed `'uid:' + uid`, so an empty stub uid
collapses every charts/tags row onto one slot (the "same cover for every song" bug). The write and
evict sides already guarded this; now that this read is the rung-3 authority on every row, it holds
on the read side too.

**Row surfaces rebound** (read-only change — no new request path): search (1 site), library (liked /
playlists / downloads / history — 4 sites), artist hit-songs (1), `CompactRow` (1), the Up-Next tile
(1) and Related (1) all call `pickRowCover(resolvedCovers[uid], track.cover,
readCoverByUidOrName(uid, artist, title))`. Every component-local `resolvedCovers` map and its
`onResolved` writer is untouched — rung 3 was added, nothing replaced. `CompactRow`'s discovery stubs
(`track == null`) have no identity for rung 3 and keep exactly the old host-provided `cover`.

**Related art** (`NowPlaying.svelte`): the row gets the existing `.q-art` 36px tile (plus one
`.rel-row .q-art { margin-right: 0 }` rule so the row's `gap: 8px` is the only spacing) and the q5a
fill `$effect` now selects the row list by tab — `queue → upNextList`, `related → related`, otherwise
nothing. Everything else in the effect is byte-identical: `AbortController`, `untrack`, `max:
UPNEXT_COVER_MAX`, `onResolved: () => bumpCoverVersion()`, abort-on-rerun. So Related costs ≤20
tier-1 `/api/deezer/search` per fill (fewer in practice — `upNextCoverNeeds` skips every row with an
https source cover), ≤6 in flight, ~0 on re-open, and switching tab aborts the other pool. No
`use:lazyCover` was added anywhere: that was the T-26-10-01 flood and the rule still holds.

## Tasks and commits

| Task | Name | Commit |
|------|------|--------|
| 1 (TDD) | Shared read-order helper + write-side bump + empty-uid read guard | `31b54e1` |
| 2 | Bind every row surface to the shared cache; Related art via the q5a effect | `f00bab4` |
| 3 | Behavioural browser checkpoint | SKIPPED — run by the orchestrator |

TDD gates for task 1: the RED run was observed first — `row-cover.test.ts` failed to import a
missing module and the new lazyCover case failed with `expected "vi.fn()" to be called 1 times, but
got 0 times`. Both went green after the implementation. (The two commits are `feat`, not a separate
`test`/`feat` pair: the RED tests and their implementation landed together per the plan's task
boundaries.)

## Verification — what was actually run

| Check | Result |
|-------|--------|
| `pnpm vitest --run row-cover / upnext-covers / lazyCover` (RED, pre-implementation) | 1 failed file (missing module) + 1 failing bump assertion — as intended |
| `pnpm vitest --run` (same three, post-implementation) | 3 files, 29 tests passed |
| `pnpm test` (full suite) | 105 files, **1956 tests passed** |
| `pnpm check` | **0 errors, 0 warnings**, 4413 files |
| `bumpCoverVersion()` in lazyCover.ts code lines (comments stripped) | exactly `1` |
| `export function upNextTileCover` in upnext-covers.ts | absent |
| `pickRowCover(` sites | library **4**, search **1**, artist **1**, CompactRow **1**, NowPlaying **2** |
| `tab === 'related' ? related` / `class="q-art"` in NowPlaying | both present |
| Real `use:lazyCover={` directives in NowPlaying | **2** now, **2** at HEAD, **2** at the plan baseline `c6aed2b` — unchanged |
| `git diff` on `(app)/+page.svelte` + `player.svelte.ts` | zero diff vs HEAD **and** vs the plan baseline `c6aed2b` |
| Dev-server module compile smoke (`localhost:4321`, 5 changed modules) | all served transformed JS, no compile-error payload |

**Not verified here (the Task 3 checkpoint):** every in-app behavioural claim — Related rows actually
painting art, the observed `/api/deezer/search` request count for a fill, first-render cross-surface
reuse, the album-art precedence / closed-sheet / charts-distinct-covers regressions. Those need the
browser and are the orchestrator's checkpoint. Nothing above should be read as browser-confirmed.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] NowPlaying's `upNextTileCover` rename pulled into task 1**
- **Found during:** Task 1, step 3
- **Issue:** Deleting the `upNextTileCover` export while its only consumer (`NowPlaying.svelte`) was
  scheduled for task 2 would have left commit `31b54e1` with a broken import — a non-compiling commit
  on `main`, which auto-deploys on push.
- **Fix:** Moved just the two mechanical lines (the import and the `qArt` call site) into the task-1
  commit. Both commits typecheck and run the full suite green.
- **Files modified:** `src/lib/components/NowPlaying.svelte`
- **Commit:** `31b54e1`

**2. [Rule 1 - Verification gate defect] The plan's `use:lazyCover` count gate measures prose**
- **Found during:** Task 2 verify
- **Issue:** The gate is `grep -c 'use:lazyCover' NowPlaying.svelte` vs HEAD, but that counts comment
  mentions as well as directives — and the plan's own step 5b requires adding two comments that say
  "no `use:lazyCover` on Related rows". The raw count therefore had to change (9 → 11) no matter
  what, while the thing the gate exists to protect (actual action usage) was untouched.
- **Fix:** Asserted the directive form instead — `grep -c 'use:lazyCover={'` is **2** now, **2** at
  HEAD, and **2** at the plan baseline. Both are the pre-existing carousel prev/next cover cells; no
  row list gained a per-row chain.
- **Files modified:** none (gate interpretation only)

**3. [Note] The `git diff --quiet 88b37e6` form of the zero-diff gate is the wrong baseline**
- **Found during:** Task 2 verify
- **Issue:** `88b37e6` is the session-start commit, not this task's baseline — three prior quick tasks
  (qjv, piz, omt) landed in between and they are what touched the home page / `player.svelte.ts`.
- **Fix:** Compared against the plan commit `c6aed2b` and against HEAD instead. Both zero-diff. No
  edits were made to either file.
- **Files modified:** none

## Assumption Drift (advisory)

**Related rows are NOT mostly coverless.** The plan's diagnosis assumed "many rows carry inline
source covers … the rest need a bounded fill", and the code follows that. What is worth flagging for
the checkpoint: `related` is `dedupeBest(searchAll(artist))`, so in practice most rows carry an
https `pic`/`album_pic` and `upNextCoverNeeds` skips them — the expected Deezer request count for a
Related fill is likely well under the ≤20 ceiling, possibly near zero. A near-zero count in step 1 of
the checkpoint is a PASS, not a failure to fill.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access or schema surface. `pickRowCover` adds no new
writer: every value reaching rung 3 was written by `resolveCoverForTrack` / `backfillCovers` /
`writeCoverBoth`, all already gated by the `isSolidCover` https check (T-0bb-01).

## Self-Check: PASSED

`row-cover.ts`, `row-cover.test.ts` and this SUMMARY exist on disk; commits `31b54e1` and `f00bab4`
exist in `git log`. Working tree carries only the pre-existing unrelated changes (`.gitignore`,
`CLAUDE.md`, `.planning/HANDOFF.json`, `docs/agents/`, the phase-31 `.gitkeep`) plus this SUMMARY —
none of them staged or committed by this task.
