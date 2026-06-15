---
phase: quick-260615-i9u
plan: 01
subsystem: player-queue
tags: [up-next, queue-model, resilience, i18n, svelte5-runes]
requires:
  - player.svelte.ts queue engine (queueGen/playGen/manualUids/removedUids/unplayableUids)
  - settings.effectiveUpnextMode(context)
  - svelte/reactivity SvelteSet (already-installed, no new dep)
provides:
  - reactive unplayableUids (SvelteSet) + isUnplayable()/retryUnplayable() public API
  - dimmed ✗ skipped Up-Next row with tap-to-retry in NowPlaying
  - history-preserving fresh-play queue model (insert-after-current, capped, per-context tail)
  - nowplaying.skippedRetry i18n key (all 15 locales)
affects:
  - src/lib/stores/player.svelte.ts
  - src/lib/components/NowPlaying.svelte
  - src/lib/stores/player.svelte.test.ts
  - src/lib/i18n/*.ts (15 dicts)
tech-stack:
  added: []
  patterns:
    - SvelteSet for reactive session-only dead-track set (drop-in for Set)
    - one-shot pendingHistory carrier captured in setQueue/setListQueue (??= guard), consumed once by fresh play()
    - history-aware regenerate (preserve head up-to+including seed; regen only tail)
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/components/NowPlaying.svelte
    - src/lib/stores/player.svelte.test.ts
    - src/lib/i18n/en.ts (+14 other locale dicts)
decisions:
  - HISTORY_CAP=50 (private static, tunable) bounds queue growth across many clicks (T-i9u-02)
  - re-click of an already-played song MOVES it to new-current (de-dupe), never duplicates history
  - capture history INSIDE setQueue/setListQueue (pre-wipe) — zero edits to the ~10 fresh-play call sites
  - ✗ affordance is the row tap only; gripDrag/swipeRemove/longpress untouched
metrics:
  duration: 8 min
  completed: 2026-06-15
  tasks: 3
  files: 18
---

# Phase quick-260615-i9u Plan 01: Up-Next skipped-track markers + history-preserving click-enqueue Summary

Shipped both deferred Up-Next/queue features on the existing player queue engine (no parallel queue): probe-confirmed-dead tracks now render a dimmed ✗ tap-to-retry row via a reactive `SvelteSet`, and a fresh user click preserves capped playback history + the prior current in the queue (insert-after-current) instead of wiping it, with the clicked song's tail built per `effectiveUpnextMode`.

## What Was Built

### Task 1 — Reactive unplayableUids + ✗ skipped Up-Next row (commit 9cfaea5)
- `unplayableUids` converted from plain `Set` to `SvelteSet` (`svelte/reactivity`) — drop-in, all existing `.add/.has/.clear` call sites unchanged; only new effect is reactive repaint.
- Public `isUnplayable(uid)` reactive read accessor + `retryUnplayable(track)` (deletes the uid, replays that exact track via the NON-fresh path — a retry, not a fresh regenerate).
- NowPlaying Up-Next row: `{@const skipped}` per row, `class:skipped` (opacity .45), leading `✗` `.r-skip` span, branched `onclick` (skipped → retry; else play), `title` hint. `use:swipeRemove`/`use:longpress`/grip-handle deliberately untouched so reorder + swipe-remove keep working on a skipped row.
- `nowplaying.skippedRetry` i18n key added to ALL 15 locale dictionaries (i18n parity test green).

### Task 2 — History-preserving fresh-play queue model (commit 292a1a9)
- `private static HISTORY_CAP = 50` + one-shot `private pendingHistory: Track[] | null` carrier.
- `captureHistory()`: pre-wipe prefix up to AND including the prior current (uid → sameSongKey fallback), capped to the last HISTORY_CAP. Cold start (no current) → `[]` (degrades to today's `[seed, ...tail]`, no regression).
- `setQueue` + `setListQueue` capture via `this.pendingHistory ??= this.captureHistory()` BEFORE the wipe — `??=` in both so the setListQueue→setQueue delegate path doesn't double-capture/clobber. Zero edits to the ~10 fresh-play call sites.
- `weaveFreshHistory(seed)`: de-dupes the seed out of the prefix (re-click MOVES, no duplicate), anchors seed into the post-snapshot baseline, prepends prefix, re-anchors, bumps `queueGen` (WR-06), nulls the carrier. Seed lands immediately after the prior current.
- `play()` fresh-branch: weave history FIRST, then build the tail (generated → history-aware `regenerate`; same-list → `primeNext`). Non-fresh branch nulls `pendingHistory` so a stale capture never leaks into a later fresh play.
- `regenerate()` made history-aware: keeps the head up-to+including the seed (woven history + seed), regenerates only the tail after the seed, and feeds the head uids into the `buildSimilarQueue` exclude set so generated picks never duplicate history.
- `prev()`/`toggleShuffle`: no behavior change (comments only) — `prev()` back-walks the preserved history (non-fresh, no re-weave); shuffle reads `indexOf(current)` live so it still pins current + all history.

### Task 3 — Tests (commit 192218c)
- Widened the `internals` cast for the SvelteSet `unplayableUids` surface; reset `pendingHistory` in the global `beforeEach` so the one-shot carrier never leaks across tests.
- Added history-aware regenerate test (head + seed preserved, only tail regen, head excluded), and a setListQueue non-empty-pre-current-head capture test.
- New REAL-play describe block: history kept + capped (50, oldest dropped), insert-after-current, `prev()` revisits prior current, re-click moves (no dup), same-list keeps history + list remainder tail.
- New store-level `isUnplayable`/`retryUnplayable` (non-fresh) coverage.

## Verification

- `npm run check`: **0 errors, 0 warnings** (`COMPLETED 4280 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`).
- `npx vitest --run`: **fully green — Tests 854 passed (854), Test Files 62 passed (62)**. The player suite grew 98 → 107 tests (9 added); the i18n parity test validates the new key across all 15 dicts.
- Manual trace (Task 2 before/after arrays): prior `[h0,h1,PC,oldA]` current=PC, fresh click X (generated, mockSimilar→[]) → `[h0,h1,PC,X]`, current=X at index 3, `prev()` → `play(queue[2])` === PC. Capped: 60-entry head → kept 50, queue[0]===E10, X at index 50. Re-click h0 from `[h0,PC,old]` → `[PC,h0]` (single h0). Same-list `[h0,PC]`+setListQueue([X,a,b]) → `[h0,PC,X,a,b]`. All confirmed by automated tests.

## Deviations from Plan

None — plan executed exactly as written. (Beyond the plan's explicit step-4 internals-cast guidance, also reset `pendingHistory` in the global `beforeEach` to prevent the one-shot carrier leaking across tests — a test-hygiene application of the same discipline the plan calls out for `unplayableUids.clear()`.)

## Authentication Gates

None.

## Human-Verify Checkpoint (deferred — record only, did not block)

No `checkpoint:human-verify` task existed in the plan (all 3 tasks are `type="auto"`). For on-device eyeballing when convenient (DOM-reactive repaint + gestures are not node-unit-testable):
- A track the probe walk marks dead shows a dimmed ✗ row in Up-Next; tapping it retries that exact track (un-dims if it recovers, re-skips if definitively dead).
- Clicking a new song keeps prior songs revisitable via the back/prev control and builds next-up off the clicked song.
- Per-context tail correct: album/search (same-list) → list remainder after the clicked song; generated → buildSimilarQueue picks.
- gripDrag reorder + swipeRemove still work on Up-Next rows (incl. a skipped row).

## Known Stubs

None.

## Self-Check: PASSED
- src/lib/stores/player.svelte.ts — FOUND (modified, SvelteSet + history model)
- src/lib/components/NowPlaying.svelte — FOUND (modified, ✗ row)
- src/lib/stores/player.svelte.test.ts — FOUND (modified, +9 tests)
- Commits 9cfaea5, 292a1a9, 192218c — all FOUND in git log.
