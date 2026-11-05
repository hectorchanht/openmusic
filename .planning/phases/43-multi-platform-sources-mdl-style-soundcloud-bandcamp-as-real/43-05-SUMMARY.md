---
phase: 43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
plan: 05
subsystem: sources
tags: [source-adapter, bandcamp, registry]
requires: [43-01 noticeOnAutoPick/SourceAdapter fields, 43-02 /api/bandcamp/* routes]
provides: [bandcamp SourceAdapter, bandcampHealth, bandcamp registry seat]
affects: [search fan-out, fallback ladder, name-stub walk, lyric walk, downloads]
tech-stack:
  added: []
  patterns: [direct audioUrl + own-origin proxyUrl pairing, res.ok inside the counted health try]
key-files:
  created:
    - src/lib/sources/bandcamp.ts
    - src/lib/sources/bandcamp.test.ts
    - src/lib/services/bandcamp-health.ts
    - src/lib/sources/__fixtures__/bandcamp.search.json
  modified:
    - src/lib/sources/types.ts
    - src/lib/sources/registry.ts
    - src/lib/sources/source-order.ts
    - src/lib/config/defaults.ts
    - src/lib/services/catalog.ts
    - src/lib/sources/registry.test.ts
    - src/lib/sources/source-order.test.ts
    - src/lib/services/catalog.test.ts
decisions:
  - "Bandcamp seated directly after suyin in PLAYBACK_ORDER, floor-eligible by default, outside tier-1 by position; quality hard-tagged 128k/128K"
metrics:
  duration: ~12min
  completed: 2026-11-05
---

# Phase 43 Plan 05: Bandcamp client adapter + registration Summary

Bandcamp `SourceAdapter`: search goes through `/api/bandcamp/search` (`page` is ignored, so every call returns the full list), resolve adopts only an https bcbits URL, downloads use the own-origin stream route through `proxyUrl`, quality is tagged 128k, and `noticeOnAutoPick` is set. It is registered right after `suyin`, on by default, and listed as lyricless. Tier-1 is unchanged.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 RED: tests + route-shaped fixture | c9a7c8ef | vitest failed (module missing) |
| 1 GREEN: adapter + health gate + SourceId | 0b113a3f | `vitest --run src/lib/sources/bandcamp.test.ts` 10/10 passed |
| 2 registration + test pins | 3c08e995 | registry/source-order/catalog/fallback tests 147/147 passed; `pnpm check` 0 errors, 18 pre-existing warnings |

## Verification (observed)

- Full suite: 5313 passed, 5 failed. All 5 failures are in the known pre-existing files `settings-persist.svelte.test.ts` and `track-menu-order.test.ts`.
- One run of the 4-file Task 2 set showed 1 flaky failure. It did not reproduce in 3 later runs (147/147 each time). The output was piped through `tail`, so the name of the failing test was not captured.
- Acceptance greps: `'suyin','bandcamp'` adjacency = 1. The TIER_1 pin `['joox','kuwo','kugou','qq','netease']` is untouched (count 1). `res.ok` appears 3 times. `inferQualityFromUrl` appears 0 times. `autoResolveEligible` appears once, in a comment only.
- No live smoke was run. The adapter talks only to the plan-02 routes, which were checked live in 43-02.

## Deviations from Plan

**1. Scope (D-10): Bandcamp only.** No soundcloud id, seat or test pin was added. The `fallbackOrder('netease')` pin ends with `…'suyin','bandcamp'`, and the source-order doc comment does not mention soundcloud.

**2. Fixture source:** `bandcamp.search.json` is built from the committed live autocomplete capture from plan 02 (`bandcamp.autocomplete.json`), using the same mapping as `parseBandcampSearch`. It has 4 rows; one row's cover was set to null by hand. The plan asked for rows copied from a live route response. This uses the same live data and matches the route's output shape.

## TDD Gate Compliance

RED `test(43-05)` c9a7c8ef → GREEN `feat(43-05)` 0b113a3f. No refactor needed.

## Known Stubs

None.

## Self-Check: PASSED

All 4 created files exist; commits c9a7c8ef, 0b113a3f, 3c08e995 are in `git log`.
