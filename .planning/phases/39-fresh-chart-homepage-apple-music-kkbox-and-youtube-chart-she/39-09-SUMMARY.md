---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 09
subsystem: settings
tags: [settings, home-layout, migration, persistence, charts, cache]

requires:
  - phase: 39-02
    provides: "migrateHomeLayout, HOME_LAYOUT_VERSION, CLASSIC_SECTIONS, CHART_SECTIONS in src/lib/services/home-layout.ts"
  - phase: 39-05
    provides: "HOME_CACHE_KEY (v3) and LEGACY_HOME_CACHE_KEYS in src/lib/services/home-charts.ts"
  - phase: 39-07
    provides: "the home page renders the chart shelves, so hiding the classic shelves is safe to ship"
provides:
  - "HOME_DEFAULTS.homeHidden = [...CLASSIC_SECTIONS]; HOME_DEFAULTS.homeLayoutVersion = HOME_LAYOUT_VERSION"
  - "settings.homeLayoutVersion (plain field), version-gated migration in load(), post-migration save, save payload, resetHome"
  - "Clear picks removes HOME_CACHE_KEY, every LEGACY_HOME_CACHE_KEYS entry and the library shelf cache"
affects: [39-10 settings/home redesign]

tech-stack:
  added: []
  patterns:
    - "One-shot persisted migration: version gate after the type guards, `if (migrated) this.save()` after the try block, so it runs exactly once"

key-files:
  created: []
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings-persist.svelte.test.ts
    - src/routes/(app)/settings/data/+page.svelte

key-decisions:
  - "39-09: the layout migration runs inside settings.load() after the home type guards and density coercion, so migrateHomeLayout only ever sees arrays and valid densities; a migrated load saves immediately, a first visit or an already-v2 blob does not write"
  - "39-09: homeLayoutVersion is a plain class field (not $state); a missing or non-number persisted value counts as version 1, a forged higher number only skips the switch"
  - "39-09: defaults change and migration shipped in ONE commit, so no deploy hides the classic shelves for fresh installs while existing users keep them, or writes a version without the migration"

patterns-established:
  - "Version-gated one-shot migration in a settings load(), with a round-trip test that un-hiding after the migration survives a reload"

requirements-completed: [P39-06, P39-07, P39-12]

duration: 6min
completed: 2026-09-26
---

# Phase 39 Plan 09: One-time home layout switch and Clear-picks fix Summary

Existing installs now switch to the chart layout once, on their first load after the update. The seven chart ids go where the old chart block sat, the four classic Deezer/Last.fm shelves are hidden, and per-shelf density carries over. The version marker is saved in the same load, so a classic shelf the user turns back on stays on. Fresh installs and Reset to default get the same layout from `HOME_DEFAULTS`. Settings → Data → "Clear cached top picks" had been a no-op since the home cache left v1. It now clears the real key.

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-26T04:01:21Z
- **Completed:** 2026-09-26T04:06:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `defaults.ts`: `homeHidden: [...CLASSIC_SECTIONS] as string[]` and `homeLayoutVersion: HOME_LAYOUT_VERSION`. The 39-06 "do not add yet" comment is gone.
- `settings.svelte.ts`: added a plain `homeLayoutVersion` field. In `load()`, a version gate follows the `homeSectionDensity` coercion: if the persisted version is below 2 (missing or non-number counts as 1), `migrateHomeLayout` runs and sets `migrated = true`. `load()` then calls `if (migrated) this.save();` before `applyTheme()`. `save()` writes `homeLayoutVersion`, and `resetHome()` restores it. There is no toast or banner (UI-17).
- The density coercion's inner `const migrated` was renamed to `next`, so it no longer shadows the new outer `migrated` flag.
- `settings/data/+page.svelte`: the `'openmusic:top-picks:v1'` literal is replaced by an import of `HOME_CACHE_KEY` / `LEGACY_HOME_CACHE_KEYS` from `$lib/services/home-charts`. `clearPicks()` removes v3, v1, v2 and `home-library:v1`, each inside its own try/catch.
- Backups are unaffected. `BACKUP_EXACT_KEYS` never included the home cache.

## Task Commits

1. **Task 2 test half (TDD RED for Task 1): migration round-trip tests** — `d88579c` (test)
2. **Task 1 GREEN: defaults flip + version-gated migration + persisted version** — `a78348c` (feat)
3. **Task 2 Clear-picks fix** — `e0f6943` (fix)

## Verification (observed)

