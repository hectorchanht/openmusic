---
phase: 31
plan: 02
subsystem: playback
tags: [strike-policy, cross-source-retry, skip-notice, never-stop, freeze-guards]
requires:
  - "31-01 (shares the audio.error handler — the corrupt-blob branch sits between the ceiling and the seek branch)"
provides:
  - "STRIKE_CAP = 3 (was 2) with the reasoning for 'not larger' recorded at the site"
  - "Player.clearAllStrikes(reason) wired to window 'online' + the foreground branch of visibilitychange"
  - "cross-source tryFallback retry inside handleDefinitiveFailure, before any strike is recorded"
  - "skip notices on the error-ceiling and second-stall paths via the existing batched emitSkipNotice"
  - "Player_STRIKE_CAP mirrored constant in the test file (the strike suites no longer hardcode the cap)"
affects:
  - src/lib/stores/player.svelte.ts
tech-stack:
  added: []
  patterns: [generation-guard, per-episode-attempted-set, batched-notice-channel, plain-listener-not-effect]
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "31-D-16 cap raised 2 → 3 only; the eager clearing is the cheap half of the fix and the cap raise is the expensive half"
  - "31-D-16 strike clearing is a plain window listener, not an $effect on online.isOnline — attach() must add no tracked read"
  - "31-D-15 cross-source retry lives at handleDefinitiveFailure (the walk's single decision point), reusing the existing per-episode fallbackAttempted set"
  - "31-D-15 the retry never increments failoverSkips — it repairs a track rather than skipping one"
  - "31-D-18 needed zero new i18n keys; it was a routing job into the existing emitSkipNotice channel"
  - "31-D-17 bg-error-skip keeps both omissions (no notice, no failoverSkips) and now documents why"
metrics:
  duration: ~20 min
  completed: 2026-08-09
  tasks: 3
  commits: 3
---

# Phase 31 Plan 02: Forgiving strikes, cross-source repair, and audible skips Summary

A next-up track that fails now gets tried on another source before it is struck, a tunnel no longer blacklists half the queue for the session, and every skip the user can actually see says so — with all four freeze-guard ceilings left exactly where they were.

## Guard constants — before / after

| Constant | Before | After | Note |
|---|---|---|---|
| `STRIKE_CAP` | 2 | **3** | the only intentional change (31-D-16) |
| `RAPID_ERROR_CAP` | 3 | **3** | byte-identical |
| `FAILURE_CAP` | 5 | **5** | byte-identical |
| `SYSTEMIC_SKIP_CAP` | 5 | **5** | byte-identical — the load-bearing cross-track bound |
| `SRC_REDRIVE_CAP` | 4 | **4** | byte-identical |
| `RETRY_RESOLVE_MAX` | 2 | **2** | byte-identical |
| `PREFETCH_MAX_CANDIDATES` | 4 | **4** | byte-identical |
| `RESOLVE_WATCHDOG_MS` | 6000 | **6000** | byte-identical (D-01) |

`git diff HEAD~3 HEAD -- src/lib/stores/player.svelte.ts | grep -E '^-.*(SYSTEMIC_SKIP_CAP|RAPID_ERROR_CAP|FAILURE_CAP|SRC_REDRIVE|RESOLVE_WATCHDOG)'` → nothing.

## What Changed

**Task 1 — forgive strikes (`00d5807`)**
`STRIKE_CAP` 2 → 3, with the "why not larger" written at the site: the cap raise is the *expensive* half of D-16 (each extra strike is another resolve + probe, multiplied again by `RETRY_RESOLVE_MAX = 2` delayed re-runs — roughly 9 chances per uid before death), while the eager clearing is the cheap half that actually fixes the reported complaint.

New `clearAllStrikes(reason)` refunds the whole strike budget and nothing else — it does **not** call `play()`, does **not** touch `unplayableUids`, and does **not** cancel pending `retryResolveTimers`. Wired at two recovery signals: a plain `window.addEventListener('online', …)` registered in `attach()` (a raw listener, **not** an `$effect` on `online.isOnline` — the layout mount effect `untrack()`s attach/restore precisely because tracked state written there self-invalidates it, the `restore-effect-self-invalidation-loop` freeze class), and the previously-empty foreground branch of the existing `visibilitychange` listener, carrying an explicit note that this branch must never grow a `play()` call (quick-260703-i7e).

