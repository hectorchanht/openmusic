---
phase: quick-260910-qjv
plan: 01
subsystem: player-ui
tags: [up-next, related, queue, tap-feedback, nowplaying]
requires: [player.playNext, player.play, tapBounce]
provides: [relatedTapPlay, artist-tap-bounce]
affects: [NowPlaying.svelte, home, search, CompactRow]
tech-stack:
  added: []
  patterns: [compose-existing-store-methods, non-fresh-play, use-action-additive]
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/+page.svelte
    - src/lib/components/CompactRow.svelte
decisions:
  - "Related tap = playNext + play({ fresh: false }) composition — zero player.svelte.ts diff"
  - "No toast/haptic on tap: the row becoming the playing track is the feedback (swipes keep theirs)"
  - "Tapping the now-playing song is a no-op, not a restart (avoids playNext index-0 mis-splice)"
metrics:
  duration: ~12 min
  completed: 2026-09-10
  tasks: 2 of 3 (task 3 is the orchestrator-run behavioural checkpoint)
---

# Quick 260910-qjv: Related tap queues-and-plays, preserving Up Next — Summary

A tap on a Now Playing "Related" row now inserts the song right after the current one and switches
to it, leaving the rest of Up Next intact; artist tap targets gained the same shrink-on-tap feedback
song rows already had.

## What Changed

### (A) Related tap — queue at the top and play

`src/lib/components/NowPlaying.svelte`

- **New `relatedTapPlay(track)` helper** (added directly below `relatedSwipeNext`, ~line 712), three
  statements, tagged `quick-260910-qjv`:
  1. `if (player.current?.uid === track.uid) return;` — tapping the now-playing song is a no-op.
  2. `player.playNext(track);` — de-dupe by uid, splice after current, pin in `manualUids`, persist.
  3. `if (player.current?.uid !== track.uid) void player.play(track, { fresh: false });` — the guard
     that prevents a double `play()` on the cold-start path (`playNext` plays it itself when there
     is no current).
- **`.rel-row` onclick swapped** (line ~1646) from `() => player.play(track, { fresh: true })` to
  `() => relatedTapPlay(track)`. `use:longpress`, `onlongpress`, `use:swipeAction` and both swipe
  helpers are byte-identical; the VersionPicker `onpick` still uses `{ fresh: true }` (a version
  switch IS a fresh play).
- **Zero `player.svelte.ts` diff** — verified: `git diff --stat -- src/lib/stores/player.svelte.ts`
  is empty at both commits.

### (B) `use:tapBounce` on every artist tap target — six sites, exact lines

| # | File | Line (post-change) | Element |
|---|------|--------------------|---------|
| 1 | `src/routes/(app)/search/+page.svelte` | 733 | `<button class="artist-tile" use:tapBounce …>` (search Artists shelf) |
| 2 | `src/routes/(app)/+page.svelte` | 746 | `{#snippet artistGridTile}` `<button class="tile artist-tile" use:tapBounce …>` — covers BOTH grid shelves (rendered ~796 and ~970) |
| 3 | `src/routes/(app)/+page.svelte` | 804 | Top-artists row mode `<button class="album" use:tapBounce …>` |
| 4 | `src/routes/(app)/+page.svelte` | 978 | Favourite-artists row mode `<button class="album" use:tapBounce …>` |
| 5 | `src/lib/components/CompactRow.svelte` | 81 | `{#if variant === 'artist'}` `<button class="crow" use:tapBounce …>` — covers the compact-density Top/Favourite artist shelves (home lines 787 and 964 pass `onopen` into this component) |
| 6 | `src/lib/components/NowPlaying.svelte` | 1428 | inline `<button class="artist-link" use:tapBounce …>` under the title |

One `<!-- quick-260910-qjv: artist tap feedback, parity with song rows -->` comment per file on the
first site (search, home, CompactRow); NowPlaying already carries the tag on the helper block, so no
second comment there. No imports added — all four files already imported `tapBounce`. No non-artist
control was touched: the other two `goto('/artist/'` hits in home (787, 964) are `onopen` props
routed through site 5, and `.fav-tile` / artist-page "More like this" / `TrackMenu .mi` /
search `.suggest-row` already had the action.

### Test

`src/lib/stores/player.svelte.test.ts` — new describe block (line 640, appended after the piz
suite so `mk` / `makeFakeAudio` / `flush` are in scope), 3 tests, reusing the piz restore idiom:

1. New track lands at `[q1, q2, R, q3, q4]`; `current = R`; `upNextAnchorUid` still `q1`;
   `queueContext` still `'search'`; `buildSimilarQueue` NOT called (no regenerate).
2. Already-queued `q4` moves to `[q1, q2, q4, q3]` — exactly one occurrence, anchor still `q1`.
3. Cold start: `playNext` alone sets `current = R`, `queue = [R]`, and `player.play` is called
   **once** — the component's guard condition is false, so no double start.

