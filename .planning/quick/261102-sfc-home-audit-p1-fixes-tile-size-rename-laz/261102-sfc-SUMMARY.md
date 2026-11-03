---
phase: quick-261102-sfc
plan: 01
status: complete
subsystem: home-ui
tags: [a11y, touch-targets, i18n, perf, home]
requirements: [HOME-AUDIT-P1]
key-files:
  modified:
    - src/routes/(app)/settings/home/+page.svelte
    - src/lib/i18n/*.ts (15 dictionaries + i18n.test.ts)
    - src/routes/(app)/+page.svelte
    - src/lib/components/Nowbar.svelte
    - src/routes/(app)/settings/downloads/+page.svelte
    - src/routes/(app)/settings/activity/+page.svelte
    - DESIGN.md
    - src/lib/components/SponsoredStrip.svelte
decisions:
  - "Global Tile size picker maps Compact='list', Comfortable=anything else; stored HomeDensity enum unchanged, no migration"
  - "Destructive-action tints (#ff7a90 on menu/row labels) intentionally NOT moved to --color-danger-text; only inline error text was"
metrics:
  completed: 2026-11-02
  tasks: 3
---

# Quick 261102-sfc: Home audit P1 fixes Summary

Fixes for the five P1 findings from the Home audit. "Tile density" is now an honest two-option "Tile size" picker. The library and fallback grids paint covers with lazy `<img>` tags that fall back on error. Shelf titles are real `<h3>` headings. Error text uses the `--color-danger-text` token. Home controls and sponsor chips reach the Android 48dp touch size.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | a4c78040 | Tile density changed to a two-option Tile size picker; `settings.tileDensity*` renamed to `settings.tileSize*` in all 15 locales |
| 2 | 874d05af | Lazy grid covers, h3 shelf headings, danger-text token (Home + Nowbar + downloads + activity + DESIGN.md), 48px hit boxes |
| 3 | e9e69023 | SponsoredStrip: 49px chip hit band via `::after`, strip padding 12px top/bottom, rem font sizes |

## Verification (observed)

- Task 1 gate: no `settings.tileDensity` left in `src/`; `"settings.tileSizeDesc"` is in all 15 dictionaries. `pnpm test -- src/lib/i18n src/lib/stores/settings`: 4 files, 171 tests passed.
- Task 2 gates: 0 `url(${rowCover})`/`url(${art})` left, 1 `<h3 class="subhead">`, 0 `#ff7a90` in Home, token, `min-height: 48px` and `.gear::after` all present, and DESIGN.md names the token.
- Task 3 gates: 0 px font sizes in SponsoredStrip; `.sp-btn::after` with `inset: -12px 0` is present. `pnpm test -- home-layout i18n settings`: 5 files, 249 tests passed.
- Full `pnpm test` (final run): 242/242 files passed. An earlier run had 3 files / 7 tests failing. That came from another session's in-progress `cover-cache` changes; it was not caused by this work and was gone on the re-run.
- `pnpm check` (final): 3 errors, all from other sessions' uncommitted changes (`cover-cache.test.ts` and `script-fold.test.ts` importing `aliasCoverCacheKey`). Earlier runs also showed `og-cover.ts` importing a missing `norm` from a dirty `dedupe.ts`. None of the errors are in files this plan touched. 31 warnings, none of them new (unused CSS selectors in other settings pages).
- Not verified: the visual render in a browser (the h3 wrapper causing no layout shift, the strip not gaining a vertical scrollbar). These rest on CSS reasoning: the h3 has margin 0 and a single block child, and the `::after` stays inside the strip's padding box.

## WCAG ratios used (no app.css change)

`--color-danger-text`: dark #ff7a90 on #100c06 / #120b10 ≈ 7.8:1; light #c62a47 on #ffffff ≈ 5.5:1, on #f7f7fa ≈ 5.2:1.

## `#ff7a90` sites deliberately left (destructive-action tint, not error text)

`.mi.danger` / `.danger` action labels (TrackMenu declines a token there, per its own comment), RowBadges `.unavailable`, SongRow `.is-danger`, DownloadControl, SettingRow, library edit-row.

## Deviations from Plan

**1. [Rule 3 - Blocking] `src/lib/i18n/i18n.test.ts` updated.** Its `PRESENT` list asserted `settings.tileDensityDesc`; it now asserts `settings.tileSizeDesc`. The plan's zero-`tileDensity` grep gate needed this too. Committed in a4c78040.

**2. [Concurrency] Commit a4c78040 also swept in another session's staged deletions.** `src/lib/services/match-key.ts` and `src/lib/services/match-key.test.ts` (−101 lines) had already been `git rm`-staged by a concurrent session. A path-limited `git add` does not unstage existing index entries, so they rode along. History was not rewritten, because other sessions commit to the same `main`. The deletions were that session's intended change, and `pnpm check` showed no dangling `match-key` imports. Commits 874d05af and e9e69023 used `git commit -- <paths>` to stop this happening again.

## Self-Check: PASSED
- a4c78040, 874d05af, e9e69023 are present in `git log`.
- All modified files exist.
