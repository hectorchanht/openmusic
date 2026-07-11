---
phase: 26-minimal-api-click-to-play-redesign
plan: 01
subsystem: sources/services
tags: [kuwo-first, resolve-floor, fallback, name-stub, lazy-resolve, crossSourceLyric, minimal-api, svelte5, vitest, tdd]

# Dependency graph
requires: []
provides:
  - src/lib/sources/registry.ts — kuwo-first SOURCES enumeration (kuwo,qq,netease,joox,fivesing,jamendo,audius) driving getEnabledAdapters + fallbackOrder + interleave order
  - src/lib/services/catalog.ts resolveNameStub(artist,title,signal) — kuwo-first single-source resolver for sourceless name-only stubs; never-throw, AbortSignal-honoring
  - src/lib/services/catalog.ts ensureTrackDetails — routes a Track.resolveByName stub through resolveNameStub (no dispatch on placeholder source)
  - src/lib/services/catalog.ts crossSourceLyric — bounded single-source kuwo-first lyric walk (no all-source fan-out)
  - src/lib/sources/types.ts Track.resolveByName? marker (additive/optional)
affects: [resolve-floor, cross-source-failover, up-next-lazy-resolve, lyric-fallback, api-call-reduction]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Registry ORDER is the resolve floor (D-08 / POLICY.md): kuwo-first SOURCES literal is inherited by getEnabledAdapters, fallbackOrder, interleave, resolveNameStub, and crossSourceLyric — no consumer names a source"
    - "Single-source walk (onlySource prefs): resolveNameStub + crossSourceLyric step through the kuwo-first order ONE source per searchAll, stop at the first hit — never an all-enabled 7-source fan-out"
    - "onlySource duplicated in catalog.ts (mirrors fallback.ts) to avoid a catalog<->fallback import cycle — fallback.ts imports searchAll/ensureTrackDetails FROM catalog"
    - "WR-06 identity gate reused: resolveNameStub adopts a candidate only when sameSongKey matches {artist,title} (a fuzzy upstream search can return a different track)"
    - "Additive/optional Track marker (resolveByName?) mirrors the Phase-8 Last.fm enrichment fields — no construction or serialize path changes"

key-files:
  created: []
  modified:
    - src/lib/sources/registry.ts
    - src/lib/services/fallback.ts
    - src/lib/sources/types.ts
    - src/lib/services/catalog.ts
    - src/lib/sources/registry.test.ts
    - src/lib/services/fallback.test.ts
    - src/lib/services/catalog.test.ts

key-decisions:
  - "Registry reorder is DATA-ONLY: SourceId union, adapter contracts, enabledByDefault flags, and dedupe's separate SOURCE_RANK tie-break are all UNCHANGED — only the resolve/fallback/interleave order moves (kuwo-first)"
  - "resolveNameStub null return falls through by returning the UNRESOLVED stub (audioUrl-less) — the caller (player.play) routes it to the existing error/fallback path; we never dispatch SOURCES[placeholder].resolve on a name-stub (never-throw)"
  - "crossSourceLyric bound reinterpreted as at-most-one-resolve PER STEP while walking kuwo-first until an lrc is found (plan action: 'stop at the first candidate that yields an lrc') — still single-source, still never a fan-out"
  - "fallbackOrder preferred-source hoist preserved: an explicit user settings.preferredSource still wins first over the kuwo default"

requirements-completed: [RESOLVE-01, RESOLVE-02]

# Metrics
duration: 11min
completed: 2026-07-11
---

# Phase 26 Plan 01: Kuwo-First Resolve Floor + Single-Source Name-Stub Resolver Summary

