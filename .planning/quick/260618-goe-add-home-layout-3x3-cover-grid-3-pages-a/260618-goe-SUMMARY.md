---
phase: quick-260618-goe
plan: 01
subsystem: home + settings
tags: [home-layout, density, grid, i18n, settings, svelte5-runes]
requires:
  - resolveSectionDensity / HomeDensity (home-layout.ts)
  - CompactPager prop idiom (items/key/row snippet)
  - applyTheme() --cover-scale / --home-grid-cols vars
provides:
  - HomeDensity union 'list' | 'pile' | 'grid' + pure migrateDensity helper
  - HomeGridPager.svelte (3×3 paginated cover grid, dot indicator, max 27)
  - non-destructive load() migration for homeDensity + homeSectionDensity
  - .crow art wired to --cover-scale (cover-size now affects compact tiles)
  - live cover-size + grid-columns preview demos in Appearance settings
affects:
  - src/routes/(app)/+page.svelte (home render: list/pile/grid branches)
  - src/routes/(app)/settings/home/+page.svelte (3-mode density toggle)
  - src/routes/(app)/settings/appearance/+page.svelte (live demos)
  - all 15 i18n dicts (new density + preview keys)
tech-stack:
  added: []
  patterns:
    - "pure load-guard migration helper (migrateDensity) mirroring the home-layout robustness layer"
    - "layout-only pager component + host-supplied row snippet (HomeGridPager mirrors CompactPager)"
key-files:
  created:
    - src/lib/components/HomeGridPager.svelte
  modified:
    - src/lib/services/home-layout.ts
    - src/lib/services/home-layout.test.ts
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/components/CompactRow.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/settings/home/+page.svelte
    - src/routes/(app)/settings/appearance/+page.svelte
    - src/lib/i18n/*.ts (15 locales)
decisions:
  - "Artist grid tiles reuse the .tile shell with a round .art + centered name (flex-column override of the square aspect-ratio), reusing the most existing CSS rather than introducing a separate artist-grid component."
  - "en.ts density keys committed in Task 3 (it defines TranslationKey, so the home toggle compiles standalone); the other 14 locales + settings.preview committed in Task 4."
  - "Legacy densityComfortable/densityCompact i18n keys kept (still parity-required + harmless) rather than removed."
metrics:
  duration: ~10 min
  completed: 2026-06-18
  tasks: 4
  files: 25
---

# Quick Task 260618-goe: Home grid layout mode + crow art size Summary

Added a third home layout mode — a YouTube-Music "Speed dial" 3×3 paginated cover grid (9 tiles/page, max 3 pages / 27 tiles, title+artist overlaid, dot indicator) — selectable per-section and globally via a renamed `list | pile | grid` density toggle with a non-destructive localStorage migration, and fixed the compact cover-tile ("crow") art to actually respond to the Cover Size setting, with live preview demos under both the Cover Size and Home Grid Columns controls.

## What shipped

- **Task 1 (bc1afeb):** `HomeDensity` renamed `'comfortable' | 'compact'` → `'list' | 'pile' | 'grid'`; added `DENSITY_VALUES` const and a pure `migrateDensity(unknown): HomeDensity | undefined` helper (`compact`→`list`, `comfortable`→`pile`, passthrough new values, `undefined` for garbage). `resolveSectionDensity` validates against the three new values. `defaults.ts` default `'comfortable'` → `'pile'` (preserves today's look). `settings.load()` migrates BOTH `homeDensity` (via `migrateDensity(...) ?? default`) and `homeSectionDensity` (object-not-array guard, then per-entry migrate, dropping garbage).
- **Task 2 (89988d2):** `HomeGridPager.svelte` — caps at 27, chunks into pages of 9, renders a 3-col scroll-snap grid per page with an accent-highlighted dot page indicator (only when >1 page); layout-only, host supplies the `row` snippet. `CompactRow .art` now `calc(40px * var(--cover-scale, 1))` (the crow-size root-cause fix, mirroring `.album`/`.al-cover`).
- **Task 3 (b7e3baa):** `densityOf` returns `HomeDensity` (globalDefault `'list'`); `discoveryShelf`/`libraryShelf` take a density value with a `grid` arm rendering `HomeGridPager` over the reused `.tile/.scrim/.label` markup; top-artists / fav-artists branches gain a grid arm using a round-cover artist tile. `section.compact` class compares against `'list'`. Settings → Home offers three modes per-section + globally with the `Grid3x3` icon for grid. en.ts source dict gains the new keys.
- **Task 4 (9231196):** `settings.densityList/Pile/Grid` added to the remaining 14 locales (+ `settings.preview` to all 15); live cover-size demo (3 tiles sized off `coverScale`) and live grid-columns demo (column count tracks `homeGridCols`) added to Appearance, both `aria-hidden`.

## Migration (non-destructive)

A returning user's persisted `homeDensity: 'compact'` loads as `'list'`, `'comfortable'` loads as `'pile'`; each `homeSectionDensity` entry migrates per-entry (`{ tags: 'comfortable' }` → `{ tags: 'pile' }`), with garbage entries dropped. Verified by the migrateDensity unit tests and the mirrored load-guard assertions in the settings test.

## Verification

- `npx vitest --run` — **898 tests / 65 files pass** (incl. home-layout, settings, i18n parity suites). No regressions.
- `npx svelte-check --tsconfig ./tsconfig.json` — **0 errors, 0 warnings** (4289 files).
- i18n parity: every locale's key set is identical to `en` (parity test green) after adding the density + preview keys.

### Manual smoke (deferred to a human/device pass)

Browser-visual checks not run headlessly: setting a section to Grid renders the 3×3 paginated grid with dots for >9 items (capped at 27); the Cover Size slider visibly resizing compact home tiles; the two Appearance live demos tracking their sliders as you drag. Dev server is strictPort 4321. All wiring is covered by the type + unit checks above; the remaining check is purely visual.

## Deviations from Plan

None functional. One sequencing note (not a behavior deviation): the `en.ts` density keys were committed with Task 3 rather than Task 4, because `en.ts` defines `TranslationKey` and the Settings → Home toggle (Task 3) references those keys — committing them together keeps each commit independently compiling. The remaining 14 locales and `settings.preview` landed in Task 4 as planned.

## Decisions Made

- Artist grid tiles reuse the existing `.tile` shell with a round `.art` cover + a centered name label (a flex-column override of the square `aspect-ratio:1/1` tile), reusing the most existing CSS instead of a new artist-grid component (per the plan's "pick the approach that reuses the most existing CSS and document the choice").
- Kept the legacy `settings.densityComfortable` / `settings.densityCompact` i18n keys (parity test still requires them across locales; harmless to retain) — only the toggle switched to the new keys.

## Known Stubs

None — the grid renders live discovery/library data through the same `tileCover`/`libraryRowCover`/`playStub`/`playLibraryTrack` paths as the existing shelves; no placeholder or empty-data wiring introduced.

## Self-Check: PASSED

- Created file exists: `src/lib/components/HomeGridPager.svelte`
- Commits present: bc1afeb, 89988d2, b7e3baa, 9231196 (verified in git log)
