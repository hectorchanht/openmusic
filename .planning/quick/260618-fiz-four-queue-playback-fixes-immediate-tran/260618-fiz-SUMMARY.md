---
phase: quick-260618-fiz
plan: 01
subsystem: player-queue + lyrics + swipe-wiring
tags: [queue, playback, lyrics, swipe, svelte5-runes]
requires:
  - player.svelte.ts (manualUids/regenerate/ensureAhead/weaveFreshHistory)
  - similar.ts buildSimilarQueue / picks.ts buildDiversePicks
  - swipeAction action + i18n toast.playingNext
provides:
  - "queue provenance: explicit (manualUids) entries survive a fresh-play context switch"
  - "queue-dry continuation seeded from the last-played song"
  - "swipe-left = play-next enqueue (was like)"
  - "lyrics translation reactive to the skip/lang whitelist for the current track"
affects:
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - "src/routes/(app)/search/+page.svelte"
  - "src/routes/(app)/library/+page.svelte"
  - "src/routes/(app)/artist/[name]/+page.svelte"
tech-stack:
  added: []
  patterns:
    - "one-shot side-state carrier (pendingManual) mirroring pendingHistory — plain field, never $state, never a Track-level origin field"
    - "reactive lyrics derivation: synchronous clear on key-change + early-return; synchronous originals for the zero-send path"
key-files:
  created:
    - .planning/quick/260618-fiz-four-queue-playback-fixes-immediate-tran/deferred-items.md
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/NowPlaying.svelte
    - "src/routes/(app)/search/+page.svelte"
    - "src/routes/(app)/library/+page.svelte"
    - "src/routes/(app)/artist/[name]/+page.svelte"
decisions:
  - "manualUids stays the single queue-provenance source; pendingManual only CARRIES the Track objects across the setQueue/setListQueue wipe (the Set holds uids only). No per-Track origin field."
  - "ensureAhead now seeds from the CURRENT track via buildSimilarQueue (artist.getSimilar → same-artist fallback); buildDiversePicks is demoted to the last-resort fallback when similar is dry (never-stop)."
  - "Fix 1 was render staleness, not a dead effect: the $effect already keyed on skip+lang. Synchronous clear-on-key-change + synchronous zero-send originals make the displayed lyrics re-derive immediately."
metrics:
  duration: ~18 min
  tasks: 5
  files: 6
  completed: 2026-06-18
---

# Phase quick-260618-fiz Plan 01: Four Queue/Playback Fixes + Immediate Lyrics Translation Summary

Four interdependent SvelteKit-player fixes: swipe-left now enqueues play-next (not like), explicit
queue entries survive a fresh-play context switch while the auto/context tail is dropped, queue-dry
autoplay continuation is seeded from the last-played song, and the lyrics English-translation toggle
re-renders the currently displayed lyrics immediately.

## What Shipped

- **Fix 2 (Task 1, `bbb79a7`):** Repointed `onSwipeLeft` in search/library/artist pages to
  `player.playNext(track)` (reusing the existing enqueue), replaced the toast with `toast.playingNext`,
  swapped the Heart reveal layer for a `ListStart` play-next affordance (`.reveal-like` → `.reveal-next`),
  and dropped the `toggleLike`/`wasLiked` swipe path. The artist-page action-bar like (favArtist) is
  untouched. All 6 `onSwipeLeft` bindings now call play-next.
- **Fix 4 (Task 2, `1fcb798`):** Added a one-shot `pendingManual` carrier captured (via `captureManual()`)
  before `setQueue`/`setListQueue` wipe the queue. `weaveManualAfterSeed()` re-inserts those explicit
  entries right after the seed on a fresh play — in BOTH up-next modes — while the prior auto/context
  tail is rebuilt (generated) or replaced by the list snapshot (same-list). `pendingManual` is nulled on
  non-fresh advance and `clearQueue()`; the rebuild bumps `queueGen` (WR-06).
- **Fix 3 (Task 3, `e3e0626`):** `ensureAhead()` now calls `buildSimilarQueue(current, have)` (seeded
  from the song playing as the queue empties) instead of random `buildDiversePicks`. The diverse picks
  are the last-resort fallback only when `buildSimilarQueue` returns empty. `queueGen` supersedence +
  `growing`/`growPromise` re-entrancy guards preserved verbatim.
- **Fix 1 (Task 4, `063b5ba`):** Made the displayed lyrics robustly reactive to `settings.lyricsSkip` /
  `lyricsLang`: clear `translated` + reset `trKey` on the no-translate early return, and set the
  all-whitelisted originals synchronously via `stitch([])` so `showTr` stays true the instant the user
  whitelists the last source. Toggling the whitelist now re-derives the current song without a replay.

## Deviations from Plan

**None for Tasks 1–4** — implemented as specified, grounded in the real functions named in the plan
(`player.playNext`, `manualUids`/`regenerate`, `ensureAhead`/`buildSimilarQueue`, the NowPlaying lyrics
`$effect`).

### Task 2 test fix during authoring (not a code deviation)
The first draft of the `same-list` test used `resolved()` helpers that all share the artist/title
`Artist|Song`, so `dedupeBest` collapsed the seed and the list-mate into one song and the assertion
failed. Fixed the TEST to use distinct artist/title per track (the production code was correct). No
source change resulted.

## Task 5 — Verification Sweep

- `npx vitest run src/lib/stores/player.svelte.test.ts src/lib/stores/library.svelte.test.ts` → **124 passed**
  (player 121 incl. 5 new tests; library 3).
- `npx svelte-check --tsconfig ./tsconfig.json` → **0 errors / 0 warnings** (4288 files).
- Full `npx vitest run` → **886 passed, 6 failed**. All 6 failures are PRE-EXISTING in
  `home-layout.test.ts` (3) and `catalog.test.ts` (3) — modules this task never touched. Verified failing
  against the base commit (8eb6d14): `home-layout.test.ts` fails identically (3 failed / 27 passed) with
  base source. Logged in `deferred-items.md`; out of scope per the scope boundary.

## Manual Verification Still Recommended (browser)

- Fix 1: open a song's lyrics, toggle the English-translation whitelist on /settings/translation, return
  to now-playing → displayed lyrics reflect the new setting without replaying.
- Fix 2: swipe a row right-to-left → "Playing next" toast + the song is enqueued after current.

## Self-Check: PASSED

- Files exist: player.svelte.ts, player.svelte.test.ts, NowPlaying.svelte, search/library/artist +page.svelte — all present and modified.
- Commits exist: bbb79a7, 1fcb798, e3e0626, 063b5ba — all in `git log`.
