---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 10
subsystem: settings
tags: [settings, home-layout, charts, accessibility, ui]

requires:
  - phase: 39-02
    provides: "reorderListed, resolveChartRegion/resolveExtraRegions/resolveChartGenres, CLASSIC_SECTIONS, CHART_REGIONS, KKBOX_REGIONS, CHART_GENRE_IDS"
  - phase: 39-05
    provides: "regionLabel, regionListLabel, CHART_GENRE_LABEL in src/lib/services/home-charts.ts"
  - phase: 39-06
    provides: "settings.homeChartRegion / homeExtraRegions / homeChartGenres + the 36 new i18n keys"
  - phase: 39-07
    provides: "Home renders the chart shelves and the classic shelves from the same settings"
provides:
  - "/settings/home redesigned per UI-SPEC §2: one global drag list (13 non-classic rows + source lines), Charts group (Chart region, More regions, Genres), collapsed Classic (Last.fm / Deezer) accordion, unchanged global controls"
  - "role=switch + aria-checked on every visibility switch; aria-pressed on every chip; role=group on the chart-region chip set"
affects: [phase 39 verification, VALIDATION manual row "settings/home shows Charts / Library / Classic groups"]

tech-stack:
  added: []
  patterns:
    - "Page-local `densitySeg(id)` snippet shared by the drag list and the Classic rows instead of two copies of the density segment"
    - "Exhaustive `switch` over HomeSectionId for per-row source lines, so a new section id is a compile error"

key-files:
  created: []
  modified:
    - src/routes/(app)/settings/home/+page.svelte

key-decisions:
  - "39-10: the Auto chip / Auto label resolve `resolveChartRegion('auto', …)` separately from the effective region, so 'Auto (US)' stays truthful while an explicit region (e.g. Taiwan) is saved"
  - "39-10: the onReorder → reorderListed switch shipped in the SAME commit as the template that iterates `listed`, because the drag indices only mean 'listed index' once the template renders `listed`; the first commit was purely additive"
  - "39-10: the Classic `.cur` keeps sentence case ('Off' / '1 on') inside the uppercase Classic summary; the accordion keeps the Playback 22px margin (UI-SPEC §Spacing)"
  - "39-10: tapBounce only on the single-select chart-region chips; the draggable More regions / Genres chips follow the existing countries-chip idiom (no bounce), since the bounce keyframe would override chipReorder's inline drag transform"

patterns-established:
  - "Settings accordions for long single/multi-select lists: copy the translation page's `.advanced` block and step inner rows/chips down to --color-bg"

requirements-completed: [P39-10, P39-05, P39-11]

duration: 11min
completed: 2026-09-26
---

# Phase 39 Plan 10: Home layout settings redesign Summary

/settings/home is now one global sections list with source lines, a Charts group (Chart region, More regions, Genres) and a collapsed Classic (Last.fm / Deezer) accordion. The classic accordion keeps the four old shelves and their tag/country chips fully working. Every switch and chip exposes its state to assistive tech.

## Performance

- **Duration:** ~11 min
- **Started:** 2026-09-26T04:05Z
- **Completed:** 2026-09-26T04:16Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Drag list iterates `listed` (13 non-classic rows). Each row shows its source line (`KKBOX · Apple Music` / `Apple Music` / `YouTube` / `Apple Music · Deezer` / "Your library" / "Not available in {region}"). Reorder goes through `reorderListed`, so classic ids keep their exact array slot.
- Charts group:
  - Chart region: single-select accordion with an Auto chip plus 27 regions in the fixed order, `role=group`, `aria-pressed`, current value `Auto (…)` or the region name.
  - More regions: multi-select accordion, selected-first and draggable, current value from Intl.ListFormat or "None".
  - Genres: always-visible chips; an empty selection shows "None selected — no genre shelves on Home".
- Classic accordion is collapsed by default, with current value "Off" or "{n} on". It holds four rows (no grip), each with its density segment and a switch, plus the moved tag and country chip pickers. The old top-level Genres (Tags) and Countries sections are gone.
- Items per shelf, grid columns, landing tab, tile density and home chrome are untouched (SettingPicker count 8 → 8).

## Task Commits

1. **Task 1: Script state, handlers, labels, source lines** - `4f7e202` (feat)
2. **Task 2: Template + CSS + onReorder switch** - `d041f8c` (feat)

## Files Created/Modified
- `src/routes/(app)/settings/home/+page.svelte` - redesigned Home layout settings page (script state + handlers, three new groups, accordion CSS, a11y attributes)

## Verification (observed)
- `pnpm check`: 0 errors, 0 warnings (after each task).
- `pnpm vitest --run src/lib/i18n/i18n.test.ts src/lib/services/home-layout.test.ts`: 2 files, 110 tests passed.
- `pnpm test`: 151 files, 3244 tests passed. `pnpm build` (adapter-cloudflare): done.
- Acceptance greps, all met:
  - `<details class="advanced` = 3 and `class="advanced classic"` = 1.
  - `role="switch"` = 2, `aria-checked` = 3, `aria-pressed` = 13, and the region `role="group"` line = 1.
  - `{#each listed as` = 1, `{#each order as` = 0, `class="rsub"` = 2, `.rsub {` present.
  - `<Tags ` = 0, `homeCountriesLabel` = 0, `as TranslationKey` = 0.
  - Brand-literal lines = 5, and 3 settings writes are each followed by `save()`.
