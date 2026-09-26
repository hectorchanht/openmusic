---
phase: quick-260925-vtg
plan: 01
subsystem: settings
tags: [settings, defaults, home-layout, persistence]
requires: []
provides:
  - "New app defaults = the user's exported openmusic:settings:v1 (fresh install + every reset group)"
  - "load() accepts persisted zhScript 'off' and homeChartRegion 'auto' as real values"
affects: [settings store, home page first paint, translation surfaces, download quality, song rows]
tech-stack:
  added: []
  patterns: ["WR-10: load() fallbacks read defaults.ts consts, never a literal"]
key-files:
  created: []
  modified:
    - src/lib/config/defaults.ts
    - src/lib/services/home-layout.ts
    - src/lib/stores/settings.svelte.ts
    - src/app.css
    - src/lib/services/home-layout.test.ts
    - src/lib/services/home-charts.test.ts
    - src/lib/stores/settings-persist.svelte.test.ts
    - src/lib/stores/settings.svelte.test.ts
decisions:
  - "quick-260925-vtg: the user's exported settings are the app defaults; supersedes 39-D-25 (auto region / no extra regions) and 39-D-10 (8-genre lock) by explicit user request"
  - "quick-260925-vtg: load() treats zhScript 'off' and homeChartRegion 'auto' as valid persisted values so existing users keep their old-default choices"
  - "DEFAULT_CHART_GENRES / DEFAULT_SECTION_ORDER stay explicit literals (not spreads of the pools) so a pool addition never silently changes the default"
metrics:
  duration: "~4 min"
  completed: 2026-09-26
  tasks: 3
  files: 8
---

# Quick 260925-vtg: Adopt the user's exported settings as app defaults

The user's exported settings are now what a fresh install starts with and what every Reset-to-default goes back to. Changed: teal accent `#00c2b8`, Download+Like row buttons, lyrics/bio translation off, English skipped for artist/title/lyrics, `zh-Hant` script lock, `auto` download quality, quality tag shown, HK chart region plus US, all 11 chart genres, and the exported home section order. Two `load()` allowlist gaps are closed so none of this overwrites a saved old-default value.

## Commit

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1-3 | New default literals + load() guard fixes + tests (one green commit, per plan) | ccd158f | the 8 files above |

## What changed

- **defaults.ts:** changed 11 keys, each with a quick-260925-vtg decision comment: `DEFAULT_ACCENT`, `rowActions`, `lyricsLang`, `bioLang`, `artistSkip`/`titleSkip`/`lyricsSkip`, `zhScript`, `downloadQuality`, `showQualityTag`, `homeChartRegion`, `homeExtraRegions`. The kxz/2jo/k5y/39-D-25 comments were rewritten to explain the new values.
- **home-layout.ts:** `DEFAULT_CHART_GENRES` is now the explicit 11-id literal in pool order. `DEFAULT_SECTION_ORDER` is now the explicit 17-id exported order. `HOME_SECTIONS`, `CLASSIC_SECTIONS`, `CHART_SECTIONS` and `migrateHomeLayout` are unchanged, so an existing blob migrates exactly as it did before.
- **settings.svelte.ts `load()`:**
  - The zhScript guard now accepts `'off'`.
  - The homeChartRegion guard now accepts `'auto'`, and its fallback is `HOME_DEFAULTS.homeChartRegion` instead of the `'auto'` literal.
  - The four skip-list fallbacks now spread `TRANSLATION_DEFAULTS.*` instead of `[]`.
  - The other changed keys were checked and are already safe: `??` for lyricsLang/bioLang/downloadQuality/accent, `typeof === 'boolean'` for showQualityTag, `Array.isArray` for rowActions/homeExtraRegions/homeChartGenres/homeSectionOrder.
- **app.css:** the pre-hydration `--color-primary` / `--color-primary-hover` are now `#00c2b8` / `#00aba2` (the latter is `darken('#00c2b8', 0.12)`), so a fresh install no longer flashes purple before `applyTheme()` runs.

## Verification (observed)

- Task 1: `pnpm check` gave 0 errors, 0 warnings. Old-default literal grep on non-comment lines of defaults.ts returned 0. The quick-260925-vtg tag appears in defaults.ts (9), home-layout.ts (2), settings.svelte.ts (7) and app.css (2).
- Task 2: the 4 target test files passed (201/201). settings-persist.svelte.test.ts has 20 quick-260925-vtg references.
- Task 3: `pnpm test` passed 151 files / 3249 tests. `pnpm check` gave 0 errors. `pnpm build` finished with adapter-cloudflare "done".
- Regression guards added and passing:
  - persisted `zhScript: 'off'` loads as `'off'`
  - a missing or `'bogus'` zhScript loads as `'zh-Hant'`
  - persisted `homeChartRegion: 'auto'` loads as `'auto'`
  - `'cn'`, `42`, `'HK'` and `'garbage'` load as `'hk'`
  - persisted `rowActions: []` is still honoured
  - `DEFAULT_SECTION_ORDER` is a permutation of all 17 ids
- The 39-D-40 migration block ran unedited and passed.
- **Not verified:** nothing was checked in a browser. A fresh-install first paint would need localStorage cleared on a live dev server. Unit tests cover the class-field init, `load()` and the reset paths.

## Deviations from Plan

**1. [Rule 1 - Stale comment] Three more field doc comments in settings.svelte.ts**
- **Found during:** Task 1
- **Issue:** Three class-field doc comments stated the old defaults: bioLang "'auto' = follow appLang (default)", zhScript "'off' (D-1 default)", and nowbarLyrics "opt-in exactly like showQualityTag above".
- **Fix:** Reworded them to match the new defaults and tagged them quick-260925-vtg. Comments only, no code change.
- **Commit:** ccd158f

Otherwise the plan was executed as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/config/defaults.ts, src/lib/services/home-layout.ts, src/lib/stores/settings.svelte.ts, src/app.css, and all 4 test files, all in commit ccd158f (8 files, 266+/115-)
- FOUND: commit ccd158f in git log
- No file deletions in the commit. Not pushed.
