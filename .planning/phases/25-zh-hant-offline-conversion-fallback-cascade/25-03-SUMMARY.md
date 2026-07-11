---
phase: 25-zh-hant-offline-conversion-fallback-cascade
plan: 03
subsystem: services
tags: [i18n, translation, zh-hant, offline, choke-point, cache-version, svelte5, vitest]

# Dependency graph
requires:
  - phase: 25-01
    provides: src/lib/services/zh-convert.ts — s2tConvertLines + isChineseLine (lazy, never-throw)
provides:
  - src/lib/services/translate.ts translateLinesEx — zh-Hant offline routing (Chinese lines convert client-side, only non-Chinese remainder hits /api/translate) + CACHE_VER v3
  - shared runApiLoop helper (retry/best-result) reused by the API path and the zh-Hant API-subset
affects: [translation-choke-point, zh-hant-target, lyrics-offline, names-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Choke-point interception (D-02): translateLinesEx branches to resolveZhHant only when to === 'zh-Hant'; every other target is byte-identical (full lines → runApiLoop, no offline branch, no zh-convert import)"
    - "Index-partition + scatter-back: chineseIdx (offline s2t) / apiIdx (network) results placed back at ORIGINAL positions so out.length === lines.length is preserved (T-25b-01)"
    - "Dynamic import('./zh-convert') lives ONLY inside resolveZhHant — the ~72 KB dict chunk stays out of the initial bundle AND out of every non-zh-Hant path (D-03)"
    - "Never-throw offline branch: a failed dynamic import falls through to the full-API path (runApiLoop) so zh-Hant never hard-breaks (T-25b-03)"

key-files:
  created: []
  modified:
    - src/lib/services/translate.ts
    - src/lib/services/translate.test.ts

key-decisions:
  - "D-02: offline routing intercepted in the single translateLinesEx choke point — zero caller changes (names.svelte.ts, NowPlaying.svelte untouched)"
  - "D-04 verified end-to-end: isChineseLine rides the kana/hangul-first detectLang, so a JA-kana line under zh-Hant lands in the API-bound subset, never offline-converted"
  - "CACHE_VER v2→v3: zh-Hant output is now deterministic offline, so pre-version API-echoed Traditional entries are abandoned (purgeStaleLyricsCache auto-purges non-current keys — no new purge code)"
  - "Blank lines belong to NEITHER partition bucket (trivially complete, non-blocking) so all-Chinese lyrics with blank separator lines make ZERO network calls (deviation from the plan's literal 'blanks → apiIdx')"

requirements-completed: [D-02, D-04]

# Metrics
duration: 5min
completed: 2026-07-11
---

# Phase 25 Plan 03: zh-Hant Offline Routing in the translateLinesEx Choke Point Summary

**Wires the Plan-01 s2t converter into the single translation choke point `translateLinesEx()` (D-02): when `to === 'zh-Hant'`, Chinese-detected lines are converted client-side (zero network) and only the genuinely non-Chinese remainder is sent to `/api/translate`, with `out`/`flags`/`complete` alignment intact, `CACHE_VER` bumped v2→v3 to abandon API-echoed Traditional, and the D-04 JA-kana guard proven end-to-end — all with ZERO changes to the two callers.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-11T09:14:29Z
- **Completed:** 2026-07-11T09:19Z
- **Tasks:** 2 of 2 (both autonomous; Task 1 TDD-wired against the existing + extended suite)
- **Files:** 0 created, 2 modified (translate.ts, translate.test.ts)

## Accomplishments

- **Task 1 (offline routing, D-02/D-04):** Added a `to === 'zh-Hant'` branch to `translateLinesEx` that delegates to a new `resolveZhHant(lines)`:
  - Dynamically `import('./zh-convert')` (lazy — no dict in the initial bundle or any non-zh-Hant path); on import failure, falls through to the full-API path (never-throw, T-25b-03).
  - Partitions line INDICES: `chineseIdx` (where `isChineseLine` is true) → offline `s2tConvertLines`, flagged genuinely-translated; `apiIdx` (non-Chinese, non-blank) → the API retry loop. Blank lines belong to neither bucket (trivially complete, non-blocking).
  - Scatters both result sets back to their ORIGINAL positions, preserving `out.length === lines.length` (T-25b-01).
  - `complete` uses the same rule as before (every non-blank line flagged), so an incomplete API remainder keeps `complete:false` even when the offline lines are correct.
  - Extracted the existing retry/best-result loop into a shared `runApiLoop(lines, to)` used by BOTH the non-zh-Hant path and the zh-Hant API-subset — a single cache path, no fork.
  - Bumped `CACHE_VER` `'v2' → 'v3'`; `purgeStaleLyricsCache()` already drops every non-current-version key, so the bump auto-purges API-echoed Traditional (T-25b-02).
- **Task 2 (tests):** Added a new `describe` block for the offline path — all-Chinese batch makes ZERO `fetchMock` calls + caches a `v3` key; mixed batch sends ONLY the non-Chinese line (asserted on the POST body) while `out` stays aligned; a JA-kana line IS sent to the API (D-04); a non-zh-Hant target sends the full batch. Bumped every `openmusic:lyrics-tr:v2:` assertion to `v3:`. Retargeted two API-contract tests to kana input (see Deviations).

## Task Commits

1. **Task 1: route zh-Hant Chinese lines through offline s2t + v3 bump** — `26ebac0` (feat)
2. **Task 2: offline-routing tests + v3 cache-key bump** — `5b48e74` (test)

## Files Created/Modified

- `src/lib/services/translate.ts` (modified) — `resolveZhHant` offline branch, shared `runApiLoop`, `CACHE_VER` v3.
- `src/lib/services/translate.test.ts` (modified) — new zh-Hant offline `describe` block + v3 assertions + kana-retargeted contract tests.

## Decisions Made

- **Single cache path:** reused the existing key (`openmusic:lyrics-tr:${CACHE_VER}:${to}:${hash}`) + mem/localStorage read + complete-gated write; the zh-Hant branch only produces the `TranslateResult` — caching stays in `translateLinesEx`, no second path (plan point 5).
- **Blank lines make no network call** (deviation, below) — real Chinese lyrics use blank separator lines, and the phase goal is offline lyrics on lockscreen; a blank forcing an API call would defeat that.
- **CACHE_VER bumped** per the D-02/D-04 discretion note (YES bump) since zh-Hant output is now deterministic offline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] Blank lines excluded from the API-bound subset (offline-first for real lyrics)**
- **Found during:** Task 1.
- **Issue:** The plan's partition text (point 1) put "blanks that are non-Chinese" into `apiIdx`, which would send a blank line to `/api/translate`. Real zh-Hant lyrics are Chinese lines separated by BLANK lines — routing those blanks to the network would make an all-Chinese-with-separators lyric batch hit the API, contradicting the behavior bullet "all lines Chinese → ZERO calls" and the phase's offline-on-lockscreen goal.
- **Fix:** A blank line belongs to NEITHER bucket — it stays blank, flags false, and is exempt from `complete` (the existing blank rule). So a Chinese-lyrics batch with blank separators makes ZERO network calls. Output and alignment are unchanged (a blank always "translates" to itself).
- **Files modified:** src/lib/services/translate.ts
- **Verification:** existing "treats blank lines as not blocking" test passes (now with no fetch); `out.length === lines.length` preserved.
- **Committed in:** `26ebac0`

