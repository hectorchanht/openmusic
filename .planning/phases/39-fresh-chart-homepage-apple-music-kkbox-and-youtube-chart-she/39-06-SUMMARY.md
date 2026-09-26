---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 06
subsystem: settings
tags: [settings, home-layout, charts, regions, genres, persistence, security-allowlist]

requires:
  - phase: 39-02
    provides: "CHART_REGIONS, ChartRegion, DEFAULT_CHART_GENRES in src/lib/services/home-layout.ts"
provides:
  - "HOME_DEFAULTS.homeChartRegion ('auto'), homeExtraRegions ([]), homeChartGenres (the 8 DEFAULT_CHART_GENRES)"
  - "settings.homeChartRegion / homeExtraRegions / homeChartGenres $state fields wired through init, load, save, resetHome"
affects: [39-07 home render, 39-09 settings migration, 39-10 settings/home redesign]

tech-stack:
  added: []
  patterns:
    - "Allowlist guard (CHART_REGIONS.includes) for a persisted enum string; type guard only for persisted ordered lists"

key-files:
  created: []
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings-persist.svelte.test.ts

key-decisions:
  - "39-06: homeChartRegion load uses a CHART_REGIONS allowlist ('cn', 42, 'HK', garbage all load as 'auto'); homeExtraRegions / homeChartGenres use Array.isArray only, and an explicit [] genre list is preserved"
  - "39-06: no homeLayoutVersion and no homeHidden default change; a test asserts the saved blob has no homeLayoutVersion key until the migration plan (39-09) removes it"

patterns-established:
  - "Negative guard test for a deferred key, so an early edit cannot slip it in before its owning change"

requirements-completed: [P39-05, P39-06]

duration: 4min
completed: 2026-09-26
---

# Phase 39 Plan 06: Home chart settings in the settings store Summary

The settings store now persists three home-chart settings: Chart region (`'auto'` or an allowlisted region), More regions (ordered list, default none) and Genres (ordered list, default the 8 locked genres). Each goes through all four touchpoints: field init, load guard, save payload, resetHome. Home's behaviour is unchanged, and no layout version is written.

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-26T03:12:53Z
- **Completed:** 2026-09-26T03:16:17Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `HOME_DEFAULTS` has `homeChartRegion: 'auto'`, `homeExtraRegions: []` and `homeChartGenres: [...DEFAULT_CHART_GENRES]`. The genre default is taken from `home-layout.ts`, so there is one source of truth.
- `load()` accepts a persisted region only if it is a string in `CHART_REGIONS`. Anything else becomes `'auto'`, unlike `bioLang`'s bare cast (T-39-25). The two lists are type-guarded only (T-39-26). Value cleanup is left to `resolveExtraRegions` / `resolveChartGenres` at render.
- `save()` writes the three keys and `resetHome()` restores them, copying the arrays.
- The store is still a leaf. It imports only `defaults` and `home-layout`, and has no import from `home-charts` or `charts`.
- `homeHidden: [] as string[]` is unchanged. `homeLayoutVersion` appears 0 times in both files.

## Task Commits

1. **Task 2 (as TDD RED for Task 1): round-trip tests** — `e932022` (test)
2. **Task 1 GREEN: fields + load/save/reset** — `6950e4c` (feat). This commit also rewords two test comments (see Deviations).

## Verification (observed)

- RED run (`pnpm vitest --run src/lib/stores/settings-persist.svelte.test.ts`): **16 failed, 20 passed** (36). The one new test that passed is the `homeLayoutVersion` absence guard, which is expected: it asserts that something does not exist, so it passes before the implementation too.
- GREEN run (`pnpm vitest --run src/lib/stores/settings-persist.svelte.test.ts src/lib/stores/settings.svelte.test.ts`): **81 passed**, 2 files.
- `pnpm check`: **0 errors, 0 warnings** (4602 files).
- `pnpm test` (full suite): **151 files, 3235 tests passed**.
- `pnpm build` (adapter-cloudflare): exit 0, `✔ done`.
- Acceptance greps: defaults.ts has 3 matches for the three names. The store has 6 `homeChartRegion` matches (≥ 4). `homeLayoutVersion` is `:0` in both files. `homeHidden: [] as string[]` still matches at line 184. The home-charts/charts import grep prints 0. The test file is 305 lines (≥ 250) and adds 17 tests in `describe('settings persistence round-trip — home chart settings (39-D-25)')`. One test name contains `homeLayoutVersion` and one contains `cn`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Process] Task 2's tests were written first as the TDD RED step for Task 1**
- **Found during:** Task 1 (`tdd="true"`)
- **Issue:** Task 1 is TDD, but its tests are Task 2's deliverable, so there is nothing to write RED against without them.
- **Fix:** Wrote the full Task 2 describe block first, committed it as `test(39-06)`, then implemented Task 1 as `feat(39-06)`. Task 2 has no separate commit because its content is the RED commit. The RED commit fails `pnpm check`/tests until GREEN, but `pnpm build` (what auto-deploy runs) never compiles test files. This matches the RED-commit pattern of 39-02 and 39-05.
- **Commits:** e932022, 6950e4c

**2. [Rule 2 - CLAUDE.md / no GSD metadata in product code] Plan numbers kept out of source comments and the test name**
- **Found during:** Task 1 / Task 2
- **Issue:** The plan asked for a comment naming 39-09/39-07 and a test named "…(39-09 owns the one-time switch)". Plan numbers are GSD bookkeeping. Decision and threat refs (`39-D-25`, `T-39-27`) are house style and were kept. The comment first used the literal word `homeLayoutVersion`, which broke the plan's own `:0` grep for defaults.ts.
- **Fix:** The defaults.ts comment now describes the reason in terms of behaviour, naming `migrateHomeLayout` and "no layout-version field". The test is named `does not write homeLayoutVersion yet (the one-time layout switch owns it)`, which still matches `/homeLayoutVersion/`.
- **Files modified:** src/lib/config/defaults.ts, src/lib/stores/settings-persist.svelte.test.ts
- **Commit:** 6950e4c

**3. [Coverage] Extra tests beyond the behaviour list**
- Added three tests the plan did not list: an existing-install blob without the three keys loads the defaults, `'garbage'` region → `'auto'` (from the plan's must_haves), and the saved order of `homeChartGenres` is kept.

## Handoff Notes for 39-09

- Remove or invert the `does not write homeLayoutVersion yet` test in `settings-persist.svelte.test.ts` in the same change that wires `migrateHomeLayout` into `load()` and changes `HOME_DEFAULTS.homeHidden`.

## Known Stubs

None. Nothing reads the three fields yet: 39-07 (Home) and 39-10 (settings page) will. Until then, stored values sit unused, which the plan intends ("no behaviour change on Home yet").

## Threat Flags

None. There are no new endpoints or storage keys. The three fields go into the existing `openmusic:settings:v1` blob, and T-39-25/26/27 are mitigated as planned.

## TDD Gate Compliance

`test(39-06)` e932022 comes before `feat(39-06)` 6950e4c. No refactor commit was needed.

## Self-Check: PASSED

- FOUND: src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/lib/stores/settings-persist.svelte.test.ts
- FOUND commits: e932022, 6950e4c
