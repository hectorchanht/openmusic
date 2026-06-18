---
phase: quick-260618-ink
plan: 01
subsystem: now-playing / queue UI
tags: [svelte5, view-slice, scroll, up-next, regression-test]
requires:
  - player.queue (history-before-current shape, 260615-i9u)
  - player.reorderQueue (queue-absolute indices)
provides:
  - Up-Next list rendered from current index forward (view-only slice)
  - one-shot scroll-to-current on Up-Next tab open
affects:
  - src/lib/components/NowPlaying.svelte
tech-stack:
  added: []
  patterns:
    - "$derived view-slice over a store array (zero store-shape change)"
    - "one-shot $effect latched by a plain (non-$state) let, re-armed on close"
    - "container-scoped scrollTo via rect deltas (not scrollIntoView)"
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "Up-Next list fix is VIEW-LEVEL: slice player.queue from current index forward; store queue (history-before-current) untouched so prev()/history + cover carousel keep reading the unsliced array."
  - "reorderQueue args offset by upNextStart so list-relative drag indices map to queue-absolute; all other row-state comparisons stay list-relative."
  - "Scroll is ONE-SHOT on open (tab==='queue' && sheetState!=='closed'), latched by a plain let; only tab+sheetState are tracked reads, so queue mutations never re-fire it — 260615-mnr's overflow-anchor:none / no-mutation-scroll preserved."
metrics:
  duration: ~10 min
  completed: 2026-06-18
  tasks: 3
  files: 2
---

# quick-260618-ink Plan 01: Up-Next starts at new song + scroll-to-current on open Summary

View-level fix so a fresh click-to-play renders the new current song as the Up-Next list's first row, plus a one-shot scroll pinning the current row to the panel top when the Up-Next tab opens — both achieved with zero change to the store queue shape.

## What was built

**INK-01 — Up-Next list starts at the new song (Task 1).**
Added two `$derived` near the cover-carousel derivations in `NowPlaying.svelte`, reusing the existing `ci`:
- `upNextStart = ci >= 0 ? ci : 0` (cold/edge fallback to 0 renders the whole queue).
- `upNextList = player.queue.slice(upNextStart)` → `[current, ...manual, ...tail]`.

The Up-Next markup now iterates `upNextList` (emptiness guard `upNextList.length`, `{#each upNextList ...}`); all row attributes (keyed uid, `skipped`, `class:playing`, swipeRemove, longpress, retry/play onclick, title, grip) are byte-unchanged except the reorder commit. `gripDragUp` now calls `player.reorderQueue(dragFrom + upNextStart, dragOver + upNextStart)` — list-relative drag indices mapped to queue-absolute. History stays in `player.queue` for `prev()` and the cover carousel (`prevCover`/`nextCover`), which read the unsliced array.

**INK-02 — One-shot scroll-to-current on Up-Next open (Task 2).**
Added a plain `let upNextScrollDone = false` latch (NOT `$state`, so reading it does not make the effect reactive) and a guarded `$effect`. It tracks only `tab` + `sheetState`; when the list is open (`tab === 'queue' && sheetState !== 'closed'`) and not yet latched, it latches immediately then, inside one `requestAnimationFrame`, scopes to `queueListEl.closest('.panel')`, finds `.q-row.playing`'s `<li>`, and `container.scrollTo({ top: offsetWithin, behavior: 'smooth' })` (rect-delta offset, block:'start' semantics — not `scrollIntoView`). Closing resets the latch so the next open re-fires. Queue mutations never re-fire it.

**Regression coverage (Task 3).**
Added two `it()` cases to the existing `quick-260615-i9u Feature B` describe block in `player.svelte.test.ts`:
- Store keeps history before current on fresh play (`[h0,h1,pc,X]`); view-slice from current index yields `[current, ...tail]` with the new current first.
- A manual entry (registered in `manualUids`, seeded in the prior queue) survives in the view-slice immediately after current (`slice(ci) === [X, M]`).
Also added `manualUids.clear()` + `pendingManual = null` to that block's `beforeEach` so the manual case cannot leak into the exact-shape assertions of the other tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added manualUids/pendingManual reset to the test beforeEach**
- **Found during:** Task 3
- **Issue:** The describe block's `beforeEach` did not clear `manualUids`/`pendingManual`. The new manual-entry test adds a manual uid; without a reset it would leak into the subsequent exact-queue-shape assertions and flake them.
- **Fix:** Added `manualUids.clear()` + `pendingManual = null` to the block's `beforeEach` (test-only; no store change).
- **Files modified:** src/lib/stores/player.svelte.test.ts
- **Commit:** 25173a5

## Verification

- `pnpm exec svelte-check --threshold error src/lib/components/NowPlaying.svelte` — 0 errors (per task).
- `npx svelte-check` (full) — 0 errors, 0 warnings.
- `npx vitest run` (full) — 65 files, 900 tests passed.
- Manual grep: `{#each upNextList` present (no `{#each player.queue` in Up-Next), `overflow-anchor: none` intact on `.panel`, scroll effect tracks only `tab`/`sheetState` (no queue-length/contents dependency).

## Known Stubs

None.

## Commits

- 7d0d9db feat(quick-260618-ink-01): render Up-Next list from current index forward
- 4d096e2 feat(quick-260618-ink-01): one-shot scroll-to-current on Up-Next open
- 25173a5 test(quick-260618-ink-01): lock view-slice contract; store queue shape unchanged

## Self-Check: PASSED

- Files exist: src/lib/components/NowPlaying.svelte, src/lib/stores/player.svelte.test.ts
- Commits exist: 7d0d9db, 4d096e2, 25173a5
