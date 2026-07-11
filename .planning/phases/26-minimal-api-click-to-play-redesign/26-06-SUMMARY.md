---
phase: 26-minimal-api-click-to-play-redesign
plan: 06
subsystem: stores/player
tags: [resolve-watchdog, click-to-play, cross-source-fallback, never-stop, abort-signal, gap-closure, svelte5, vitest, tdd]

# Dependency graph
requires:
  - src/lib/stores/player.svelte.ts runFallback/tryFallback/handleTotalFailure — the existing kuwo-first cross-source walk + auto-skip machinery this plan routes into
  - src/lib/services/catalog.ts ensureTrackDetails(track, signal) — AbortSignal-honoring resolve (26-01)
provides:
  - src/lib/stores/player.svelte.ts Player.RESOLVE_WATCHDOG_MS — resolve-phase watchdog tunable (~6s) bounding the click-to-play network resolve
  - src/lib/stores/player.svelte.ts play() — a stalled OR null initial resolve routes into runFallback (unified timeout/null resolve-failure branch); logs resolve.timeout
affects: [click-to-play, cross-source-failover, never-stop, resolve-phase-resilience]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolve-phase watchdog: Promise.race(ensureTrackDetails(track, ac.signal), timeout) — on the deadline ac.abort() cancels the stalled /api fetch (frees the connection) AND the timeout wins the race with the audioUrl-less stub, so play() unblocks even if a downstream ignores the signal (never-hang does NOT depend on adapter cooperation)"
    - "Distinct from STALL_TIMEOUT_MS (audio LOAD phase); RESOLVE_WATCHDOG_MS bounds the earlier NETWORK RESOLVE phase before any src is set"
    - "Unified resolve-failure branch: timedOut || !resolved.audioUrl → the ONE existing runFallback kuwo-first walk; total exhaustion auto-skips via handleTotalFailure → next()"
    - "swallow-the-late-rejection: resolveP.catch(() => {}) prevents the post-race apiFetch caller-abort rejection surfacing as an unhandled rejection; timer cleared in finally so a fast resolve leaves no dangling timer / spurious late abort"

key-files:
  created:
    - .planning/phases/26-minimal-api-click-to-play-redesign/26-06-SUMMARY.md
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts

key-decisions:
  - "Implemented via Promise.race (not a bare await + abort) — a deliberate hardening over the plan's literal abort-only text: the never-hang guarantee must NOT depend on the downstream adapter honoring the signal, and the race makes the acceptance test's 'ensureTrackDetails never settles' scenario deterministic. apiFetch DOES reject a caller-abort, so the abort still frees the connection (T-26-06-02); the race is the unblock authority"
  - "RESOLVE_WATCHDOG_MS = 6000 (intended band 5-8s): comfortably under apiFetch's ~25s REQUEST_TIMEOUT_MS so a stall fails fast, comfortably over a healthy sub-2s resolve so the happy path never trips it (no fan-out)"
  - "Reused runFallback/tryFallback/fallbackOrder/handleTotalFailure verbatim — NO new resolver added to catalog.ts; the player's runFallback IS the same-song cross-source walk"
  - "Kept the null-resolve path unified with the timeout path (timedOut || !resolved.audioUrl) — one resolve-failure branch, one behavior"

requirements-completed: [RESOLVE-02]

# Metrics
duration: 8min
completed: 2026-07-12
---

# Phase 26 Plan 06: Resolve-Phase Watchdog on Click-to-Play Summary

**Closes the Phase-26 UAT gap-1 BLOCKER: a tapped song whose source resolve stalls (slow/dead upstream) now fails fast into the existing kuwo-first cross-source walk instead of hanging in `loading` up to apiFetch's ~25s timeout. A bounded `RESOLVE_WATCHDOG_MS` (~6s) races the `ensureTrackDetails` network resolve; on elapse it aborts the stalled fetch and routes the same song into `runFallback` (→ `tryFallback` → `handleTotalFailure` auto-skip via `next()`). The healthy single-source happy path is unchanged — no fan-out, ~3-call budget preserved. Full suite green except the pre-existing deferred `searchHistory` SSR-guard failure.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-12
- **Tasks:** 2 of 2 (Task 1 TDD RED→GREEN, REFACTOR not needed; Task 2 regression characterization)
- **Files:** 1 created (this SUMMARY), 2 modified

## Accomplishments

- **Task 1 (RESOLVE-02 — resolve-phase watchdog), TDD:**
  - **RED** (`92e6d9f`): 5 new tests in a `player resolve-phase watchdog` describe (real `play()` restored from the top-level mock + fake `<audio>` + fake timers). 3 failed as expected (stalled → cross-source walk; stalled total-failure → auto-skip + loading false; regression stall-never-hangs); 2 characterized already-satisfied behavior (null-resolve already fans out; supersede + happy-path).
  - **GREEN** (`0ab316d`): added `private static RESOLVE_WATCHDOG_MS = 6000` (documented as distinct from the audio-load-phase `STALL_TIMEOUT_MS`); wrapped the network resolve await in `play()` with an `AbortController` + `Promise.race` watchdog — on the deadline set `timedOut`, `ac.abort()` (cancel the stalled fetch), and win the race with the audioUrl-less stub; swallow the post-race late rejection; clear the timer in `finally`. Unified the resolve-failure branch to `timedOut || !resolved.audioUrl` → the existing `runFallback` kuwo-first walk. Added a `logAction('resolve.timeout', …)` on the watchdog-fire branch.
  - **REFACTOR:** none needed — no commit.
- **Task 2 (regression proof):**
  - **`6008738`:** a `regression: no happy-path fan-out; a stall never hangs` describe: (1) a healthy resolve performs ZERO `tryFallback` calls and attaches the single source's URL; (2) a stalled resolve driven past the watchdog with total failure ends with `player.loading === false` (never permanently loading).

