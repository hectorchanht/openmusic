---
phase: quick-260615-fva
plan: 01
subsystem: now-playing-ui
tags: [svelte, transitions, gesture, crossfade, reduced-motion]
requires: []
provides:
  - "NowPlaying carousel gutter (--cover-gap) between cover-swipe cells"
  - "NowPlaying title+artist crossfade on track change"
  - "Nowbar cover+title+artist crossfade on track change"
affects:
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/Nowbar.svelte
tech-stack:
  added: []
  patterns:
    - "Svelte JS transitions (in:/out:fade) explicitly guarded by settings.reduceMotion OR OS prefers-reduced-motion (global app.css !important rule does not stop JS transitions)"
    - "{#key uid} remount drives crossfade + marquee re-measure on track change"
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/Nowbar.svelte
decisions:
  - "Nowbar crossfade key is player.current.uid with artist|title fallback (PendingTrack has no uid) — plan's suggested np?.uid does not type-check"
  - "Applied in:/out:fade per-element (kept .np-art + .np-meta as direct flex children of .np-open) rather than a wrapper span, to keep the flex/gap/ellipsis layout byte-unchanged and avoid remounting the coverSwipe gesture surface"
metrics:
  duration: ~6 min
  completed: 2026-06-15
---

# Phase quick-260615-fva Plan 01: Polish Cover-Swipe Track-Change Transitions Summary

Adds a visible gutter between cover-swipe carousel cells on NowPlaying and replaces the jarring hard `{#key}` remount swaps with crossfades on both the NowPlaying meta and the Nowbar cover+meta, all reduced-motion-guarded.

## What Was Built

### Task 1 — Carousel gutter (SWIPE COVER GAP) — `NowPlaying.svelte`
- Added `--cover-gap: 14px` custom property on `.cover-strip`.
- Re-offset neighbor cells: `.cover-cell.prev` → `left: calc(-100% - var(--cover-gap))`, `.cover-cell.next` → `left: calc(100% + var(--cover-gap))`. `.cover-cell.cur` unchanged at `left: 0`.
- The gutter is purely positional — revealed mid-drag by the existing 1:1 `coverSwipe` `translateX(dx)`, never displacing the resting current cell, so a committed neighbor still lands centered. `coverSwipe.ts` untouched.
- Updated the stale "edge-to-edge (no gutter)" comments in the carousel JS-doc block, the markup comment, and the CSS comment.
- Reduced-motion rules on `.cover-strip` left byte-unchanged (gap is positional, not animated).
- Commit: `0e46ade`

### Task 2 — NowPlaying title+artist crossfade — `NowPlaying.svelte`
- Added `fade` to the `svelte/transition` import.
- Added `xfadeMs = $derived(settings.reduceMotion || osReduceMotion ? 0 : 200)` where `osReduceMotion` reads `window.matchMedia('(prefers-reduced-motion: reduce)')` behind a `typeof window` guard at module init.
- Kept the `{#key player.current?.uid}` block (drives marquee re-measure) and added `in:fade={{duration: xfadeMs}} out:fade={{duration: xfadeMs}}` to both `.title` and `.artist`. `use:marquee`, `.marquee-inner`, and `onclick={openArtist}` preserved.
- Updated the `{#key}` comment to document the crossfade.
- Commit: `29f4238`

### Task 3 — Nowbar cover+title+artist crossfade — `Nowbar.svelte`
- Added `import { fade } from 'svelte/transition'` and `import { settings } from '$lib/stores/settings.svelte'`.
- Added `xfadeMs` (same reduce-motion guard as Task 2) and an `npKey` derived (`player.current?.uid ?? artist|title`).
- Wrapped `.np-art` + `.np-meta` in `{#key npKey}` with `in:/out:fade` so cover + text crossfade together on track change. Both elements remain direct flex children of the un-keyed `.np-open` button (layout + coverSwipe gesture surface unchanged).
- `disabled={resolving}`, `onclick={handleOpen}`, `use:coverSwipe`, the `.np-prog` loader rail, the sleep-timer badge, and the play/loader button were all left untouched. The existing `@media (prefers-reduced-motion: reduce) .np-open { transition: none !important }` (governs the coverSwipe slide) stays as-is.
- Commit: `28fc1d6`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Type error / blocking] Nowbar crossfade key could not use `np?.uid`**
- **Found during:** Task 3 (svelte-check)
- **Issue:** The plan suggested keying on `np?.uid`, but `np = player.current ?? player.pendingTrack` and `PendingTrack` (`{artist, title, cover}`) has no `uid` — `svelte-check` reported `Property 'uid' does not exist on type 'PendingTrack'`.
- **Fix:** Introduced an `npKey` derived = `player.current?.uid ?? \`${np?.artist ?? ''}|${np?.title ?? ''}\``, keying on the real Track uid when present and on artist|title for the pending stub (so an optimistic stub still keys distinctly and crossfades when the real track resolves).
- **Files modified:** `src/lib/components/Nowbar.svelte`
- **Commit:** `28fc1d6`

## Verification Results

| Check | Command | Result |
| ----- | ------- | ------ |
| svelte-check (full) | `npm run check` | 0 errors, 0 warnings, 0 files with problems |
| coverSwipe action test | `npx vitest --run src/lib/actions/coverSwipe` | 23/23 passed (1 file) |
| Task 1 greps | `--cover-gap`, `calc(-100% - var(--cover-gap))`, `calc(100% + var(--cover-gap))` | all present |
| Task 2/3 greps | `fade` + `reduceMotion` present in both components; `coverSwipe` still attached | all present |

## Pending Human Visual Verification (checkpoint — NOT performed)

The plan's final task is `type="checkpoint:human-verify"` (browser visual check). It was NOT executed by the executor (no browser). It remains pending manual verification on a phone or DevTools mobile emulation with a multi-track queue playing. Look at:

- **(a) Cover gutter:** Drag the NowPlaying cover slowly — a visible GAP should appear between the current cover and the neighbor cover as they slide (covers no longer touch). On commit, the neighbor must land perfectly CENTERED (no off-centre frozen frame, no jump). A sub-slop tap must still collapse the sheet; a vertical drag must still collapse to the nowbar.
- **(b) NowPlaying text crossfade:** On track change (swipe-commit, skip, or auto-advance) the title+artist should FADE out/in, not hard-snap.
- **(c) Nowbar crossfade:** Collapsed to the nowbar, on track change the cover AND title+artist should fade out/in together (no hard swap). Horizontal swipe must still change track; tap must still expand.
- **(d) Reduced-motion:** With reduce-motion ON (Settings → reduce motion, OR OS-level), both crossfades must be INSTANT (no fade), while the cover gap is still visible during a drag (positional, not animated).

## Self-Check

- Files modified exist: NowPlaying.svelte, Nowbar.svelte (both committed)
- Commits present: 0e46ade, 29f4238, 28fc1d6

## Self-Check: PASSED
