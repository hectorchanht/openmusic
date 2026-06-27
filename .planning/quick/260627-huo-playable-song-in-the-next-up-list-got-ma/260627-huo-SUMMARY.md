---
phase: quick-260627-huo
plan: 01
subsystem: player / playback resilience
tags: [svelte5, playback-resilience, prefetch, retry, unplayable, fake-timers, vitest]
requires:
  - prefetchNext + prefetchController + prefetchingUid (src/lib/stores/player.svelte.ts)
  - prefetchArmedForSrc + PREFETCH_PLAYBACK_DELAY_MS timeupdate gate (src/lib/stores/player.svelte.ts)
  - strikeUnplayable + clearStrike + unplayableStrikes + STRIKE_CAP (src/lib/stores/player.svelte.ts)
  - unplayableUids SvelteSet + nextPlayableIndex + retryUnplayable (src/lib/stores/player.svelte.ts)
  - probePlayable (src/lib/stores/player.svelte.ts)
provides:
  - bounded, backed-off DELAYED fresh re-resolve before a next-up uid is promoted to permanently-dead
  - scheduleRetryResolve / cancelRetryResolve / cancelAllRetryResolves
  - handleDefinitiveFailure decision point shared by both prefetchNext definitive-failure branches
  - EAGER one-shot prefetch of the immediate-next at play() src-set (not gated on 5s or `playing`)
  - fake-timer unit suites for delayed-retry recovery, bounded promote-after-exhaustion, eager prefetch
affects:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
tech-stack:
  added: []
  patterns:
    - "delayed retry CONVERGENCE driven by a per-uid attempt-budget map (retryResolveAttempts), not by re-accumulating strikes"
    - "self-guarded setTimeout callback re-reads current/queue at fire time (never a closed-over index)"
    - "eager prefetch armed at play() src-set; the timeupdate gate becomes a no-op-when-already-armed backstop"
    - "vi.advanceTimersByTimeAsync(0) to drain the microtask-flush macrotask while fake timers are installed"
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "The delayed-retry callback does NOT clearStrike() (the plan suggested it would). Reason: with STRIKE_CAP=2 a single re-resolve walk only strikes ONCE (sub-cap), so clearing the strike would prevent the delayed path from ever re-reaching the cap — the uid would sit at strike 1 forever and never be promoted to dead even when genuinely dead. Keeping the uid at-cap makes every still-failing delayed round re-enter handleDefinitiveFailure at-cap, so convergence is governed purely by the bounded retryResolveAttempts budget. A track that RECOVERS lands in its slot and is never re-struck; its stale at-cap strike is cleared on the real `playing` event (and by clearQueue / recoverFromStop / retryUnplayable). Documented inline."
  - "Introduced a private handleDefinitiveFailure(uid) helper to hold the strike → undo-premature-promotion → schedule-or-leave-dead decision, called from BOTH prefetchNext definitive-failure branches (no-url + hard probe error). Avoids duplicating the budget/undo logic across the two call sites."
  - "Eager prefetch uses a NON-fresh play in its unit test to isolate the src-set eager walk from the fresh-play regenerate/weave rebuild path. The src-set kick itself runs identically on fresh and non-fresh plays."
metrics:
  duration: ~9 min
  completed: 2026-06-27
---

# Quick 260627-huo: Playable Next-up Song Falsely Marked Non-playable Summary

A genuinely-playable song in the Next-up list was being promoted into `unplayableUids` (a dimmed ✗ "skipped" row) because two quick transient upstream resolve/probe blips reached `STRIKE_CAP`. This replaces "strike → promote to dead" with "strike → schedule a bounded, backed-off delayed fresh re-resolve → only promote to dead after the delayed re-resolves are exhausted", and makes the single immediate-next song prefetch fire eagerly at `play()` src-set so short tracks / fast skips still have it pre-resolved + probe-verified for gapless, non-stop advance. Pure logic change in the existing `Player` class; no new dependencies.

## What was built

