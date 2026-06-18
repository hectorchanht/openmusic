---
phase: quick-260618-lsw
plan: 01
subsystem: now-playing / up-next
tags: [up-next, anchor, auto-advance, svelte5-runes, view-state]
requires:
  - player.play({fresh})
  - player.queue ($state)
  - NowPlaying upNextStart/upNextList slice (260618-ink)
provides:
  - player.upNextAnchorUid (session-scoped view anchor)
  - anchor-relative Up-Next slice start
affects:
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
tech-stack:
  added: []
  patterns:
    - "Anchor-by-uid view slice: store holds the anchor uid, view resolves to a live index via findIndex each render, clamps to current index when absent."
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "Anchor is a session-scoped VIEW field — NOT persisted (mirrors queueContext/manualUids side-state discipline). A reload re-derives it on the first play; NowPlaying's clamp falls back to the live current index until then."
  - "Anchor set ONLY on fresh play + new-list installs (setQueue/setListQueue/clearQueue); deliberately untouched by next()/prev()/auto-advance/failover/manual inserts — that is the whole point so the slice start stays put as the highlight moves."
  - "View resolves the anchor uid to a live index each render (findIndex by uid) so drag-reorder and removals stay correct; clamp to ci when the anchor uid is gone (never a blank list)."
metrics:
  duration: ~10 min
  completed: 2026-06-18
---

# Phase quick-260618-lsw Plan 01: Auto-advance keeps the played song in Up-Next — Summary

Added a store-level `upNextAnchorUid` so the Up-Next list slices from a fresh-play anchor instead of the live current index; auto-advance now keeps the just-played song visible while only the now-playing highlight moves down.

## What Was Built

- **`player.upNextAnchorUid`** — a public `$state<string | null>` on the Player class. The uid the Up-Next list is anchored to. Set on fresh play (`play({fresh})` → `resolved.uid`, after `weaveFreshHistory`), on `setQueue` / `setListQueue` (→ current uid, or null when cold), and on `clearQueue` (→ surviving current uid). Deliberately NOT written by `next()`, `prev()`, auto-advance, failover, retry, or manual inserts. Not persisted.
- **NowPlaying `upNextStart`** — now derived from the anchor's LIVE queue index (`anchorIdx = findIndex(uid === upNextAnchorUid)`), clamped to `ci` (live current index, then 0) when the anchor is absent. `ci`, `prevCover`, `nextCover`, the drag-reorder offset (`dragFrom + upNextStart`), and the 260618-ink one-shot scroll-to-`.q-row.playing` are all unchanged. `class:playing` still keys off `player.current?.uid` (the live current), so the highlight follows current while the slice start follows the anchor.
- **Tests** — a new `upNextAnchorUid` describe with 4 cases: auto-advance keeps the anchor (LSW-01), fresh play resets it (LSW-02, real `play()` restored), anchor survives reorder/removal + missing-anchor clamp (LSW-03), and a prev() guard.

## How It Works

On a fresh click, `play({fresh})` weaves history then sets the anchor to the clicked song — it becomes the first Up-Next row (260618-ink preserved). On auto-advance, `next()` calls a NON-fresh `play()` that leaves the anchor put; `current`/`ci` advance, but the slice start stays at the anchor, so the just-played song remains in the rendered list and only the `.q-row.playing` highlight moves down. The view resolves the anchor uid to a live index every render, so reorders/removals keep the slice correct; if the anchor uid disappears, the clamp falls back to `ci`.

## Deviations from Plan

None — plan executed exactly as written. (The plan body referenced `pnpm` in its `<verify>` blocks; verification was run with `npx vitest run` / `npx svelte-check` per the task constraints — same tools, same results.)

## Verification

- `npx vitest run` (full): **904 passed** (65 files) — was 900, +4 new anchor tests.
- `npx vitest run src/lib/stores/player.svelte.test.ts -t "upNextAnchorUid"`: 4 passed.
- `npx svelte-check --threshold error`: 0 errors, 0 warnings.
- Manual (for the developer): play a song from a list (it is row 1 of Up-Next), let it auto-advance — the just-played song stays in Up-Next and the highlight moves to the new song; clicking a fresh song makes it row 1 again.

## Commits

- `a3a3e51` feat(quick-260618-lsw-01): add upNextAnchorUid set on fresh play + new-list install only
- `046ba67` feat(quick-260618-lsw-01): derive upNextStart from anchor live index
- `fdd5efe` test(quick-260618-lsw-01): anchor tests — auto-advance/prev keep anchor, fresh resets, survives reorder/removal

## Self-Check: PASSED