- RED run (`pnpm vitest --run src/lib/stores/settings-persist.svelte.test.ts`): **7 failed, 37 passed** (44). Two of the new tests passed before the implementation, as expected. "un-hide survives reload" passes trivially while nothing migrates, and "already at v2 → untouched, no write" asserts that nothing changes.
- GREEN run of the Task 1 verify command (`settings-persist.svelte.test.ts`, `settings.svelte.test.ts`, `backup-logic.test.ts`): **3 files, 125 passed**.
- Plan verification (`settings-persist.svelte.test.ts` + `home-layout.test.ts`): **2 files, 121 passed**.
- `pnpm check`: **0 errors, 0 warnings** (4602 files), run after Task 1 and again after Task 2.
- `pnpm test` (full suite, after Task 1): **151 files, 3244 tests passed**.
- `pnpm build` (adapter-cloudflare): exit 0 after Task 1 and again after Task 2.
- Acceptance greps:
  - Both `defaults.ts` patterns match (lines 190 and 210).
  - `migrateHomeLayout(` has one call site (line 450), and `if (migrated) this.save()` is at line 471.
  - `homeLayoutVersion` appears on 7 lines of the store, and none of them uses `$state`.
  - `does not write homeLayoutVersion yet` count: 0.
  - The test file is 408 lines (≥ 320). The `one-time home layout switch (39-D-40 / P39-06)` describe has 8 tests, matching the survives/reload, fresh install, already…v2 and resetHome names.
  - The data page has 0 `top-picks:v1` literals, the import line matches (`grep -F`, line 12), and `clearPicks` contains 3 `removeItem` calls.

### Dev smoke (headless Chromium over raw CDP against the running :5173 dev server, fresh profile, 390×844, English)

- **Old blob seeded** (no `homeLayoutVersion`, custom order starting with `history`, `homeHidden: ['downloads']`, density `{top-hits: pile, countries: grid}`, `homeShelfSize: 16`, `homeShowSearchPill: false`). After one load, the persisted blob had:
  - version 2
  - hidden = `downloads, top-hits, top-artists, tags, countries`
  - the chart ids inserted after `radio`, with `history` still first
  - density `{top-hits: pile, countries: grid, chart-songs: pile, regions: grid}`
  - size 16, pill false
- **Home headings after migration** (a separate run, default old order): Top picks, Top songs · US, Top artists · US, Top albums · US, Trending on YouTube · US, Cantopop, Mandopop, K-Pop, J-Pop, Hip-Hop, Rock, Dance, R&B. None of the Deezer Top hits, Deezer Top artists, Last.fm tag shelves or country shelves appeared.
- **Reload:** the persisted settings string was byte-identical, so the migration did not run a second time.
- **/settings/home:** Top hits, Top artists (classic), Genre shelves and Country shelves showed as off, and the chart rows as on. Clicking the **Top hits** switch removed `top-hits` from `homeHidden`. After a reload it was still visible and the order was unchanged.
- **Clear picks:** v1, v2, v3 and `home-library:v1` were all present before. After clicking "Clear cached top picks" on /settings/data, all four were gone.
- **Not checked:** the full cold refetch after Clear picks (only key removal was observed), iOS Safari, and a device. "New releases" did not appear in the heading list of the 15 s headless run. That shelf's rendering belongs to 39-07/08, and this plan does not touch it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Process] Task 2's tests were committed first as the TDD RED step for Task 1**
- **Found during:** Task 1 (`tdd="true"`)
- **Issue:** Task 1's tests are Task 2's deliverable, so there was nothing to go RED against without them. This is the same situation as 39-06.
- **Fix:** Wrote the replacement for the guard test and the whole migration describe block first, committed it as `test(39-09)`, then committed the implementation as `feat(39-09)`. The Clear-picks half of Task 2 has its own `fix(39-09)` commit. The RED commit is safe to deploy because `pnpm build` never compiles test files.
- **Commits:** d88579c, a78348c, e0f6943

**2. [Coverage] Two tests beyond the behaviour list**
- A legacy `'comfortable'` density on `tags` is normalised before it carries (`genres: 'pile'`). This proves the migration runs after the density coercion.
- A string `homeLayoutVersion: '2'` is treated as version 1 and migrates (T-39-35).

**3. [Clarity] Renamed the density coercion's inner `migrated` to `next`**
- The inner name shadowed the new outer `migrated` flag. The shadowing was harmless because the inner one lives in an arrow function, but it was easy to misread. The rename changes no behaviour.
- **Commit:** a78348c

## Commit-order safety (auto-push/auto-deploy)

- `d88579c` touches tests only, so the deployed bundle does not change.
- `a78348c` lands the `homeHidden` default flip, the migration, the version write and the post-migration save together. No deployable state hides classic shelves without the migration, or stamps a version without it. The chart shelves already render (39-07/08).
- `e0f6943` is an independent Clear-picks fix.

## Known Stubs

None.

## Threat Flags

None. There are no new endpoints or storage keys: `homeLayoutVersion` goes into the existing `openmusic:settings:v1` blob. T-39-35/36/37 are mitigated as planned and each is pinned by a test (non-number version, un-hide survives reload, type guards before the migration).

## TDD Gate Compliance

`test(39-09)` d88579c comes before `feat(39-09)` a78348c. No refactor commit was needed.

## Self-Check: PASSED

- FOUND: src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/lib/stores/settings-persist.svelte.test.ts, src/routes/(app)/settings/data/+page.svelte
- FOUND commits: d88579c, a78348c, e0f6943
