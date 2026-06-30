---
phase: quick-260630-fce
plan: 01
subsystem: settings / i18n
tags: [i18n, settings, ux, helper-text, a11y]
requires: []
provides:
  - "22 settings.*Desc i18n keys in all 15 locales"
  - "22 rendered helper lines across 5 settings pages"
affects:
  - src/lib/i18n/*.ts
  - "src/routes/(app)/settings/{general,appearance,home,playback,data}/+page.svelte"
tech-stack:
  added: []
  patterns:
    - "Per-page atomic commits keep the i18n key-parity test GREEN at every commit"
    - "Reuse each page's existing helper class (.muted / .note / .hint) — no new CSS"
key-files:
  created: []
  modified:
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/vi.ts
    - src/lib/i18n/th.ts
    - src/routes/(app)/settings/general/+page.svelte
    - src/routes/(app)/settings/appearance/+page.svelte
    - src/routes/(app)/settings/home/+page.svelte
    - src/routes/(app)/settings/playback/+page.svelte
    - src/routes/(app)/settings/data/+page.svelte
decisions:
  - "Authored detailed EN copy first, then faithful per-locale translations for the other 14 (no English placeholders, no blanks)"
  - "tileDensityDesc explicitly clarifies it controls LAYOUT/presentation density (list/pile/grid), distinct from Items per shelf which is a count"
  - "clearLibraryDesc is explicitly destructive — states it permanently deletes liked songs/playlists/downloads and cannot be undone, suggests exporting a backup first"
  - "Inserted each page's keys as one logically-grouped block (with a comment) near the end of every locale object — the dict is order-independent and the parity test only checks key set + non-blank values"
metrics:
  duration: ~6m
  completed: 2026-06-30
---

# Phase quick-260630-fce Plan 01: Detailed Settings Helper Text Summary

Added a detailed helper line beneath every previously-unexplained settings control — 22 new `settings.*Desc` i18n keys authored in English and translated into all 14 other locales, rendered as one helper `<p>` per control across 5 settings pages, with the i18n key-parity test kept GREEN at every per-page atomic commit.

## What Was Built

22 new `settings.*Desc` keys, each present in all 15 locale dictionaries, rendered as 22 helper lines:

| Page | Helper class | Keys (count) |
|------|--------------|--------------|
| General | `.muted` | appLanguageDesc, themeDesc, accentColorDesc, reduceMotionDesc (4) |
| Appearance | `.note` | fontSizeTitleDesc, fontSizeArtistDesc, fontSizeLyricsDesc, fontSizeNpTitleDesc, fontSizeNpArtistDesc, coverScaleDesc, gridColumnsDesc (7) |
| Home | `.muted` | itemsPerShelfDesc, defaultLandingTabDesc, tileDensityDesc, showSearchPillDesc, showRandomizeDesc (5) |
| Playback | `.muted` | autoExpandDesc (1) |
| Data | `.hint` | clearPicksDesc, clearNameCacheDesc, clearSearchHistoryDesc, resetAppearanceDesc, clearLibraryDesc (5) |

Each line is a full sentence explaining WHAT the control does AND WHEN/WHY to change it.

## Conventions Honored

- Quote style per file: single quotes in `en` / `zh-Hans` / `zh-Hant`; double quotes in the other 12 locales.
- Markup `t(...)` quote style: single-quote `t('...')` on general / home / playback / data; double-quote `t("...")` on appearance.
- Reused each page's existing helper class — no new CSS, no restyle, no behavior change.
- Did NOT touch Translation / Last.fm / About / settings-index pages, nor any existing key/control/copy (e.g. `appearanceNote`, `clearCoverCacheHint`, `defaultQualityNote` left intact).

## Commits (per-page atomic, code only)

- `bba54fc` feat(quick-260630-fce-01): general settings helper text
- `2aa1ea6` feat(quick-260630-fce-02): appearance settings helper text
- `afd43da` feat(quick-260630-fce-03): home settings helper text
- `c35e9de` feat(quick-260630-fce-04): playback settings helper text
- `fa92115` feat(quick-260630-fce-05): data settings helper text

Each commit staged only the 15 locale files + that page's `+page.svelte` (explicit paths, never `git add -A`). The pre-existing modified `.planning/HANDOFF.json` was never staged.

## Verification

- `npx vitest --run src/lib/i18n/i18n.test.ts` — GREEN (12 passed) after every one of the 5 commits.
- All 22 keys present in exactly 15 locale files each; no blank values.
- Helper-line counts per page: General 4, Appearance 7, Home 5, Playback 1, Data 5 = 22 total.
- `pnpm check` (final, whole project) — 0 errors, 0 warnings, 4291 files.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- All 5 commits exist in git history (bba54fc, 2aa1ea6, afd43da, c35e9de, fa92115).
- All modified files present on disk; SUMMARY.md created.
