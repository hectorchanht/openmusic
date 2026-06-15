---
phase: quick-260615-gww
plan: 01
subsystem: now-playing
tags: [now-playing, cover, gestures, css]
requires: []
provides:
  - "Flush neighbor covers during cover-strip swipe (no inter-cover gutter)"
  - "Cover-tap dispatch on sheetState: closed -> play/pause toggle; half/full -> no-op"
affects:
  - src/lib/components/NowPlaying.svelte
tech-stack:
  added: []
  patterns:
    - "sheetState-branched cover-tap handler reusing player.toggle()"
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
decisions:
  - "tapCoverCollapse rewritten to branch on sheetState (closed=toggle, half/full=no-op); removes the 260615-gcy half->closed-on-tap collapse"
  - "Neighbor cover cells reverted to flush -100%/100%; --cover-gap var dropped entirely (KEEP 260615-fva crossfade — only the positional gutter removed)"
metrics:
  duration: ~4 min
  completed: 2026-06-15
---

# Phase quick-260615-gww Plan 01: Now-Playing Cover Tweaks Summary

Reverted the inter-cover positional gutter so adjacent covers touch flush during a swipe, and rewrote the cover-tap handler to toggle play/pause when the sheet is closed (and do nothing at half/full), all in `src/lib/components/NowPlaying.svelte`.

## What Was Built

### Task 1: Flush covers + closed-toggle / half-noop cover tap

**CHANGE 1 — removed inter-cover gap (GWW-01):**
- Dropped `--cover-gap: 14px;` from the `.cover-strip` rule. The rest of the rule (position, inset, will-change, the 0.32s commit-settle transition) is byte-unchanged.
- `.cover-cell.prev`: `calc(-100% - var(--cover-gap))` → `left: -100%;`
- `.cover-cell.next`: `calc(100% + var(--cover-gap))` → `left: 100%;`
- `.cover-cell.cur` stays `left: 0;`
- Tidied the now-stale "gutter / --cover-gap" wording in the three nearby comment blocks (~line 360, ~line 972, ~line 1230) to describe flush neighbors; no behavior change.
- The 260615-fva crossfade (`{#key uid}` meta block, `in:fade`/`out:fade` on `.title`/`.artist`, `xfadeMs`, `effectiveCover` cover crossfade) is untouched and still runs.

**CHANGE 2 — closed->toggle / half->no-op cover tap (GWW-02, GWW-03):**
- `tapCoverCollapse()` now dispatches on `sheetState`:
  - `closed` → `player.toggle()` (the same play/pause API the transport `.play` button uses)
  - `half` → no-op (removes the 260615-gcy half->closed collapse-on-tap)
  - `full` → no-op (unchanged)
- `tapCoverKey()` still delegates to `tapCoverCollapse()` after the Enter/Space guard, so keyboard parity inherits the new behavior automatically.
- The NP-03 comment above the functions was rewritten to describe the new behavior.

**Invariants preserved:**
- No movement guard, `setPointerCapture`, or `pointerdown` logic added — the sub-slop-tap-reaches-onclick contract is intact.
- The `onclick={tapCoverCollapse}` / `onkeydown={tapCoverKey}` / `role="button"` / `tabindex="0"` wiring on `.cover` is unchanged.
- The swipe/drag/grip machine (`use:coverSwipe`, npTopDown/Move/Up, startGripFromCover, grip snap machine, trailing-click suppressor) is untouched.
- `coverSwipe.ts` and its test are byte-untouched.

## Verification

- `npm run check` → **0 errors, 0 warnings** (4279 files).
- `npx vitest --run src/lib/actions/coverSwipe` → **green, 23/23 tests pass** (1 file).
- `git diff --name-only` (working source) lists only `src/lib/components/NowPlaying.svelte` for this task; `.planning/HANDOFF.json` was already modified at session start (orchestrator-managed, not part of this change).
- Commit `92de46b` staged `src/lib/components/NowPlaying.svelte` only via explicit path.

## Deviations from Plan

None — plan executed exactly as written.

## Pending Human-Verify (device / browser spot-check)

The plan's success criteria include visual/interaction checks not testable in node. Eyeball on a device/browser:
- During a left/right cover swipe, adjacent covers touch flush (no visible gutter between covers).
- Tapping the cover with the sheet CLOSED toggles play/pause.
- Tapping the cover at HALF-OPEN does nothing (no collapse, no toggle).
- The title/artist/cover crossfade still animates on track change.

## Known Stubs

None.

## Self-Check: PASSED

- `src/lib/components/NowPlaying.svelte`: FOUND (modified).
- Commit `92de46b`: FOUND in `git log`.