**2. [Rule 1 - Test correctness] Retargeted two block-1 contract tests from Chinese to kana input under zh-Hant**
- **Found during:** Task 2.
- **Issue:** Plan Task 2 said "adjust only the version-string literals" for the existing suite, but two tests (`does NOT persist when any non-blank line fell back`, `infers per-line flags when the server omits them`) used CHINESE input under `zh-Hant` and mocked the API to return an echo/partial. Those Chinese lines now convert OFFLINE (complete + genuine), so the tests could no longer exercise the API echo/inference cache gate they assert on — they would fail (offline makes them complete). The planner's "version-literals-only" assumption did not hold for Chinese-under-zh-Hant inputs.
- **Fix:** Changed both tests' input to JA-kana lines (`['さくら', ...]`) which are API-bound under zh-Hant (D-04), so they still validate the exact same API echo/fallback + flag-inference cache gate. Every other block-1 test kept its Chinese input and now passes via the offline path with only the v2→v3 literal update.
- **Files modified:** src/lib/services/translate.test.ts
- **Verification:** `pnpm test -- src/lib/services/translate.test.ts` → 16/16 green.
- **Committed in:** `5b48e74`

---

**Total deviations:** 2 auto-fixed (both Rule 1 correctness — 1 source, 1 test). No architectural changes, no scope creep. Callers (names.svelte.ts, NowPlaying.svelte) required ZERO changes as designed.

## Issues Encountered / Out-of-Scope (Deferred)

- **Pre-existing unrelated test failure:** `src/lib/stores/searchHistory.svelte.test.ts` (Phase 14-01) fails its SSR-guard case (`expect(typeof globalThis.localStorage).toBe('undefined')`) because the toolchain is Node v25, which exposes a native `globalThis.localStorage`. No Phase-25 code involved — already logged to `deferred-items.md` by Plan 01, NOT fixed (scope boundary). Full suite: **1108 passed / 1 pre-existing failure**.
- The tongwen `.js.map` sourcemap warnings during the test run are harmless package artifacts (documented in 25-01) — no effect on results.

## Verification

- `pnpm check` → 0 errors, 0 warnings (4312 files).
- `pnpm test -- src/lib/services/translate.test.ts` → 16/16 green (7 poison-cache + 4 transient-resilience + 4 new offline-routing, with 2 retargeted).
- Full `pnpm test` → 1108 passed / 1 pre-existing unrelated failure (searchHistory Node-v25).
- `grep -n "import(" src/lib/services/translate.ts` → the `./zh-convert` import is dynamic and inside `resolveZhHant` (the zh-Hant branch only).
- `grep -n "v3" src/lib/services/translate.ts` → `CACHE_VER = 'v3'`; no `lyrics-tr:v2` literal remains in the test file.

## Next Phase Readiness

- The offline s2t path is live at the choke point. Plan 02's API provider cascade (Azure → DeepL → Google) operates on the non-Chinese remainder that `resolveZhHant` forwards — the two compose cleanly (offline handles Chinese, the cascade handles the rest).
- No blockers. Both deviations are correctness fixes documented above.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface introduced. The threat register (T-25b-01 alignment, T-25b-02 cache-version, T-25b-03 offline-branch never-throw) is realized and tested; T-25b-04 is the accepted disposition (already-Traditional s2t-passes-through, flagged translated — output correct either way).

## Self-Check: PASSED
- `src/lib/services/translate.ts` — FOUND (resolveZhHant offline branch, runApiLoop, CACHE_VER='v3')
- `src/lib/services/translate.test.ts` — FOUND (new offline-routing describe block, v3 assertions)
- `.planning/phases/25-zh-hant-offline-conversion-fallback-cascade/25-03-SUMMARY.md` — FOUND
- Commits `26ebac0` (feat, Task 1) + `5b48e74` (test, Task 2) — present in git log
- `pnpm check` 0 errors; `pnpm test -- translate.test.ts` 16/16 green

---
*Phase: 25-zh-hant-offline-conversion-fallback-cascade*
*Completed: 2026-07-11*