**Establishes the kuwo-first resolve FLOOR the rest of Phase 26 stands on: the source registry is reordered so cross-source failover, search interleave, and lazy resolution all walk `kuwo → qq → netease → joox → (fivesing → jamendo → audius)`, and a new `resolveNameStub` resolves sourceless name-only stubs (Plan 26-03's Up-Next shape) through ONE source at a time — plus `crossSourceLyric` is reworked from an all-enabled 7-source fan-out to a bounded single-source kuwo-first walk. Green typecheck + full suite (only the pre-existing deferred `searchHistory` SSR-guard failure remains).**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-11T09:56:26Z
- **Completed:** 2026-07-11T10:07Z
- **Tasks:** 2 of 2 (Task 1 autonomous; Task 2 TDD RED→GREEN, REFACTOR not needed)
- **Files:** 0 created, 7 modified

## Accomplishments

- **Task 1 (RESOLVE-01 — kuwo-first registry):** Reordered the `SOURCES` object literal in `registry.ts` to `{ kuwo, qq, netease, joox, fivesing, jamendo, audius }`. Because `getEnabledAdapters` walks `Object.values(SOURCES)`, this single change propagates to every consumer:
  - `fallbackOrder` (fallback.ts) now yields kuwo-first by default; the explicit-`preferred` hoist (user `settings.preferredSource`) is preserved and still wins.
  - `interleave` (catalog.ts) round-robins in the kuwo-first order.
  - Added a load-bearing comment to both `registry.ts` and `fallbackOrder` documenting the order-inheritance and that no consumer names a source.
  - Left the `SourceId` union, adapter contracts, `enabledByDefault` flags, and dedupe's separate `SOURCE_RANK` (variant tie-break, not the resolve floor) untouched.
- **Task 2 (RESOLVE-02 — name-stub resolver + bounded lyric fallback), TDD:**
  - **RED** (`646ee52`): 7 new failing tests (kuwo-only happy path, kuwo-miss→qq walk, null-on-total-miss, aborted-signal, WR-06 mismatch-rejection, ensureTrackDetails routing, single-source crossSourceLyric) + the `Track.resolveByName?` marker + a null `resolveNameStub` scaffold.
  - **GREEN** (`37ff7a8`): implemented `resolveNameStub` (kuwo-first walk, `onlySource` single-source `searchAll` per step, `dedupeBest` + `sameSongKey` WR-06 gate, `ensureTrackDetails`, return the first playable hit; never-throw, AbortSignal-honoring); added the `ensureTrackDetails` `resolveByName` branch (delegates to `resolveNameStub`, returns the unresolved stub on null — no placeholder dispatch); reworked `crossSourceLyric` from an all-enabled `searchAll` fan-out to a bounded single-source kuwo-first walk (skips own source + `LYRICLESS_SOURCES`, one resolve per step, stop at first lrc).
  - **REFACTOR:** none needed — no commit.

## Verification

- `pnpm check` — 0 errors, 0 warnings (4312 files).
- `pnpm test -- src/lib/services/fallback.test.ts src/lib/services/catalog.test.ts src/lib/sources/registry.test.ts` — 39 passed.
- Full `pnpm test` — 1118 passed, 1 failed (the pre-existing, deferred `searchHistory.svelte.test.ts` SSR-guard failure only; see Deviations).
- Grep verification: both resolve-path `searchAll` calls (`resolveNameStub` L259, `crossSourceLyric` L358) use `onlySource(src)` — the only bare `searchAll(` is the search-page fan-out definition. No all-source fan-out on any resolve path.
- `fallbackOrder('netease', undefined, new Set())[0] === 'kuwo'`; `fallbackOrder('kuwo', 'qq', ...)[0] === 'qq'` (asserted in fallback.test.ts).

## TDD Gate Compliance

- RED gate: `646ee52` `test(26-01): failing tests …` (7 tests, 4 behavioral tests failing as expected; existing suite intact).
- GREEN gate: `37ff7a8` `feat(26-01): kuwo-first name-stub resolver …` (all 29 catalog tests green).
- Fail-fast honored: after strengthening the routing test to assert the resolver actually searches (not a masked pass from the mocked `kuwo.resolve`), exactly the 4 new behavioral tests failed in RED before any implementation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated `registry.test.ts` order assertion broken by the reorder**
- **Found during:** Task 1 (full-suite run)
- **Issue:** `registry.test.ts` hard-codes `EXPECTED_KEYS` and asserts `Object.keys(SOURCES)` order (netease-first). The kuwo-first reorder broke it. This file was NOT in the plan's Task-1 `<files>` list (which named only fallback.test.ts + catalog.test.ts), but the acceptance criterion requires `pnpm test` green.
- **Fix:** Updated `EXPECTED_KEYS` and the test name to the kuwo-first order; added a comment noting the order is now load-bearing.
- **Files modified:** src/lib/sources/registry.test.ts
- **Commit:** 9aa5e22

**2. [Rule 2 - Robustness] Strengthened the name-stub routing test**
- **Found during:** Task 2 RED
- **Issue:** The initial routing test passed in RED for the wrong reason — the mocked `kuwo.resolve` returned `kuwo:k1` regardless of input, so a missing routing branch was masked.
- **Fix:** Added `expect(SOURCES.kuwo.search).toHaveBeenCalledOnce()` — only the `resolveNameStub` path searches, so the test now genuinely fails without the branch (true RED) and proves routing in GREEN.
- **Files modified:** src/lib/services/catalog.test.ts
- **Commit:** 646ee52

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails in isolation with zero Phase-26 code involved (Node 22+ exposes `globalThis.localStorage`, so the assertion `typeof globalThis.localStorage === 'undefined'` no longer holds). Already documented in `.planning/phases/25-.../deferred-items.md`. Unrelated to the registry reorder or the catalog changes — not fixed per the scope boundary.

## Known Stubs

None. `resolveNameStub` is a fully wired resolver (not a placeholder); the `Track.resolveByName` marker is additive and consumed by the new `ensureTrackDetails` branch. Plan 26-03 will emit `resolveByName` stubs — this plan provides the resolution machinery for them.

## Notes for Next Plan

- The kuwo-first floor + `resolveNameStub` + `resolveByName` marker are the structural precondition for the phase's ~59→~3 API-call reduction. Plan 26-03 (Up-Next via `track.getSimilar`) should construct lightweight stubs with `resolveByName: true` (source/songid are placeholders, never dispatched) and rely on `ensureTrackDetails` to resolve them lazily kuwo-first on play.
- Cover-on-the-hot-path (bind to the resolved `.cover` inline, lazy Deezer HQ upgrade) is a separate plan — not touched here.

## Self-Check: PASSED

- All 7 modified files present on disk.
- All 4 commits (9aa5e22 refactor, 646ee52 test/RED, 37ff7a8 feat/GREEN, d9998bf docs) present in git history.
