---
phase: quick-260926-lw8
plan: 01
subsystem: recommendations (home radio shelf, Up Next radio fallback)
tags: [radio, randomization, seeded-rng, up-next, home]
requires: []
provides:
  - "shuffle(arr, rng) + seededRng(seed) (mulberry32) in services/shuffle.ts"
  - "radio.ts SEED_WINDOW / RADIO_POOL / reseedRadio() + rng-aware pickRadioSeeds / mergeRadio / buildRadio"
  - "buildSimilarQueue optional trailing rng; Deezer radio path iterates a shuffled copy"
  - "home rebuildRadio() with radioGen guard; Randomize reseeds + rebuilds"
affects:
  - src/routes/(app)/+page.svelte (Your Radio shelf)
  - Up Next regenerate / ensureAhead (via buildSimilarQueue radio path, callers unchanged)
tech-stack:
  added: []
  patterns: ["injected rng: () => number for deterministic tests", "module-scope session seed replayed per build", "copy-shuffle over a shared ttl-cache array"]
key-files:
  created: []
  modified:
    - src/lib/services/shuffle.ts
    - src/lib/services/radio.ts
    - src/lib/services/radio.test.ts
    - src/lib/services/similar.ts
    - src/lib/services/similar.test.ts
    - src/routes/(app)/+page.svelte
decisions:
  - "Radio shelf draws come from one module-scope session seed: stable across tab switches, new on relaunch, new on Randomize (reseedRadio)"
  - "Seeds sampled uniformly from the 20 most recent distinct artists; picks shuffled within each seed list's top 30 (ponytail: rank-weighted sampling if tail picks look off-taste)"
  - "Up Next Deezer-radio path shuffles a COPY of the 6h-cached pairs with Math.random per call; Last.fm primary order untouched"
metrics:
  duration: "~6 min"
  completed: 2026-09-26
  tasks: 3
  files: 6
---

# Quick 260926-lw8: Randomize radio generation with a session seed. Summary

The home "Your Radio" shelf now samples 4 seed artists from the 20 most recent distinct artists and shuffles each seed's similar list within its top 30. Every draw uses one mulberry32 session seed, so the shelf stays the same for the whole session, changes on relaunch, and changes when you press Randomize. Up Next's Deezer-radio fallback also walks a shuffled copy of its cached pairs on each regenerate. Neither change adds an upstream call.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | rng-injected shuffle/seededRng + session-seeded radio.ts sampling | 3847ab32 | shuffle.ts, radio.ts, radio.test.ts |
| 2 | Shuffle a copy of the cached Deezer radio pairs per buildSimilarQueue call | c222b414 | similar.ts, similar.test.ts |
| 3 | Home rebuildRadio() with gen guard; Randomize reseeds + rebuilds | 1795c80e | src/routes/(app)/+page.svelte |

## Verification (observed)

- Task 1 RED: `pnpm vitest run src/lib/services/radio.test.ts`, 8 failed / 8 passed (new cases failed, e.g. `reseedRadio is not a function`). GREEN: `radio.test.ts` + `home-charts.test.ts`, 46/46 passed.
- Task 1 done greps: `grep -c "rng" radio.ts` = 12. Non-comment `seededRng(sessionSeed)` count = 1, after rewording one JSDoc line that also matched.
- Task 2 RED: the new case failed at `expect(rotated…).not.toEqual(raw5)`. GREEN: 21/21, stable across 8 repeated runs. Non-comment `shuffle(radioPairs, rng)` count = 1. The `return out; // already match-descending from the route` line is unchanged (line 216).
- Task 3 gate: `pnpm check` gave 0 errors and 1 warning, which is in `NowPlaying.svelte` (not touched here). `pnpm test` gave 154 files / 3444 tests passed. `grep -c "reseedRadio(); rebuildRadio();"` = 1.
- `grep -n "buildSimilarQueue(" src/lib/stores/player.svelte.ts`: both callers (3056, 4470) still use the 3-arg form. `player.svelte.ts` is not modified.
- No deletions in any of the three commits. `.planning/debug/page-switch-lag-tap-dead.md` is still untracked and untouched. Nothing pushed.
- Not verified: the optional manual browser check (Randomize changes tiles, tab switch keeps them, reload redraws) was not run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing exact-order radio-path test became flaky**
- **Found during:** Task 2
- **Issue:** `uses radio when track.getSimilar is dry…` checks the exact order of 2 radio pairs. With the new default `rng = Math.random`, it failed about half the time (seen in 3 of 5 runs).
- **Fix:** pass the identity rng `() => 0.999` in that one call, with a comment tagged quick-260926-lw8. The assertion itself is unchanged.
- **Files modified:** src/lib/services/similar.test.ts
- **Commit:** c222b414

**2. [Rule 3 - Blocking] Done-criteria grep counted a JSDoc line**
- **Found during:** Task 1
- **Issue:** `grep -v '^\s*//' | grep -c "seededRng(sessionSeed)"` returned 2 because the new buildRadio JSDoc (` * …`) named it.
- **Fix:** reworded the JSDoc to "a FRESH seeded rng over the session seed". The count is now 1.
- **Commit:** 3847ab32

### Other notes

- The commit trailer uses `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` from the session attribution reminder, not the `Claude Fable 5.1` string in the plan text.
- The plan expected `src/routes/(app)/library/+page.svelte` to be modified by another session. It was clean when this run started. Only the six planned paths were staged.
- In the radio.test.ts mock of `$lib/services/similar`, `fetchSimilarTracks` returns 3 `mk()` tracks for any artist. This fixture is test-only.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, params or dependencies. T-lw8-01 (cache mutation) is covered by the `rawAgain` assertion. T-lw8-02 (budget) is covered by the `RADIO_SEEDS` call-count assertion.

## Self-Check: PASSED

- FOUND: src/lib/services/shuffle.ts, radio.ts, radio.test.ts, similar.ts, similar.test.ts, src/routes/(app)/+page.svelte
- FOUND commits: 3847ab32, c222b414, 1795c80e
