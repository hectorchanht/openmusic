---
phase: quick-260615-mnr
plan: 01
subsystem: now-playing
tags: [css, scroll-anchoring, queue, ux-fix]
requires: []
provides: ["Up-Next queue scroller that holds the user's scroll position across queue mutations"]
affects: [src/lib/components/NowPlaying.svelte]
tech-stack:
  added: []
  patterns: ["overflow-anchor: none on a mutating keyed-list scroller", "blur-on-tap to prevent focus-driven scroll-into-view"]
key-files:
  created: []
  modified:
    - src/lib/components/NowPlaying.svelte
decisions:
  - "Root cause was CSS scroll-anchoring (overflow-anchor: auto), NOT any JS scroll/focus call — confirmed by reasoning about the exact markup before touching anything."
  - "Single-rule fix on the shared .panel scroller; safe for all three tabs because lyrics uses explicit container.scrollTo and related doesn't auto-scroll."
  - "Added defensive blur in the queue row onclick (mirrors existing longpress blur) to cover the secondary focus-driven scroll-into-view contributor."
metrics:
  duration: ~6 min
  completed: 2026-06-15
---

# Phase quick-260615-mnr Plan 01: Up-Next Queue Scroll Anchoring Fix Summary

Disabled CSS scroll-anchoring on the Now Playing `.panel` scroller (`overflow-anchor: none`) so the Up-Next queue no longer yanks the currently-playing row back into view on every queue mutation — the user can now scroll the queue freely and it stays put.

## What Changed

`src/lib/components/NowPlaying.svelte` (commit `ff2f351`):

1. **`.panel` rule (CSS, ~line 1352→1360):** added `overflow-anchor: none` plus a load-bearing inline comment. The `.panel` was inheriting the browser default `overflow-anchor: auto`. The Up-Next list is a keyed `{#each player.queue as track (track.uid)}`, so every queue mutation — track advance moving the played song to history, `removeFromQueue`, `retryUnplayable`, `reorderQueue` — adds/removes/reorders rows ABOVE the fold, changing the height above the viewport. The browser's scroll-anchoring then re-pinned scroll to an anchor node, and the visually-distinct `.row.playing` row (`background: rgba(124,92,255,0.15)`) was the natural anchor, dragging it back into view on every change.

2. **Queue row `onclick` (markup, ~line 1104):** added `(e.currentTarget as HTMLElement)?.blur()` to the play/retry branch, mirroring the existing longpress blur idiom. This addresses the secondary focus contributor — a plain tap-to-play previously left focus on the playing `<button>`, and a focused element can be scrolled into view on a later re-render. The longpress path already blurred; the tap path now does too.

## Diagnosis Confirmation (Task 1 reasoning)

Before editing, the plan's diagnosis was re-verified against the live markup:
- `.panel { flex: 1; overflow-y: auto; overscroll-behavior-y: contain; }` had NO `overflow-anchor` declaration → defaulted to `auto`. ✓
- Queue each-block is keyed by `track.uid` (line 1093); `removeFromQueue` / `retryUnplayable` / reorder / advance all mutate rows that can sit above the scroll position. ✓
- `.row.playing` has a distinct background (line 1358) making it the natural scroll-anchor candidate. ✓
- The only programmatic scroll is the lyrics `$effect` (lines 189-224), gated on `tab !== 'lyrics'` and scoped to `lyricsEl.closest('.panel')` via explicit `container.scrollTo(...)` — it cannot run while `tab === 'queue'` and does not rely on anchoring. No code path scrolls or focuses the queue on its own. ✓

The reasoning held, so the minimal fix was applied.

## Untouched (per plan constraints)

The lyrics auto-scroll `$effect`, `swipeRemove`, `longpress`/`openMenu`, the grip drag handlers (`gripDragDown/Move/Up`), the `.skipped` retry branch, and the keyed `(track.uid)` each were all left unchanged. No `el.focus({ preventScroll: true })` was added anywhere (there was no existing explicit focus call to harden).

## Verification

- `grep -n "overflow-anchor:\s*none" src/lib/components/NowPlaying.svelte` → match on line 1360. ✓
- `npm run check` → 0 errors, 0 warnings, 4280 files. ✓

### Human-verify checkpoint (Task 2 — deferred to device/browser, not blocked per execution constraint)

Steps for the user to confirm on a phone-sized viewport via `npm run dev`:
1. Queue several tracks so Up Next overflows and is scrollable.
2. Start playback, scroll Up Next DOWN past the playing row, let a track finish/skip so the queue advances — EXPECT the list stays where scrolled; the playing row is NOT dragged back into view.
3. Tap a queue track — EXPECT it plays.
4. Swipe a non-playing row — EXPECT removal works.
5. Long-press a row — EXPECT the track menu opens.
6. Drag the grip handle — EXPECT reorder works.
7. Tap a `.skipped` ✗ row (if present) — EXPECT it retries.
8. Switch to the Lyrics tab during playback — EXPECT lyrics still auto-scroll/center the active line.

## Deviations from Plan

None — plan executed as written. The optional focus hardening described in Task 1 was applied because the tap-to-play branch did leave focus on the playing row (verified cheaply from the markup) and the change is a one-token mirror of the existing longpress idiom.

## Note on Pre-existing Working-tree Change

`NowPlaying.svelte` had an unrelated uncommitted hunk before this task: `.sheet` padding changed from `0px 18px env(safe-area-inset-bottom)` to `0px 0px env(safe-area-inset-bottom)` (~line 1325). This is NOT part of the scroll-anchoring fix, so only the two fix-related hunks were staged (via `git apply --cached` of a constructed patch) and committed. The padding hunk remains UNSTAGED in the working tree for the user to handle separately.

## Self-Check: PASSED

- FOUND: src/lib/components/NowPlaying.svelte (`overflow-anchor: none` on line 1360)
- FOUND: commit ff2f351