- E2E: headless Chromium over raw CDP against the running :5173 dev server, fresh profile, 375px mobile viewport. 35/35 checks passed:
  - Page structure:
    - Headings are "Sections & order", then "Charts".
    - 13 listed rows, none of them classic, each with a source line and a `role=switch` with `aria-checked`.
    - 3 accordions, all collapsed.
    - Current values: "Auto (US)", "None", "Off" (rendered "Off", not uppercased).
    - The 4 classic rows have no grip and read Deezer, Deezer, Last.fm, Last.fm.
    - All 107 chips carry `aria-pressed`.
    - The region group has label "Chart region" and 28 chips.
    - 8 of 11 genres are on by default.
  - Chart region:
    - Tapping Taiwan persists `homeChartRegion: "tw"` and the current value reads "Taiwan".
    - The Auto chip still reads "Auto (US)".
    - Top songs shows `KKBOX · Apple Music` and New releases shows `KKBOX`.
    - Taiwan drops out of the More regions pool.
    - Tapping US makes New releases read "Not available in US".
  - More regions and Genres:
    - More regions Japan + South Korea persists `["jp","kr"]` and reads "Japan, South Korea".
    - Deselecting all genres persists `[]` and shows the None hint; re-selecting persists `["cantopop"]`.
  - Drag and Classic:
    - A real pointer drag moves Liked songs below Your Radio.
    - One 17-id order is persisted, and every classic id keeps its exact index.
    - Turning on Top hits in Classic makes the current value "1 on" and removes `top-hits` from `homeHidden`.
  - Home after the changes:
    - Titles carry "· Taiwan", and "Top songs · Japan" / "Top songs · South Korea" shelves render.
    - The Top hits shelf renders with its See-all `.subhead-nav`.
    - Deezer / charts requests fire.
- Screenshot at 375px, reviewed by eye: layout matches UI-SPEC §2.1-2.4. `.rsub` cuts off with "…" as specified ("KKBOX · Apple Mu…").
- Not checked: the zh-Hant "Auto (香港)" case in the browser. That case needs a `navigator.language` with no region subtag, and headless reports en-US. The resolver order is covered by `home-layout.test.ts`.

## Decisions Made
See key-decisions in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Auto chip label named the saved region instead of the Auto region**
- **Found during:** Task 1
- **Issue:** The plan labelled the Auto chip `chartRegionAuto` with `regionName(chartRegion)`. `chartRegion` is the effective region, so with Taiwan saved the Auto chip would read "Auto (Taiwan)", which is not what Auto would pick.
- **Fix:** Added `autoRegion = resolveChartRegion('auto', appLang, navLang)`. The shared `autoLabel` feeds both the Auto chip and the current value when saved is 'auto'. Observed in E2E: with Taiwan saved, the Auto chip still reads "Auto (US)".
- **Files modified:** src/routes/(app)/settings/home/+page.svelte
- **Commit:** 4f7e202

**2. [Rule 3 - Blocking / deploy safety] onReorder switch moved from the Task 1 commit to the Task 2 commit**
- **Found during:** Task 1
- **Issue:** `main` auto-pushes and auto-deploys. With `reorderListed` in the Task 1 commit, the old template would still iterate the full `order`, so drag indices would be misread and would move the wrong row in production until Task 2 landed.
- **Fix:** The Task 1 commit is purely additive (new state, handlers, labels; old `onReorder` kept). The `onReorder → reorderListed(order, from, to)` change landed in the Task 2 commit together with `{#each listed}`. Both commits render and behave correctly on their own. Task 1's acceptance grep for `reorderListed(order, from, to)` is satisfied at `d041f8c`, not `4f7e202`.
- **Commit:** d041f8c

**3. [Rule 2 - UI-SPEC conformance] Classic accordion margin + `.cur` casing**
- **Found during:** Task 2
- **Issue:** The plan copies the translation `.advanced` rule (margin 10px 0) and applies the Playback uppercase summary to Classic. UI-SPEC §Spacing says the Classic accordion keeps the Playback 22px margin. The uppercase summary would also have turned the current value into "OFF" / "1 ON".
- **Fix:** Added `.advanced.classic { margin: 22px 0; }` and `.advanced.classic .cur { text-transform: none; letter-spacing: normal; }`. Observed "Off" / "1 on" rendered in E2E.
- **Commit:** d041f8c

### Implementation notes (no behaviour change vs plan)
- The density segment is rendered from one page-local `densitySeg(id)` snippet used by both lists, rather than duplicating its ~20 lines.
- `sourceLine` is an exhaustive switch (explicit library cases, no `default`), so TypeScript flags any future section id.

---

**Total deviations:** 3 auto-fixed (1 bug, 1 deploy-safety ordering, 1 spec conformance). **Impact:** no scope change. Every intermediate commit renders /settings/home correctly.

## Issues Encountered
- Two E2E checks failed on the first run because of bugs in the test script, not the page. Eight synchronous chip clicks fired before Svelte flushed the DOM, and the classic shelf heading is a `.subhead-nav` button, not an `<h3>`. After fixing the script, all 35 checks passed.

## Known Stubs
None.

## User Setup Required
None.

## Next Phase Readiness
- Phase 39's settings surface is complete (plan 10 of 10). Ready for phase verification. The VALIDATION manual row "un-hiding a classic section makes it fetch + render" passed in the E2E above.

## Self-Check: PASSED
- FOUND: src/routes/(app)/settings/home/+page.svelte
- FOUND: 4f7e202, d041f8c