## Verification

- `pnpm test -- src/lib/stores/player.svelte.test.ts` — 185 passed (7 new: 5 Task-1 + 2 Task-2).
- Full `pnpm test` — 1165 passed, 1 failed (ONLY the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Deviations / Out of Scope).
- `pnpm check` — 0 errors, 1 warning (pre-existing unused `.warn` CSS selector in `search/+page.svelte`; unrelated to this plan).
- Behavioral proof (Task 1): stall → `tryFallback` invoked with the tapped `{artist,title}` and a playable swap re-enters `play(fromFallback:true)`; `tryFallback → null` → `next()` auto-skip + loading false; a newer `play()` during the watchdog window discards the stale resolve (no double fallback); a healthy resolve issues 0 cross-source calls.

## TDD Gate Compliance

- RED gate: `92e6d9f` `test(26-06): failing resolve-phase watchdog tests (RED)` — 3 behavioral tests failing as expected before any implementation.
- GREEN gate: `0ab316d` `feat(26-06): resolve-phase watchdog on click-to-play (GREEN)` — all 5 Task-1 tests green.
- Fail-fast honored: the RED run failed on `tryFallback` never being called (the hang) — exactly the missing watchdog behavior — not a masked pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Robustness] Promise.race unblock authority instead of a bare `await` + abort**
- **Found during:** Task 1 design (reviewing `apiFetch` abort semantics + the acceptance criterion "ensureTrackDetails mocked to never settle within the watchdog → tryFallback is invoked").
- **Issue:** The plan's literal design (`await ensureTrackDetails(track, ac.signal)`, rely on the abort to settle it) makes the never-hang guarantee depend on the downstream adapter honoring the signal. If any adapter ignored/slow-honored the signal, `play()` would still hang — defeating the whole fix. It also could not be driven by a "never settles" mock without extra abort wiring.
- **Fix:** Race the resolve against the watchdog timeout; on the deadline `ac.abort()` still cancels the in-flight fetch (frees the connection — T-26-06-02) but the timeout WINS the race with the audioUrl-less stub, so `play()` unblocks unconditionally at the deadline. Verified `apiFetch` rejects a caller-abort (`src/lib/services/api-base.ts:273`), so the abort is effective; the race is the unblock authority. Added `resolveP.catch(() => {})` to swallow the post-race late rejection.
- **Files modified:** src/lib/stores/player.svelte.ts
- **Commit:** 0ab316d

**2. [Rule 3 - Test isolation] Scoped the null-resolve test's mock to the tapped uid**
- **Found during:** Task 1 GREEN full-file run (passed in isolation, failed only in the full suite).
- **Issue:** The `NULL initial resolve` test nulled EVERY track's resolve, so a stray `play()` leaked from a prior suite's un-awaited async chain (resumed during a fake-timer microtask flush) itself fanned out and inflated the `tryFallback` count to 2. This singleton-based suite is leak-prone (hence its heavy per-test resets).
- **Fix:** Null only the tapped uid (a benign URL for any other track) — the isolation pattern the two stall tests already use; the test intent is "the TAPPED song's null resolve fans out". Full-file run now 185/185.
- **Files modified:** src/lib/stores/player.svelte.test.ts
- **Commit:** 0ab316d

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails with zero Phase-26 involvement (Node 22+ exposes `globalThis.localStorage`, so `typeof globalThis.localStorage === 'undefined'` no longer holds). Already documented in the 26-01 SUMMARY and the Phase-25 deferred-items. Not touched per the scope boundary.

**Pre-existing `pnpm check` warning: unused `.warn` CSS selector in `src/routes/(app)/search/+page.svelte`**
- Present before this plan; unrelated to the player store. Not touched per the scope boundary.

## Threat Model Compliance

- **T-26-06-01** (stalled resolve holds `loading`) — mitigated: `RESOLVE_WATCHDOG_MS` bounds the resolve await; never waits the full ~25s.
- **T-26-06-02** (leaked in-flight fetch after the watchdog) — mitigated: `ac.abort()` cancels the upstream resolve; `setTimeout` cleared in `finally` (no dangling timer / spurious late abort).
- **T-26-06-03** (reintroducing a happy-path fan-out) — mitigated: the cross-source walk fires ONLY on timeout/null; a healthy resolve stays single-source (asserted by Task 2 — 0 `tryFallback` calls).
- **T-26-06-SC** (package installs) — n/a: no new dependency added.

## Known Stubs

None. The watchdog is fully wired; it reuses the existing `runFallback`/`tryFallback`/`handleTotalFailure` machinery with no placeholders.

## Notes for Next Plan

- Gap 6 (version-pick resolve failure → stuck nowbar error) explicitly wants a picked-variant resolve failure routed into THIS gap-1 resolve-fallback + skip path. `VersionPicker` `onpick → player.play()` now inherits the resolve-phase watchdog automatically for a stalled variant resolve; the JOOX identity-mismatch THROW (a synchronous reject) is caught by the new `try/catch` in `play()` (routed as a failed resolve → runFallback), so a picked JOOX variant that can't be identity-verified now falls back/skips instead of surfacing a stuck error. Gap 6's remaining work (prefer stable songmid over the fragile n-index; only offer resolvable variants; the "couldn't play this version" toast) is separate.

## Self-Check: PASSED

- `26-06-SUMMARY.md` present on disk; `src/lib/stores/player.svelte.ts` present with `RESOLVE_WATCHDOG_MS` + the `resolve.timeout` log.
- All 3 commits (92e6d9f test/RED, 0ab316d feat/GREEN, 6008738 test/Task-2) present in git history.
