---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 02
subsystem: home-layout
tags: [home-layout, charts, regions, genres, settings-migration, i18n, security-allowlist]

requires: []
provides:
  - "src/lib/services/home-layout.ts: HOME_SECTIONS (17 ids), CLASSIC_SECTIONS, CHART_SECTIONS, ChartSectionId"
  - "src/lib/services/home-layout.ts: CHART_REGIONS, ChartRegion, KKBOX_REGIONS, YT_REGIONS, resolveChartRegion, resolveExtraRegions"
  - "src/lib/services/home-layout.ts: CHART_GENRE_IDS, ChartGenre, ChartGenreSource, CHART_GENRES, DEEZER_GENRE_IDS, DEFAULT_CHART_GENRES, resolveChartGenres"
  - "src/lib/services/home-layout.ts: HOME_LAYOUT_VERSION = 2, migrateHomeLayout, reorderListed"
  - "36 new i18n keys (home.chartSongs … settings.homeClassicOnCount) in all 15 locales"
affects: [39-03 edge charts route, 39-04 client chart services, 39-07 home render, 39-09 settings migration, 39-10 settings/home redesign]

tech-stack:
  added: []
  patterns:
    - "Closed-allowlist resolver per persisted setting (region, extra regions, genres), fixed-map lookup for defaults"
    - "Pure, idempotent layout migration returned as a value; the store (39-09) owns the version gate + save"

key-files:
  created: []
  modified:
    - src/lib/services/home-layout.ts
    - src/lib/services/home-layout.test.ts
    - src/lib/i18n/{en,zh-Hant,zh-Hans,es,fr,de,pt,it,ru,tr,ar,hi,id,vi,th}.ts
    - src/routes/(app)/settings/home/+page.svelte

key-decisions:
  - "39-D-08: seven persisted chart section ids chart-songs, new-releases, chart-artists, chart-albums, yt-trending, genres, regions; canonical order puts them after radio and the four classic ids after them"
  - "39-D-09: resolveChartRegion = saved offered region > navigator.language region subtag in the offered list (39-D-09b) > fixed app-language map > us; cn is not offered so it can never resolve"
  - "39-D-10: resolveChartGenres keeps an empty selection empty (no fall-back-to-all); non-array means the 8-genre default"
  - "39-D-11: migrateHomeLayout carries density only for VALID old values into chart ids without a valid override of their own"
  - "39-D-12: reorderListed rejects non-integer indices as well as out-of-range ones"

patterns-established:
  - "Own-property lookup (hasOwnProperty.call) for a Record<string, …> keyed by a persisted string, so prototype keys never resolve"

requirements-completed: [P39-05, P39-06, P39-11]

duration: 8min
completed: 2026-09-26
---

# Phase 39 Plan 02: Home-layout chart model + i18n Summary

The home layout now has 17 section ids, a closed 27-region allowlist and a region resolver (never `cn`), an 11-genre source table, a one-time migration that keeps its slot and is idempotent, and a drag helper that leaves classic ids in place. It is all pure and node-tested (77 tests). The 36 chart-shelf strings are translated in all 15 locales.

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-26T02:44:46Z
- **Completed:** 2026-09-26T02:52:35Z
- **Tasks:** 3
- **Files modified:** 18

## Accomplishments

- `home-layout.ts` exports every contract in the plan's `<interfaces>` block, still with zero imports.
- `resolveChartRegion`, `resolveExtraRegions` and `resolveChartGenres` check every persisted value against a closed allowlist before any value can reach a URL (T-39-06/07).
- `migrateHomeLayout` inserts only the missing chart ids at the first classic slot, adds the classic ids to hidden, carries density from each old section to its new one, and gives the same result when run twice (T-39-08).
- `reorderListed` moves a listed row and leaves every classic id at its exact index. Bad indices return an unchanged copy (T-39-09).
- 36 keys added, `settings.groupHomeDesc` changed and `settings.homeCountriesLabel` removed, in all 15 locales. All use double quotes and the parity test passes.

## Task Commits

1. **Task 2: i18n keys in all 15 locales** — `3701c2a` (feat). Also carries Task 3 step 2, the one use of the removed key.
2. **Task 1 RED: failing tests** — `50ca987` (test)
3. **Task 1 GREEN: home-layout.ts model** — `1416fdc` (feat). Also carries Task 3 step 1, the `sectionLabel` map.
4. **Task 3:** no commit of its own. Both of its edits landed in the commits above; its `<verify>` (`pnpm check`) was run on `1416fdc`.

## Verification (observed)