- **Task 1 — Delayed bounded re-resolve before death (`fix fa085de`):**
  - New private statics `RETRY_RESOLVE_MAX = 2` and `RETRY_RESOLVE_DELAY_MS = 4000` (linear backoff `DELAY * (attempt+1)`) beside `STRIKE_CAP` (which is **unchanged** at 2 — the user explicitly asked for a time-delayed path, not a cap bump).
  - New session state `retryResolveTimers: Map<uid, timer>` (pending timer per uid, for cancellation) and `retryResolveAttempts: Map<uid, number>` (per-uid delayed-attempt budget — the bounding mechanism).
  - `scheduleRetryResolve(uid)`: dedupes (one in-flight retry per uid), returns early when the budget is exhausted (caller leaves it dead), bumps the attempt count, computes a backed-off delay, and arms a self-guarded `setTimeout`. The callback deletes its own timer entry, re-reads `current`/queue **at fire time** (drops silently if the uid is no longer ahead or already confirmed dead), then re-runs `prefetchNext()` — reusing all of prefetch's abort/dedupe/probe machinery, never duplicating resolve logic. It never throws, never bumps `playGen`, never calls `next()`/`runFallback`.
  - `cancelRetryResolve(uid)` + `cancelAllRetryResolves()` wired into every recovery point: `clearQueue` and `recoverFromStop` (next to the existing `unplayableStrikes.clear()`), `retryUnplayable` (a manual retry supersedes a pending delayed retry), and the real-`playing` event for the now-current track (a track that actually produced audio has recovered — cancel its stale timer + reset its attempt budget).
  - New `handleDefinitiveFailure(uid)` replaces the bare `strikeUnplayable(cand.uid)` in both `prefetchNext()` definitive-failure branches (no-url resolve + hard probe `error`). At `STRIKE_CAP`: if delayed-retry budget remains it **undoes** the premature `unplayableUids` promotion and arms a delayed re-resolve; if the budget is exhausted it leaves the uid promoted (genuinely dead). A probe **timeout** branch is unchanged (no strike, no schedule).
  - New fake-timer suite `player delayed re-resolve …` (5 cases): no-url failure schedules a delayed re-resolve and the candidate recovers with a fresh url; a candidate that stays dead across all `RETRY_RESOLVE_MAX` attempts is eventually promoted (bounded — `retryResolveAttempts === MAX`, no timer pending); `clearQueue` / `recoverFromStop` cancel pending timers and empty both maps; `retryUnplayable` cancels that uid's timer. Reworked the pre-existing "strike 2 → immediately dead" test to the new contract (strike 2 reaches cap but arms a delayed retry instead of dying — assertion strengthened, not weakened).