No new mocks; `mockSimilar`/`mockPicks` reset to `[]` in the local `beforeEach`.

## Verification — Observed Results

| Gate | Command | Observed |
|------|---------|----------|
| New tests | `pnpm test -- src/lib/stores/player.svelte.test.ts -t "quick-260910-qjv"` | **3 passed**, 254 skipped |
| Player suite | `pnpm test -- src/lib/stores/player.svelte.test.ts` | **257 passed** (257) |
| Typecheck | `pnpm check` | **0 ERRORS 0 WARNINGS**, 4411 files |
| Full suite | `pnpm test` | **1954 passed** (1954), 104 files |
| Zero store diff | `git diff --stat -- src/lib/stores/player.svelte.ts` | empty |
| Commit deletions | `git diff --diff-filter=D` on both commits | none |

**Not verified here:** the in-app behavioural checkpoint (Task 3 — Up Next preservation on a real
tap, sibling swipe/long-press affordances, cold-start single start, artist shrink-on-tap across all
densities). Skipped by instruction; the orchestrator runs the browser verification. Nothing in this
summary claims live-browser confirmation.

## TDD Gate Compliance

RED/GREEN ran, with one honest caveat. The three tests exercise **store** invariants, and the store
already supported this composition — so on first run against the *unchanged* component they passed.
Rather than accept a hollow RED, the tests were proven to discriminate: flipping test 1's call to the
OLD `play(R, { fresh: true })` produced

```
AssertionError: expected [ 'kuwo:Q1', 'kuwo:Q2', 'kuwo:R9' ] to deeply equal [ 'kuwo:Q1', 'kuwo:Q2', …(3) ]
Tests  1 failed | 2 passed
```

i.e. the queue collapsing to three rows — the reported bug, reproduced. The test file was restored
from a backup before the component change landed. The behaviour change itself lives in a `.svelte`
component, which the single node Vitest project (no jsdom) cannot render, so a genuinely-failing
component-level test was not available. Commits: `test`+`feat` are combined in `8da920a` (helper +
test together) and `33a7189`.

## Flags

1. **Tap and swipe-left now overlap.** Both insert the song right after current; tap additionally
   switches playback to it. Adjacent but distinct. The user may want to keep swipe-left (queue
   without interrupting the current song) or retire it as redundant — not decided here.
2. **`.rel-row` itself still lacks `use:tapBounce`**, unlike other song rows. Deliberately untouched:
   part (B) was scoped to artist targets only. Worth a follow-up one-token add.
3. **Anchor-row edge case.** Tapping a Related song that happens to be the current list ANCHOR (a
   played row sitting above current) moves it to after current, so the rows above it fall out of the
   visible `queue.slice(anchorIdx)` window. Acceptable — the anchor uid is still present in the
   queue, so the list never blanks; it just shortens.

## Deviations from Plan

**1. [Rule 3 - Blocking] `svelte-check` narrowing error in the cold-start test**

- **Found during:** Task 2 (`pnpm check`)
- **Issue:** `player.current = null` let TS control-flow narrow `player.current` to `null` and then
  `never` for the rest of the test body — `playNext` mutates it synchronously, which TS cannot see.
  3 errors: `Property 'uid' does not exist on type 'never'`.
- **Fix:** read `current` through a local getter (`const cur = () => player.current;`) in that test,
  with a comment saying why. No assertion weakened — the same three expectations still run.
- **Files modified:** `src/lib/stores/player.svelte.test.ts`
- **Commit:** `33a7189`

Otherwise the plan executed exactly as written. No architectural changes, no package installs, no
auth gates.

## Assumption Drift (advisory)

- **Assumption drift:** plan assumed a conventional TDD RED on the new tests -> the store already
  satisfied every invariant, so RED had to be demonstrated by reverting the call to the old
  `fresh: true` form (the change under test is component-level, unreachable from the node project).
  Recorded above under TDD Gate Compliance; does not change any deliverable.

## Commits

- `8da920a` — `fix(quick-260910-qjv): Related tap queues-and-plays instead of rebuilding Up Next`
- `33a7189` — `feat(quick-260910-qjv): shrink-on-tap for every artist tap target`

Not pushed, not deployed, no APK built. Unrelated working-tree changes (`.gitignore`, `CLAUDE.md`,
`.planning/HANDOFF.json`, `docs/agents/`, the phase-31 `.gitkeep`) were left unstaged.

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte` — FOUND, `relatedTapPlay(track)` onclick present (1 match)
- `src/lib/stores/player.svelte.test.ts` — FOUND, `quick-260910-qjv` describe present
- `src/routes/(app)/search/+page.svelte`, `src/routes/(app)/+page.svelte`,
  `src/lib/components/CompactRow.svelte` — FOUND, `use:tapBounce` counts 1 / 3 / 1 as tabled
- Commits `8da920a`, `33a7189` — FOUND in `git log`
