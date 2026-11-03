---
phase: quick-261102-syk
plan: 01
status: complete
subsystem: home-ui
tags: [home, grid, a11y, css]
key-files:
  modified:
    - src/lib/components/shelf-scroll.ts
    - src/lib/components/shelf-scroll.test.ts
    - src/lib/components/HomeGridPager.svelte
    - src/routes/(app)/+page.svelte
commits: [aa25b090, c1a59ed5, 6f364e19]
completed: 2026-11-02
---

# Quick 261102-syk: Home audit P2/P3 Summary

Desktop grid shelves page 2 rows (mobile stays 3x3), grid and pile song tiles get a hover/keyboard ⋮, the placeholder uses the real grid maths, and tile text, radii, rail inset and hit area are polished.

## Commits
- `aa25b090` feat: `gridRowsPerPage(cols)` (3 at the 3-column floor, 2 when wider), with tests; HomeGridPager `tilesPerPage = cols * gridRowsPerPage(cols)` (C)
- `c1a59ed5` feat: `tileMenuBtn` snippet + `.tilewrap` on all 5 song-tile sites; grid placeholder sized from `gridColumns(phWidth)` (B, F)
- `6f364e19` fix: scrim plateau + text-shadow + full-opacity artist line (A); SOY rail flush (D); 8px pile/placeholder covers, `--radius-sm` skeleton bars (E); 48px Randomize/Retry hit (G)

## Notes
- `.q` quality badge moved to top-LEFT (the ⋮ took top-right). Its 4px radius / 0.5rem size was left off-scale on purpose: it is a micro badge.
- Removed the stray second `>` after `librarySongRow`'s button opening tag (it rendered as a literal text node).
- G root cause: `* { box-sizing: border-box }` puts the 1px border inside the 40px box, so an absolute `::after` resolves against the 38px padding box. `inset: -4px` gave 46, `-5px` gives 48.
- Placeholder grid rule is `.ph .grid.ph-grid` (0,3,0) so it also beats `.section.compact .grid`'s 8px gap and matches HomeGridPager's fixed 10px gap.

## Verification
- `pnpm test -- src/lib/components src/lib/services/home-layout src/lib/i18n`: 9 files, 198 tests passed.
- `pnpm check`: 0 errors, and no warnings in the 4 touched files. One mid-run error came from `src/routes/(app)/+layout.svelte` (another session's uncommitted edit, not ours); it was gone on the final run.
- All plan verify greps pass. HomeGridPager has `gridRowsPerPage(cols)` exactly once.
- Not checked visually: no browser was available to this executor. Not seen: 2-row shelf at 1280px, the ⋮ on hover/Tab, no ⋮ on touch, scrim on a light cover, SOY alignment.

## Deviations from Plan
None. The HomeGridPager header comment says "cols × that row count" rather than quoting `gridRowsPerPage(cols)`, so the plan's count-equals-1 grep still holds.
