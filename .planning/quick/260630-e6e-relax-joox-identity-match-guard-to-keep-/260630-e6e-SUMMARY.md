---
phase: quick-260630-e6e
plan: 01
subsystem: sources/joox
tags: [joox, identity-guard, resilience, playback]
requires: []
provides:
  - "Cross-field token-match JOOX identity guard with soft-allow + narrow strong-disjoint refuse"
affects:
  - src/lib/sources/joox.ts
  - src/lib/sources/joox.test.ts
tech-stack:
  added: []
  patterns:
    - "Token-pool cross-field identity match (expected pool vs returned pool, any-overlap = confirm)"
    - "Soft-allow (console.warn, no throw) for partial/unconfirmed identity; throw only on strong-disjoint"
key-files:
  created: []
  modified:
    - src/lib/sources/joox.ts
    - src/lib/sources/joox.test.ts
decisions:
  - "Strong-disjoint = expected has BOTH mid+songId AND returned has BOTH songmid+歌曲ID, evaluated inside the !confirmed branch (zero cross-field overlap already guaranteed there)."
  - "Soft-allow reuses the same expected-vs-returned diagnostic string as the throw, emitted via console.warn so missing matches are observable without blocking playback."
metrics:
  duration: 6 min
  completed: 2026-06-30
---

# Phase quick-260630-e6e Plan 01: Relax JOOX Identity Match Guard Summary

Relaxed the JOOX `resolve()` identity guard to a cross-field token match with soft-allow, so upstream songmid/歌曲ID field swaps (the 有人 case) and partial/unconfirmed identities keep playing, while genuinely different fully-populated songs still throw.

## What Was Done

- **Task 1 — guard rewrite (`src/lib/sources/joox.ts`):** Replaced the same-field comparison (`expectedMid === returnedMid`, `expectedSongId === returnedSongId`) with two token pools:
  - EXPECTED = non-empty `[track.songMid, track.jooxSongMid, track.jooxSongId, track.songid]`
  - RETURNED = non-empty `[d.songmid, d['歌曲ID']]`
  - `confirmed` = any expected token equals any returned token (CROSS-FIELD allowed). On confirm → fall through to enrichment unchanged.
  - If not confirmed: **strong-disjoint** (expected has both a mid and a songId AND returned has both songmid and 歌曲ID — zero cross-field overlap already implied by being in the `!confirmed` branch) → throw the descriptive "refusing to play the wrong song" message, leaving `detailsLoaded` false. Otherwise → **soft-allow**: `console.warn` with the same diagnostic detail and fall through to play.
  - Enrichment block below the guard (`pickJooxPlayUrl`, title/artist/album/audioUrl/lrc assignments, quality tagging, `detailsLoaded = true`, return) left byte-unchanged.
- **Task 2 — tests (`src/lib/sources/joox.test.ts`):** Kept happy-path Test 2. Added a cross-field (有人) test where the detail returns the target's expected 歌曲ID as its `songmid` (asserts resolves, `detailsLoaded` true, `audioUrl` truthy). Added a soft-allow test with a partial-identity track (only `songid` set; songMid/jooxSongMid/jooxSongId cleared) against a non-matching detail body, spying on `console.warn` (asserts warn fired, resolves, no throw). Renamed the old mismatch test to strong-disjoint and confirmed it still throws + `detailsLoaded` false. Left the `n=` and quality-order tests untouched.
- **Task 3 — typecheck:** `pnpm check` clean (0 errors / 0 warnings).

## Verification

- `npx vitest --run src/lib/sources/joox.test.ts` → **11 tests passed** (was 9; +2 new identity tests). Confirmed by verbose reporter: happy-path match, cross-field swap, soft-allow (console.warn, no throw), strong-disjoint throw, and `n=` all green.
- Full suite `npx vitest --run` → **949 tests passed (66 files)**, no regressions.
- `pnpm check` → 4291 files, 0 errors, 0 warnings.

## Deviations from Plan

None — plan executed exactly as written. The plan's "zero cross-field overlap" precondition for strong-disjoint is satisfied structurally by evaluating it inside the `!confirmed` branch (where overlap is already zero), so `strongDisjoint = expectedHasBoth && returnedHasBoth` is sufficient; this is noted inline in the code comment.

## Commits

- `a45a9d0` fix(quick-260630-e6e-01): relax JOOX identity guard — cross-field match + soft-allow
- `a959bb1` test(quick-260630-e6e-02): cover new JOOX identity semantics

## Self-Check: PASSED

- FOUND: src/lib/sources/joox.ts (modified)
- FOUND: src/lib/sources/joox.test.ts (modified)
- FOUND commit: a45a9d0
- FOUND commit: a959bb1
