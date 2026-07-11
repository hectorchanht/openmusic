---
phase: 26-minimal-api-click-to-play-redesign
plan: 11
subsystem: sources/joox
gap_closure: true
gap: 6
tags: [joox, resolve, identity, self-heal, never-throw, version-picker, fallback]
requires:
  - "player.play() `!resolved.audioUrl → runFallback → skip` path (26-06 gap-1 hardening)"
  - "catalog.ensureTrackDetails() (un-wrapped adapter.resolve caller)"
provides:
  - "joox.resolve songmid-located self-heal of the fragile n-index on a would-be identity mismatch"
  - "joox.resolve graceful never-throw UNRESOLVED return (audioUrl=null, detailsLoaded=false) on an unrecoverable mismatch (replaces the STRONG-DISJOINT throw)"
affects:
  - "version picker (26-08): picking a JOOX variant now plays the exact song when locatable, else fails soft into fallback/skip — never a stuck nowbar error"
tech-stack:
  added: []
  patterns:
    - "never-throw service (return-a-sentinel): joox.resolve now degrades a genuine identity mismatch to a failed-resolve sentinel instead of throwing"
    - "prefer the stable identity (songmid) over the fragile positional index (n): one bounded re-search re-derives the correct n"
    - "AbortSignal threaded through the self-heal re-search + corrected detail fetch (supersedence preserved)"
key-files:
  created:
    - ".planning/phases/26-minimal-api-click-to-play-redesign/26-11-SUMMARY.md"
  modified:
    - "src/lib/sources/joox.ts"
    - "src/lib/sources/joox.test.ts"
decisions:
  - "The STRONG-DISJOINT throw in joox.resolve is replaced by a songmid self-heal + graceful never-throw UNRESOLVED return; wrong-song protection is preserved (the wrong song is never enriched)."
  - "The self-heal re-search is a NEVER-THROW helper (returns [] on drift/network/abort) so a self-heal only ever fails soft into player.play's runFallback/skip path."
  - "The corrected-detail fetch does NOT swallow apiFetch rejections (abort/network still propagate) so AbortSignal supersedence is preserved; only an invalid body (code!=200/no data) is a graceful miss."
  - "Self-heal is bounded: at most ONE extra /api/joox/search + ONE corrected /api/joox/detail, only on the disjoint branch, no recursion; correctedN==n is treated as no-new-information → graceful fail."
metrics:
  duration: ~8 min
  tasks: 2
  files: 2
  completed: 2026-07-12
---

# Phase 26 Plan 11: JOOX Identity Self-Heal / Never-Throw Resolve Summary

Picking a JOOX variant whose stale positional `n` no longer maps to its songmid now SELF-HEALS by re-locating the intended song via its stable songmid (one bounded re-search → corrected `n` → re-fetch → re-validate), playing the exact song; if it cannot be verified even after the self-heal, `joox.resolve` returns the track UNRESOLVED (audioUrl=null) and NEVER throws — routing into player.play's existing `runFallback → skip` path instead of stranding the nowbar with a stuck identity-mismatch error.

## What Was Built

### Task 1 — Self-heal + graceful never-throw resolve (`joox.ts` + `joox.test.ts`)
- Replaced ONLY the `if (strongDisjoint) { throw … }` branch in `joox.resolve()` with a songmid-located self-heal followed by a graceful never-throw fail:
  - **CONFIRMED fast path** (n maps correctly, cross-field allowed): enriches + plays as before, with **zero** re-search calls. Unchanged.
  - **SOFT-ALLOW** (partial/unconfirmed, not strong-disjoint): `console.warn` + play through. Unchanged.
  - **WOULD-BE STRONG-DISJOINT**: issue ONE `/api/joox/search?msg=<keyword>`, find the FIRST item whose `songmid`/`歌曲ID` matches any expected token (cross-field), derive `correctedN = idx+1`; if `correctedN !== n`, re-fetch `/api/joox/detail?n=<correctedN>` and re-validate. If it now confirms → enrich from the corrected body + play the **correct** song. Otherwise (song gone, corrected detail still disjoint, or `correctedN === n`) → set `track.audioUrl = null; track.detailsLoaded = false;` and `return track` WITHOUT adopting any wrong-song field; `console.warn` the diagnostic (original n, correctedN, expected/returned songmid+歌曲ID). NEVER throws.