**Task 2 — cross-source retry before death (`5167c56`)**
`handleDefinitiveFailure` is now `async` and prepends one guarded step: look the uid up in the queue, and unless it is the currently-playing track (that path is `runFallback`'s, with its own `fallbackGen` re-entrancy guard), call `tryFallback` before any strike is recorded. No new source walk — `tryFallback` is already kuwo-first via registry order, already `sameSongKey`-gated, already never-throws, and it is handed the **existing** per-episode `fallbackEpisodeKey`/`fallbackAttempted` set so each source is tried at most once per logical song. A swap writes back by fresh uid lookup (only while the slot is still ahead of the recomputed current), logs `prefetch.cross-source-swap`, clears the strike and returns; a null falls through to the pre-existing strike/retry-budget logic completely unchanged. `prefetchNext`'s two call sites now `await` it and re-check the `sig.aborted`/`seedUid` stale-guard immediately after, per the generation-guard idiom.

`failoverSkips` is deliberately **not** incremented here, with the reasoning in-code: this path repairs a track rather than skipping one, and inflating the only cross-track counter would trip `SYSTEMIC_SKIP_CAP` early — a never-stop violation on a queue that is actually healing.

**Task 3 — no more silent skips (`567000a`)**
The error-ceiling skip and `recoverLoadStall`'s second-stall skip now feed the existing batched `emitSkipNotice` channel, so three feeders still produce one toast per burst window. The ceiling call sits inside the `else` path, so the `SYSTEMIC_SKIP_CAP` STOP branch and its sticky Retry notice are untouched. Zero new i18n keys — `toast.skipped` / `toast.skippedMany` already carry the copy, so no dictionary was edited.

`bg-error-skip` was left behaviourally identical and now carries a `31-D-17` comment recording both deliberate omissions: no notice (it only runs while `document.hidden`, so the toast would replay as a stale burst on foreground return) and no `++failoverSkips` (counting it would let an unattended locked device reach `SYSTEMIC_SKIP_CAP` and pause itself — a never-stop violation in exactly the unattended scenario).

## D-17 regression proof

The three regression suites are **byte-identical** to their pre-plan state. Extracted from `HEAD~3` and from `HEAD` and diffed directly:

| Suite | Result |
|---|---|
| `it('SYSTEMIC …')` cases in *loop-guard + skip-on-failure* (48 lines) | **IDENTICAL** |
| *player resilience — synchronous audio.error storm is bounded* (129 lines) | **IDENTICAL** |
| *player single audio.src authority — re-drive brake* (48 lines) | **IDENTICAL** |
| `src/lib/services/api-base.test.ts` | **0 diff lines** |

`git diff --stat HEAD~3 HEAD` on the two touched files: **509 insertions, 35 deletions**. Every one of the 35 deleted lines is inside the *delayed re-resolve* and *strike counter* suites, and every one is a mechanical literal-to-`Player_STRIKE_CAP` substitution or the drive-loop restructuring that substitution required (`badCalls <= 2` → `<= Player_STRIKE_CAP`, `toBe(2)` → `toBe(Player_STRIKE_CAP)`, two hand-unrolled `await prefetch()` pairs → a `for` loop bounded by the constant). No assertion changed meaning; the walks now reach the cap by construction rather than by coincidence.

`grep -cE '^[^/*]*this\.haltRunawayRecovery\(\)'` → **3 before, 3 after** (no new STOP). `tripLoopGuard` mentions → **4 before, 4 after**, all pre-existing comments; not reintroduced.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — log hygiene] `clearAllStrikes` early-returns when there is nothing to refund**
- **Found during:** Task 1
- **Issue:** The plan specified an unconditional `logAction('strike.clear-all', …)`. `visibilitychange` fires on every tab switch, so the common case (no strikes accumulated) would have written a `strike.clear-all { n: 0 }` entry to the Activity log every time the user foregrounded the app — flooding the exact diagnostic channel the phase relies on.
- **Fix:** `if (this.unplayableStrikes.size === 0) return;` before the log. Behaviour for a non-empty budget is exactly as specified.
- **Files:** `src/lib/stores/player.svelte.ts`
- **Commit:** `00d5807`

**2. [Design detail] The cross-source retry is skipped for the currently-playing uid via an explicit guard**
- **Found during:** Task 2
- **Issue:** The plan required "the cross-source retry never runs for the currently-playing track's error path". `handleDefinitiveFailure` is only reachable from the prefetch walk today, so that holds implicitly — but implicitly is not testable, and a future caller would silently violate it.
- **Fix:** An explicit `uid !== this.current?.uid` clause in the guard, plus a test that calls `handleDefinitiveFailure(current.uid)` directly and asserts `tryFallback` was never called. Zero behaviour change on the live paths.
- **Files:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
- **Commit:** `5167c56`

