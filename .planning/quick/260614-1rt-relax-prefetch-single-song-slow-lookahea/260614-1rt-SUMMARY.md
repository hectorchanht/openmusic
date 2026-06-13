---
phase: quick-260614-1rt
plan: 01
subsystem: player-store
tags: [prefetch, playback, bot-detection, svelte-store]
requires:
  - "src/lib/services/catalog.ensureTrackDetails (idempotent per-source resolve)"
provides:
  - "Delayed, single-song-lookahead prefetch gated on ~5s of real playback"
affects:
  - "src/lib/stores/player.svelte.ts (prefetchNext, primeNext, timeupdate listener, play() arming points)"
tech-stack:
  added: []
  patterns:
    - "One-shot per-src trigger flag (prefetchArmedForSrc) flipped at the timeupdate elapsed-playback gate"
key-files:
  created: []
  modified:
    - "src/lib/stores/player.svelte.ts"
    - "src/lib/stores/player.svelte.test.ts"
decisions:
  - "Prefetch fires only after ~5s of actual playback (timeupdate-gated), never on play() entry"
  - "prefetchNext is single-song: a rejecting / no-audioUrl immediate-next is abandoned, never walks to a later candidate"
metrics:
  duration: ~6 min
  completed: 2026-06-14
---

# Quick Task 260614-1rt: Relax Prefetch — Single-Song Slow Lookahead Summary

Relaxed the SvelteKit player-store prefetch to a single-song lookahead armed ~5s into real playback (off the existing `timeupdate` listener) instead of a 4-candidate forward-resolve burst fired the instant playback starts — so endless playback no longer trips audio-source bot detection.

## What Changed

### Task 1 — Single-song lookahead + ~5s delayed trigger (`player.svelte.ts`)
- **`prefetchNext()`** rewritten from a bounded forward-resolve loop (`for idx = firstIndex .. min(i+PREFETCH_MAX_CANDIDATES, len-1)`) to resolving **only** the immediate-next entry `queue[indexOf(current)+1]`. A reject or a no-`audioUrl` result is now abandoned for that invocation (the next `play()` resolves it on-demand via the idempotent `ensureTrackDetails`); it never advances to a further candidate.
- All existing single-immediate-next guards preserved verbatim: end-of-queue no-op, already-complete short-circuit (warm assets, skip resolve), in-flight dedupe keyed to the immediate-next uid, `AbortController` supersede, `seedUid` stale-guard after the await, fresh write-back-by-uid only if still ahead of current.
- Removed the now-dead `PREFETCH_MAX_CANDIDATES` static and updated the doc-comment to describe single-song lookahead.
- **`primeNext()`** no longer calls `prefetchNext()` — it only runs `ensureAhead()`. The four `play()` call sites (offline-blob / fresh+generated / fresh+same-list / auto-advance) stay unchanged.
- Added `private static PREFETCH_PLAYBACK_DELAY_MS = 5000` and `private prefetchArmedForSrc = false`. In the `timeupdate` listener, after `this.currentTime = el.currentTime || 0`, a one-shot per-src gate fires `void this.prefetchNext()` once `currentTime >= PREFETCH_PLAYBACK_DELAY_MS / 1000`. `prefetchArmedForSrc` is reset to `false` at both initial-load arming points (alongside `hasPlayedSinceSrc = false`).
- Failure handling untouched: the commented `tripLoopGuard`, `errorBurst`, and the 15s `armStall` watchdog are left exactly as-is.

### Task 2 — Test contract update (`player.svelte.test.ts`)
- Removed the 3 multi-candidate forward-resolve cases (REJECTS-then-lands, no-audioUrl-then-lands, `PREFETCH_MAX_CANDIDATES` cap) and the unused `Player_PREFETCH_MAX_CANDIDATES` mirror.
- Added single-song-abandon cases: a rejecting immediate-next and a no-`audioUrl` immediate-next are each abandoned (`mockEnsure` called exactly once, never for the later candidate; neither slot written back).
- Adapted the mid-resolve stale-guard to a single-candidate version.
- Split the old "primeNext grows then pre-resolves" test into: an `ensureAhead`-only grow (no prefetch on entry, next slot stays an unresolved stub) and a direct `prefetchNext` pre-resolve.
- Added a delayed-trigger test driving the real `timeupdate` gate via the fake audio element: no prefetch below 5s, exactly one resolve at the threshold, no re-fire for the same src.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Gates

Run from inside the worktree (worktree has no `node_modules`; used the main repo's binaries at `/Users/laichan/code/tung/openmusic/node_modules/.bin`). The plan's literal commands `cd /Users/laichan/code/tung/openmusic && pnpm exec vitest ...` target the MAIN checkout, which does not contain these edits — so they were run against the worktree source instead.

- **`vitest run src/lib/stores/player.svelte.test.ts`** — PASS (93 passed). Baseline was 92; net change is -3 removed multi-candidate cases +1 split primeNext test +3 new single-song/delayed cases.
- **`vitest run` (full suite)** — PASS (62 files, 835 tests). No collateral breakage.
- **`pnpm check` (`svelte-kit sync && svelte-check`)** — PASS: 0 errors, 0 warnings, 4279 files. No unused `PREFETCH_MAX_CANDIDATES` / `Player_PREFETCH_MAX_CANDIDATES`.

## Manual Reasoning Trace (no device)
- Play a track → `play()` sets `prefetchArmedForSrc = false`; `primeNext()` only tops up the queue, no resolve fires at t=0.
- `timeupdate` fires ~4×/sec; below 5s the gate is inert → no prefetch resolve.
- At `currentTime >= 5s`, the gate flips `prefetchArmedForSrc = true` and fires exactly one `prefetchNext()` for `queue[i+1]` (one source-specific resolve).
- A skip before 5s loads a new src (re-arms the flag) without any prefetch having run → the next `play()` resolves the next track on-demand. No error/notice spam.

## Commits
- `76b3e6f` feat(260614-1rt): single-song lookahead + ~5s delayed prefetch trigger
- `9d815bf` test(260614-1rt): single-song + delayed-prefetch contract

## Self-Check: PASSED
- `src/lib/stores/player.svelte.ts` — FOUND (modified, committed in 76b3e6f)
- `src/lib/stores/player.svelte.test.ts` — FOUND (modified, committed in 9d815bf)
- commit `76b3e6f` — FOUND
- commit `9d815bf` — FOUND