- `pnpm vitest --run src/lib/services/home-layout.test.ts`: **77 passed** (RED run before the implementation: 44 failed, 33 passed). Four test names match `/never.*cn|cn.*never/i`.
- `pnpm vitest --run src/lib/i18n/i18n.test.ts`: **33 passed** (key parity across 15 locales, no blanks, quote style).
- `pnpm check`: **0 errors, 0 warnings**. Run on the i18n commit and again on the final commit.
- `pnpm test` (full suite): **147 files, 3102 tests passed**.
- `pnpm build` (adapter-cloudflare): **done**, succeeded.
- Acceptance greps: the chart tuple appears once. The 5 `export function` lines are present. `HOME_LAYOUT_VERSION = 2` matches. `'cn'` outside comments: 0. `^import`: 0. The 3-key grep prints 3 for each of the 15 locales. `^\t"home.genre.`: 11 in en. en's single-quote count is unchanged (26). `homeCountriesLabel` has 0 matches anywhere in `src`. The settings page has 7 sectionLabel matches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Commit order changed so every commit is safe to auto-deploy**
- **Found during:** Task 1 (before writing code)
- **Issue:** Main auto-pushes and auto-deploys. In plan order, the Task 1 commit would ship 17 section ids while the settings `sectionLabel` map still had 10. `t(undefined)` renders a blank label, so 7 unlabelled rows would go live and `pnpm check` would fail until Task 3. Committing Task 2 on its own would leave `t('settings.homeCountriesLabel')` showing the raw key.
- **Fix:** Committed Task 2 first, together with Task 3's one-line `homeCountriesLabel` → `homeSectionCountries` swap. Then Task 1 RED. Then Task 1 GREEN, together with Task 3's `sectionLabel` entries. `pnpm check` passes on every commit and the settings page always renders labelled rows.
- **Files modified:** as planned. Only the commit grouping changed.
- **Commits:** 3701c2a, 50ca987, 1416fdc

**2. [Rule 2 - Robustness] Prototype-safe LANG_REGION lookup**
- **Found during:** Task 1
- **Issue:** `LANG_REGION[appLang]` on a `Record<string, …>` returns `Object.prototype` members for `'constructor'` or `'__proto__'`, so a garbage app language could return a function instead of a region.
- **Fix:** Own-property lookup (`Object.prototype.hasOwnProperty.call`, the same idiom as `i18n/index.ts` `interpolate`), with a test.
- **Commit:** 1416fdc

**3. [Rule 2 - Robustness] reorderListed rejects non-integer indices; density carry-over copies only valid values**
- **Found during:** Task 1
- **Issue:** `NaN` passes a plain `< 0 || >= length` check, and `splice(NaN)` acts like `splice(0)`. A garbage old density value would also have been copied to the new id.
- **Fix:** `Number.isInteger` in the bounds check. The carry-over now requires a `DENSITY_VALUES` member on the old id and no valid override on the new id. Both are tested.
- **Commit:** 1416fdc

**4. [Rule 1 - Test update] Existing resolveSectionOrder tests re-pinned to 17 ids**
- **Found during:** Task 1 RED
- **Issue:** Besides the HOME_SECTIONS test, four `resolveSectionOrder` tests (appended-ids lists, full permutation, the kmn legacy upgrade) pinned the 10-id list.
- **Fix:** Each one updated to the exact 17-id expectation. None was weakened. The legacy test now asserts `['radio', ...CHART_SECTIONS, 'fav-artists']`.
- **Commit:** 50ca987

## Known Stubs / Intermediate State

- **Home page (`src/routes/(app)/+page.svelte`), until 39-07:** the seven chart ids have no render branch yet, so they draw nothing. An existing user's saved order puts them at the end (via `resolveSectionOrder`), which has no visible effect. A fresh or reset user gets the 17-id default order. There, `shelfCount` counts each chart id as 1 in the progressive-reveal budget, so the first classic shelf mounts about 7 animation frames later than before. It is not broken; 39-07 replaces this when the chart shelves render.
- **Classic sections are still visible for fresh users** until 39-09 changes `HOME_DEFAULTS` and wires `migrateHomeLayout` into `settings.load()`. This plan only provides the pure function.
- **/settings/home** lists 17 toggleable rows. The 7 new rows do nothing on Home yet, which the plan accepts as shippable. The page redesign is 39-10.

## Threat Flags

None. No new network endpoints, auth paths or storage surfaces. The resolvers narrow existing persisted inputs.

## Self-Check: PASSED

- FOUND: src/lib/services/home-layout.ts, src/lib/services/home-layout.test.ts, all 15 locale files, src/routes/(app)/settings/home/+page.svelte
- FOUND commits: 3701c2a, 50ca987, 1416fdc
- TDD gate: `test(39-02)` 50ca987 comes before `feat(39-02)` 1416fdc