- **Task 2 — Eager immediate-next prefetch (`feat df9f55a`):**
  - At **both** `play()` src-set points (network path and offline-blob path), immediately after `this.audio.src = …`, set `prefetchArmedForSrc = true` and fire `void this.prefetchNext()` (fire-and-forget, gen-guarded by prefetch's own `seedUid`/abort). The immediate-next now begins resolving + probe-verifying the instant the current src loads, independent of the ~5s `timeupdate` gate.
  - Because `prefetchArmedForSrc` is now already `true`, the existing `!this.prefetchArmedForSrc` timeupdate-gate condition makes the gate a **no-op backstop** for the same src — single walk per src. `PREFETCH_PLAYBACK_DELAY_MS` and the gate itself are untouched (the gate still guards long tracks / re-arm after a new src).
  - NOT gated on the `playing` event (project memory: a prior "displayed-defer" change waited on `playing` and froze iOS — reverted).
  - New suite `player eager prefetch …` (2 cases) using the **real** `play()` (restored from the global mock) + a fake `<audio>`: `play()` eagerly prefetches the immediate-next with `currentTime` still 0 (no timeupdate ever fired) and `prefetchArmedForSrc === true`; a later timeupdate past 5s does **not** fire a second walk for the same src.

- **Task 3 — Full suite + type check (verification only, no extra commit):**
  - `pnpm vitest run` — **928 passed (66 files)** (was 921; +7 new tests).
  - `pnpm check` — **0 errors, 0 warnings** (4291 files).
  - No cross-file fallout: the one pre-existing player test asserting the old strike-immediately-dead timing was reworked to the new correct behavior (documented inline); the existing timeupdate-gate test already drove the gate in isolation (manipulates `prefetchArmedForSrc` directly without going through `play()`), so it needed no change.

## Deviations from Plan

### Auto-fixed / refined

**1. [Rule 1 — Correctness] Delayed callback does NOT clearStrike (plan suggested it would)**
- **Found during:** Task 1 (the "stays dead across all attempts" test failed — the uid sat at strike 1 and was never promoted to dead).
- **Issue:** The plan's step-3 wording had the delayed callback call `clearStrike(uid)` before re-running the walk. With `STRIKE_CAP = 2`, a single re-resolve walk only strikes **once** (sub-cap), so after clearing the strike the uid could never re-reach the cap — the delayed path would never converge to death for a genuinely-dead track, and the second delayed attempt would never be scheduled (breaking the bounded-promote guarantee).
- **Fix:** Keep the uid at-cap across delayed rounds; drive convergence purely via the bounded `retryResolveAttempts` budget. Each still-failing delayed round re-enters `handleDefinitiveFailure` at-cap and either re-schedules (budget left, with backoff) or promotes to dead (budget exhausted). A recovered track lands in its slot and is never re-struck; its stale at-cap strike is cleared on the real `playing` event and by `clearQueue`/`recoverFromStop`/`retryUnplayable`. Documented inline in `scheduleRetryResolve`.
- **Files modified:** src/lib/stores/player.svelte.ts
- **Commit:** fa085de

**2. [Refinement] Extracted handleDefinitiveFailure helper**
- The plan described inlining the undo+schedule-vs-leave-dead logic into both `prefetchNext` definitive-failure branches. To avoid duplicating the budget/undo decision across the two call sites (no-url + hard probe error), it lives in one private `handleDefinitiveFailure(uid)` called from both. Behavior is identical to the plan's intent.
- **Commit:** fa085de

## Constraints honored (manual code audit)

- `STRIKE_CAP` **not bumped** (still `= 2`).
- The single new `setTimeout` (in `scheduleRetryResolve`) has matching cancel paths at clearQueue, recoverFromStop, retryUnplayable, and real-`playing`; `cancelAllRetryResolves` clears every pending timer + both maps; the callback self-guards by re-reading `current`/queue at fire time.
- No new dependency on the `playing` event (eager prefetch fires at the `play()` src-set path).
- Delayed-retry + eager prefetch never bump `playGen` / call `next()` / `runFallback` — both only re-arm the existing `prefetchNext()` walk.
- No new packages (threat T-huo-NS: accept).

## Device-only behaviors requiring human UAT (cannot be unit-verified)

These need verification on a real device (iOS Safari + Android Chrome) — the fake-timer unit tests prove the logic but not the real audio/network/backgrounding behavior:

1. **Original complaint:** A real song that was intermittently failing in Next-up now recovers and plays after a few seconds **without tapping Retry** — verify the dimmed ✗ row does not appear for a genuinely-playable song hit by a transient blip, and that it self-recovers.
2. **Gapless / no-dead-air advance** between a **short** track (shorter than the 5s prefetch gate) and its eagerly-prefetched next song, and on a **fast skip** before 5s.
3. **Non-stop playback across many consecutive tracks with the screen locked / app backgrounded** — the delayed-retry timers and eager prefetch must survive backgrounding/tab-refocus; if a timer is throttled while backgrounded, the reactive never-stop chain still backstops (delayed retry is best-effort recovery, never the sole path).
4. **No regression** of the previously-fixed "plays ~3s then auto-advances" bug and the "displayed-defer froze playback" bug (the eager prefetch is deliberately NOT gated on the `playing` event).
5. **Bot-traffic posture:** confirm endless playback does not produce a visible resolve burst (the per-uid `RETRY_RESOLVE_MAX` cap + linear backoff + single-walk-per-src eager dedupe should keep resolve rate low).

## Verification

- `pnpm vitest run src/lib/stores/player.svelte.test.ts` — 134 passed (was 132 → +5 delayed-retry suite incl. 1 reworked, +2 eager-prefetch).
- `pnpm vitest run` — 928 passed (66 files).
- `pnpm check` — 0 errors, 0 warnings.

## Self-Check: PASSED

- FOUND: src/lib/stores/player.svelte.ts (modified)
- FOUND: src/lib/stores/player.svelte.test.ts (modified)
- FOUND commit: fa085de (Task 1)
- FOUND commit: df9f55a (Task 2)