**3. [Rule 3 — blocking] The plan's `-t "systemic"` verify command matches nothing**
- **Found during:** Task 1 verification
- **Issue:** Vitest's `-t` filter is case-sensitive and the suite is named `SYSTEMIC STOP …`, so `-t "systemic"` reports "209 skipped" — a green-looking run that asserted nothing. `expect: { requireAssertions: true }` does not catch a fully-skipped file.
- **Fix:** Used `-t "SYSTEMIC"` throughout (matching what 31-01 used). Recorded here so the next reader does not trust a skipped run.
- **Commit:** n/a (verification procedure)

### Assumption Drift (advisory)

**1. The plan's line numbers were pre-31-01**
- **Planned:** error-ceiling skip at `:1689`, `bg-error-skip` at `:1735-1746`, second-stall skip at `~:1125`, `STRIKE_CAP` at `:830`.
- **Actual:** 31-01 inserted the ~55-line corrupt-blob branch into the same `audio.error` handler and other state above it, shifting everything down (`STRIKE_CAP` → `:864`, ceiling skip → `~:1735`, `bg-error-skip` → `~:1955`). Sites were located by structure (`grep`) rather than by line.
- **Why it matters:** Only for anyone re-reading the plan against the file. All three named sites were found and are the ones the plan describes.

**2. `bg-error-skip` no longer follows the error ceiling — it subsumed it**
- **Planned:** the plan (via RESEARCH) frames `bg-error-skip` as a sibling of the ceiling path that simply forgot to increment `failoverSkips`.
- **Actual:** the in-code post-mortem records that this branch *replaced* an older post-cap bg skip (`debug-bg-no-pill-split-play-stop`, Option B) and now fires on the FIRST hidden error, before any ceiling accounting. Its non-increment is therefore not an oversight at all — it is the design.
- **Why it matters:** it strengthens rather than weakens the plan's instruction to leave it alone; the comment written at the site says so in those terms.

## Verification

| Check | Result |
|---|---|
| `npx vitest --run src/lib/stores/player.svelte.test.ts` | **218 passed** (was 209 at plan start, 204 after 31-01 — +14 additions, 0 removals) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "SYSTEMIC"` | 2 passed, suite unmodified (D-17) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "strike"` | 16 passed |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "cross-source"` | 5 passed (all five behaviors) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "skip"` | 31 passed |
| `npx vitest --run src/lib/services/api-base.test.ts` | 12 passed, 0 diff lines (D-17) |
| `pnpm test` | **94 files, 1694 tests passed** |
| `pnpm check` | **0 errors, 0 warnings** (4378 files) |
| `git diff HEAD~3 HEAD -- wrangler.jsonc package.json pnpm-lock.yaml` | **empty** |
| `grep -n 'STRIKE_CAP = 3' src/lib/stores/player.svelte.ts` | matches (`:876`) |
| `grep -c 'Player_STRIKE_CAP' src/lib/stores/player.svelte.test.ts` | 12 (declaration + 11 use sites) |
| `grep -c 'emitSkipNotice' src/lib/stores/player.svelte.ts` | 8 (was 3) — definition + `handleTotalFailure` + 2 new feeders + comments |
| actual `this.haltRunawayRecovery()` calls | 3 before, 3 after — no new STOP |
| `grep -c 'tripLoopGuard'` | 4 before, 4 after — comments only, not reintroduced |

**Manual read confirmed:** the `visibilitychange` foreground branch contains no `play(` call — it contains exactly one statement, `this.clearAllStrikes('foreground')`.

**Not verified (manual-only, per 31-VALIDATION.md):** whether the raised cap *feels* better on a real degraded network; on-device background/lock-screen behaviour of the bg-skip path; the skip toast's visual batching feel. All three are device- and subjectivity-bound and have no node harness.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, or schema surface. The one new outbound path (`tryFallback` from the prefetch walk) routes through `searchAll`/`ensureTrackDetails` → `apiFetch`, inheriting the concurrency cap, GET dedupe and circuit breaker (T-31-02-02), and is bounded by the pre-existing per-episode attempted set (T-31-02-01).

## Self-Check: PASSED

- `src/lib/stores/player.svelte.ts` — FOUND
- `src/lib/stores/player.svelte.test.ts` — FOUND
- `.planning/phases/31-faster-smoother-playback-cut-click-to-play-latency-and-stop-/31-02-SUMMARY.md` — FOUND
- commit `00d5807` — FOUND
- commit `5167c56` — FOUND
- commit `567000a` — FOUND