- Factored small helpers (no logic duplication between the initial and corrected identity checks): `jooxExpectedTokens`, `jooxReturnedTokens`, `jooxSearchItemTokens`, `jooxIdentityConfirmed`, plus never-throw `fetchJooxSearchSongs` and null-on-invalid `fetchJooxDetailData`.
- The client still sends `n=` on the initial detail call; `search()`'s contract-drift throw and the initial-detail invalid-response throw are untouched; `pickJooxPlayUrl` + every AbortSignal thread preserved.
- Tests: added `mockSelfHealFetch` (routes `/api/joox/search` vs per-n `/api/joox/detail`); rewrote test 3c to the self-heal contract; added an unrecoverable-mismatch test; added a first-try-confirm ZERO-re-search assertion.

### Task 2 — Regression proof (`joox.test.ts`)
- Added a describe block that (1) characterizes the graceful failed-resolve sentinel player.play consumes — same track object, `audioUrl=null`, `detailsLoaded=false`, no wrong-song field adopted — and (2) asserts the self-heal is bounded: ≤1 (exactly 1) `/api/joox/search` on the disjoint path and 0 on a confirmed resolve.

## Deviations from Plan

None — plan executed exactly as written. Rules 1–4 not triggered; no auth gates.

## TDD Gate Compliance

Per-task RED→GREEN cadence followed:
- `test(26-11)` RED commit `b964a39` — new self-heal + graceful tests failing against the old throwing code (2 failing / 11 passing, confirmed).
- `feat(26-11)` GREEN commit `6ea42c7` — implementation; all 13 tests green.
- `test(26-11)` regression commit `23652eb` — Task 2 bounded/sentinel proofs; 16 tests green.

## Verification

- `pnpm test -- src/lib/sources/joox.test.ts`: **16 passed**.
- `pnpm test` (full suite): **1197 passed, 1 failed** — the failure is the pre-existing, deferred `searchHistory.svelte.test.ts` SSR-guard test (explicitly named as acceptable in the plan's verification), unrelated to this change.
- `pnpm check`: my two files are type-clean (no `as any`, tabs, single quotes). The one reported error — `swipeLike` in `src/routes/(app)/album/[name]/+page.svelte` — is a pre-existing error from a concurrent session, NOT introduced here.

## Known Stubs

None. `track.audioUrl = null` on the unrecoverable-mismatch path is a deliberate, documented failed-resolve sentinel (the contract player.play keys on), not a UI-facing stub.

## Doc-bookkeeping deferred (concurrency)

STATE.md and ROADMAP.md were intentionally NOT staged/committed by this executor. A concurrent session had uncommitted WIP on `.planning/STATE.md` at execution time (the working-tree copy had even regressed the committed 26-08 progress to 26-07); `git add`-ing it would have cross-contaminated the other session's work (the documented shared-worktree collision hazard). Per the scoping instruction, this executor committed only its own files (`src/lib/sources/joox.ts`, `src/lib/sources/joox.test.ts`) and this SUMMARY. The orchestrator should reconcile STATE.md (Current Position → 26-11 complete, gap 6) and ROADMAP.md plan-progress for phase 26, and mark requirements VERSIONS-01 / RESOLVE-02.

## Threat Model Outcome

- **T-26-11-01 (Spoofing — wrong song for a stale n):** mitigated — the wrong song is never enriched; self-heal re-locates by stable songmid, else the track stays unresolved.
- **T-26-11-02 (DoS — stuck nowbar on a version-pick throw):** mitigated — the throw is replaced by a graceful `audioUrl=null` return that routes into runFallback → skip.
- **T-26-11-03 (DoS — self-heal fan-out/loop):** mitigated — bounded to one re-search + at most one corrected detail, disjoint branch only, no recursion (asserted by Task 2).

No new threat surface: the self-heal reuses the existing `/api/joox/search` endpoint; no new network endpoint, auth path, or trust boundary introduced.

## Self-Check: PASSED

- `src/lib/sources/joox.ts` — FOUND
- `src/lib/sources/joox.test.ts` — FOUND
- Commit `b964a39` (test RED) — FOUND
- Commit `6ea42c7` (feat GREEN) — FOUND
- Commit `23652eb` (test regression) — FOUND
