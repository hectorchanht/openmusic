---
quick_id: 261102-s0k
status: complete
commits: [952be2cd, f75739e6]
---

# Quick 261102-s0k: search audit round 2 Summary

Light-theme focus indicators now use a `--color-focus` token that clears 3:1 against bg and surface-2. The search typeahead's keyboard-highlighted option is visible, and the live region announces searching, the result count, or empty.

## Task 1: `--color-focus` token (952be2cd)
- `services/color.ts`: `focusColor(primary, surfaces)` returns the primary unchanged when it clears 3:1 on every surface. Otherwise it steps the primary darker (light surfaces) or lighter (dark surfaces) by 5% until it does, falling back to `#1a1a22` / `#f4f4f6`. There are 4 new vitest cases, and all 16 tests in `color.test.ts` pass.
- `settings.svelte.ts`: new `THEME_SURFACES` map (bg, surface-2 per theme, marked KEEP IN SYNC with app.css). `applyTheme()` sets `--color-focus`.
- `app.css`: the `:root` default is `--color-focus: var(--color-primary)`.
- 12 focus rules switched to `var(--color-focus)`: search `.bar input:focus`/`:focus-visible`, TrackMenu `.edit-cell`, SupporterSheet `.switch`, RowActionsConfig `.wing`/`.slot`/`.cfg-opt`, NpPreviewEditor `.wing`, settings/account `.field input:focus`, and settings/downloads `.cta`/`.txt`/`.chip…`. A multi-line CSS rule scan (selector contains `focus`, body contains `color-primary`) found two more than the plan listed: RowActionsConfig and NpPreviewEditor.
- `DESIGN.md`: added the Focus bullet under Colors → Primary and the matching Do rule.

## Task 2: search page (f75739e6)
- `statusMsg` is now: searching (loading or first skeleton) → `search.empty` (0 results) → `search.resultsCount` `{n}` (results > 0). `search.noMore` stays on the visible end note only.
- `search.resultsCount` is in all **15** locale files, placed after `search.noMore`, double quotes, real translations.
- The skeleton `<li>` is `aria-hidden="true"`. Removed its aria-label, the `.vh` span and the snippet's `label` param from both call sites.
- `.row.active`: added `box-shadow: inset 0 0 0 2px var(--color-focus)`.

## Verification
- `pnpm test`: 241 files, 5137 tests, all pass.
- `pnpm check`: 3 errors, all the known missing-module ones (`posthog-js`, `@codetrix-studio/capacitor-google-auth` x2). No new errors and no warnings in touched files.
- Not visually checked in a browser.

## Deviations
- The plan said 16 locale files, but the repo has 15. All 15 were updated, and i18n parity passes.
- `SettingPicker .mock :global(.mock-focus)` was left on `--color-primary`. It is a drawn mock illustration, not a real focus indicator.
- `search.loadingMore` is no longer used on the search page but is still used on the artist page, so the key stays.
