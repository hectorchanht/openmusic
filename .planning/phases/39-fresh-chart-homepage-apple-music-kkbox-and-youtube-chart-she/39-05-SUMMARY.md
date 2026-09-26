---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 05
subsystem: home
tags: [charts, home, planner, randomize, intl, pure-module, cache-keys]

requires:
  - phase: 39-01
    provides: "ChartAlbum, stripReleaseSuffix"
  - phase: 39-02
    provides: "CHART_SECTIONS, CHART_REGIONS, KKBOX_REGIONS, YT_REGIONS, CHART_GENRE_IDS, DEFAULT_CHART_GENRES, ChartRegion, ChartGenre, ChartSectionId"
provides:
  - "src/lib/services/home-charts.ts: planChartShelves, poolKey, genrePoolKey, samplePicks, regionLabel, regionListLabel, chartAlbumHref, CHART_GENRE_LABEL, HOME_CACHE_KEY, LEGACY_HOME_CACHE_KEYS, POOL_STALE_MS, POOL_CAP, ChartTask, ChartPlanConfig"
  - "src/lib/services/shuffle.ts: dependency-free shuffle() (re-exported from discovery.ts)"
affects: [39-07 home page, 39-10 home settings page]

tech-stack:
  added: []
  patterns:
    - "Plan-then-fetch: the page runs whatever planChartShelves returns, so 'hidden = zero requests' is a node test, not a browser check"
    - "Pool + index picks: Randomize re-draws indices into an already-fetched pool (samplePicks), zero network"

key-files:
  created:
    - src/lib/services/home-charts.ts
    - src/lib/services/home-charts.test.ts
    - src/lib/services/shuffle.ts
  modified:
    - src/lib/services/discovery.ts

key-decisions:
  - "shuffle() moved to a leaf module (shuffle.ts) so home-charts.ts stays store-free; discovery.ts re-exports it"
  - "In hk/tw/sg chart-songs plans two tasks (KKBOX + Apple) under one region-qualified pool key — fused, not fallback"
  - "Chart albums come from Apple for every region (KKBOX album chart returns error 103)"
  - "HOME_CACHE_KEY is openmusic:top-picks:v3 and lives in $lib so the home page and the Clear-picks button share it"

requirements-completed: [P39-07, P39-08, P39-12]

duration: 4min
completed: 2026-09-26
---

# Phase 39 Plan 05: Home chart orchestration helpers Summary

**Pure home-chart planner (one task per visible, region-capable shelf; hidden emits none), ascending-index pool sampler for zero-request Randomize, Intl region labels, name-only album href and the v3 home cache key, all node-tested.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-26T03:08:30Z
- **Completed:** 2026-09-26T03:12:30Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `planChartShelves(cfg)` emits tasks in CHART_SECTIONS order. With every section visible that is 14 for a KKBOX region (hk) and 12 elsewhere (us: one Apple chart-songs task, no new-releases). A hidden section emits nothing, and hiding all 7 chart sections returns `[]`.
- `samplePicks(len, n)` returns unique indices in `[0, len)`, sorted ascending so the chart-rank order holds. It returns every index when the pool is smaller than n, and `[]` for non-positive inputs.
- `regionLabel` / `regionListLabel` use memoised `Intl.DisplayNames` (short style) and `Intl.ListFormat` (conjunction/narrow). A bad language tag falls back to `cc.toUpperCase()` / a `', '` join instead of throwing.
- `chartAlbumHref` routes through `albumHref` with `' - EP'` / `' - Single'` stripped, so the URL carries no `dzid` or `mbid`.
- `shuffle` now lives in `shuffle.ts`, which has no imports. `discovery.ts` re-exports it, so `library/+page.svelte` and `discovery.test.ts` did not change.

## Task Commits

1. **Task 1: Move shuffle() to a dependency-free module** - `dc30ba9` (refactor)
2. **Task 2 RED: failing tests for planner/sampler/labels/href/constants** - `77f6c6d` (test)
3. **Task 2 GREEN: home-charts.ts** - `870bd98` (feat)

## Verification (observed)

- `pnpm vitest --run src/lib/services/discovery.test.ts` after Task 1: 26/26 passed.
- RED run of `home-charts.test.ts`: the suite failed as expected because the module did not exist yet.
- `pnpm vitest --run src/lib/services/home-charts.test.ts src/lib/services/discovery.test.ts`: 56/56 passed (30 in home-charts). Test names match /hidden/, /new-releases.*outside/, /fuses two/, /ascending/, /EP.*Single/.
- `pnpm check` after each task: 0 errors, 0 warnings.
- `pnpm test` (full suite): 151 files, 3218 tests passed.
- Acceptance greps: 0 store/`$app`/charts/settings imports in home-charts.ts; all 7 exported functions present; `HOME_CACHE_KEY = 'openmusic:top-picks:v3'` and `import { shuffle } from './shuffle'` found. shuffle.ts has 0 imports, and discovery.ts has the re-export and no `export function shuffle`.

## Files Created/Modified

- `src/lib/services/home-charts.ts` - pure planner, sampler, Intl labels, album href, genre label map, cache constants
- `src/lib/services/home-charts.test.ts` - 30 node tests (240 lines)
- `src/lib/services/shuffle.ts` - leaf Fisher-Yates `shuffle()`
- `src/lib/services/discovery.ts` - function body replaced by `export { shuffle } from './shuffle'`

## Decisions Made

- Beyond the plan's `<behavior>` list I added two fallback tests (`regionLabel('hk','!!') === 'HK'`, `regionListLabel(['hk','tw'],'!!') === 'HK, TW'`). Node's Intl accepts `'not-a-lang'` as a structurally valid tag, so without them the catch branches would never run in a test.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

RED `test(39-05)` commit `77f6c6d` comes before GREEN `feat(39-05)` commit `870bd98`. No refactor commit was needed.

## Issues Encountered

None.

## Next Phase Readiness

- 39-07 can build a `ChartPlanConfig` from the resolved settings, run `planChartShelves(cfg)` under FANOUT_CAP, fill pools by `task.key`, and pick with `samplePicks(pool.length, shelfSize)`.
- 39-10 can import `HOME_CACHE_KEY` + `LEGACY_HOME_CACHE_KEYS` for the Clear-picks button, and `regionLabel` / `regionListLabel` / `CHART_GENRE_LABEL` for its labels.

## Self-Check: PASSED

- FOUND: src/lib/services/home-charts.ts, src/lib/services/home-charts.test.ts, src/lib/services/shuffle.ts
- FOUND commits: dc30ba9, 77f6c6d, 870bd98
