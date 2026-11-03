---
phase: quick-261102-rrb
plan: 01
status: complete
subsystem: ui/search, theme
tags: [a11y, contrast, theme, search, combobox]
requirements: [AUDIT-SEARCH-261102]
key-files:
  created: []
  modified:
    - src/lib/services/color.ts
    - src/lib/services/color.test.ts
    - src/lib/stores/settings.svelte.ts
    - src/app.css
    - src/routes/(app)/search/+page.svelte
    - 28 other .svelte files (on-primary sweep, listed below)
decisions:
  - "--color-on-primary = whichever of #0b0b0f / #ffffff has higher WCAG contrast vs the effective primary; :root default #0b0b0f (tiffany)"
  - "#7c5cff and #ff0033 resolve to dark text by the math (4.52 vs 4.35; 4.96 vs 3.96) — test asserts the computed pick, as the plan allowed"
  - "Light --color-border #c5c5cf -> #80808a (3.32:1 vs #ececf2)"
completed: 2026-11-02
---

# Quick 261102-rrb: Search page audit fixes Summary

The search page now meets the audit: text on the primary colour uses a WCAG-picked `--color-on-primary` token across the app. Skeletons and borders show on the light theme. The typeahead is a working ARIA combobox with keyboard navigation, search status is announced through a polite live region, and artist avatars load lazily.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | a883a85a | `contrastRatio`/`onColor` in color.ts + 6 tests; applyTheme sets `--color-on-primary`; :root default; 43 rules swept |
| 2 | fee7cb0a | theme-safe global `.sk`; light border #80808a; search skeleton on `.sk` + `.sk-line`; focus-visible ring; 44px clear-history |
| 3 | 241f26c3 | type=search + aria-label + combobox/listbox/option + activedescendant; Arrow/Enter/Escape; kind cue; live region; lazy `<img>` avatars |

## On-primary sweep

Changed (`color: #fff` -> `var(--color-on-primary)` where the same rule has a primary background, including `var(--color-primary, fallback)`). There are 43 rules:
Nowbar `.np-btn`; NpComments `.post`; SettingPicker `.seg button.on`, `.mock-badge`; SoyYearStrip `.ypill.active`; SupporterSheet `.cta`, `.vbtn`; SyncReviewModal `.rm-btn.primary`; ToastHost `.toast .act`; YearSelector `.ypill.active`; (app)/+layout `.update-btn`, `.notice-toast .retry`; album `.offline-cta`, `.act.play`; artist `.act.play`, `.offline-cta`; artist/albums `.act.play`, `.chip.on`; charts cantopop/jpop/kpop/mandopop/western/songs-of-year `.act.play`; charts/top `.tab[aria-pressed]`, `.offline-cta`; library `.edit-btn[aria-pressed]`, `.tabs button.active`; search `.bar button`, `.offline-cta`; settings `.chip.on`; settings/account `.send`; settings/downloads `.cta`, `.chip.on`; settings/home `.dseg-btn.on`, `.chip.on`, `.advanced .chip.on`; settings/playback `.chip.on`; settings/translation `.chip.on`, `.advanced .chip.on`, `.tab.on`; supporters `.cta`; auth/magic `.home`.

Skipped (not white-on-primary in the same element): ToastHost `.toast` / layout `.notice-toast` / downloads `.flash` (white on #000); TrackMenu `.cand .src` / `.cand .tick` (white on scrim/image); switch thumbs in SupporterSheet / downloads (a white knob is a separate element on the primary track, not text); VersionPicker `.src` (a false hit on `white-space`); NowPlaying `.play` (white fill, dark text). I also ran a second scan for child selectors under primary-filled parents and inline `style` primary fills. It found nothing.

## Light border

`#80808a`, 3.32:1 against `#ececf2`. The `color.test.ts` test asserts it is at least 3:1.

## Verification

- `pnpm vitest --run src/lib/services/color.test.ts`: 12/12 passed.
- T2 grep verify: no `skel-shimmer` or `rgba(255, 255, 255, 0.11)` remains, focus-visible is present, and the 44px count is 1.
- `pnpm test`: 241 files and 5133 tests passed.
- `pnpm check`: **3 errors remain. All existed before this change and come from the environment.** `posthog-js` (src/lib/posthog.ts:44) and `@codetrix-studio/capacitor-google-auth` (auth.svelte.ts:415, settings/account/+page.svelte:201) are declared in package.json but missing from `node_modules`. I did not run `pnpm install` because the tree is shared with other sessions. The search page has no errors or warnings.
- Not verified: I did not check anything in a browser (light-theme skeleton, focus ring, arrow-key highlight, screen-reader announcement).

## Deviations from Plan

- **[Rule 2] Avatar `onerror` hides the `<img>`.** A failed photo now falls back to the gradient instead of showing a broken-image glyph.
- **Escape `preventDefault`.** Escape calls `preventDefault` while the typeahead is open, so `type=search` does not also clear the typed text natively. When the typeahead is closed, Escape keeps the native search-field behaviour.
- `activeIdx` is reset with one `$effect` on `suggestions`, not at each of the 5 assignment sites. The plan allowed either.
- `statusMsg` is declared after `hasMore`. This fixes a block-scoped use-before-declare error.

## Known Stubs

None.
