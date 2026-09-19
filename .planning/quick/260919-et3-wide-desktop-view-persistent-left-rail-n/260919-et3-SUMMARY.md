---
phase: quick-260919-et3
plan: 01
subsystem: ui-shell
tags: [desktop, responsive, navigation, accessibility, css]
requires: []
provides:
  - "--rail-w design token"
  - "@media (min-width: 1024px) desktop layer"
  - "ShelfChevrons component"
  - "nextScrollLeft / canScroll pure helpers"
  - "breakpoint-inventory invariant test"
affects:
  - "src/routes/(app)/+layout.svelte"
  - "src/lib/components/Nowbar.svelte"
  - "src/routes/(app)/+page.svelte"
  - "src/lib/components/HomeGridPager.svelte"
tech-stack:
  added: []
  patterns:
    - "one media-query layer, mobile cascade untouched"
    - "pure helper + co-located node test, thin component caller (dragScroll.ts shape)"
key-files:
  created:
    - src/lib/components/ShelfChevrons.svelte
    - src/lib/components/shelf-scroll.ts
    - src/lib/components/shelf-scroll.test.ts
    - src/lib/styles/breakpoints.test.ts
  modified:
    - src/app.css
    - src/routes/(app)/+layout.svelte
    - src/lib/components/Nowbar.svelte
    - src/routes/(app)/+page.svelte
    - src/lib/components/HomeGridPager.svelte
decisions: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9, D-10]
metrics:
  duration: ~12 min
  completed: 2026-09-19
---

# quick-260919-et3: Wide desktop view — persistent left rail Summary

At >=1024px the bottom tab bar becomes an 88px left rail (the same `<nav>`, restyled by media
query), content widens from a 720px column to 1920px, the nowbar drops to the floor starting at
the rail edge, and home shelves get pointer chevrons that page them by 80% of their width. Below
1024px the only deltas are one `aria-current` attribute and one `display: none` element per shelf.

## Gates

| Gate | Baseline (2ea3e5d) | After |
|---|---|---|
| `pnpm check` | 4549 files, 0 errors, 0 warnings | 4553 files, **0 errors, 0 warnings** |
| `pnpm test` | 135 files / 2788 tests passed | **137 files / 2802 tests passed** |

+2 test files, +14 tests, all mine (3 breakpoint-inventory, 11 shelf-scroll). No pre-existing
test changed state, so nothing needed attributing to the other agents working in this repo today.

## The mobile-safety audit (pasted output)

This is the only evidence that mobile is untouched — Vitest here runs without jsdom and cannot
render a layout. The audit parses each touched file, computes which line ranges sit inside an
`@media (min-width: 1024px)` block, and reports every CSS rule/declaration line this task ADDED
that falls outside one.

```
MOBILE-SAFETY AUDIT — CSS added outside @media (min-width: 1024px), 2ea3e5d..HEAD
==============================================================================

src/app.css: 1 rule/declaration line(s) outside the desktop media query
   L34: --rail-w: 88px;

src/lib/components/HomeGridPager.svelte: 0 rule/declaration line(s) outside the desktop media query

src/lib/components/Nowbar.svelte: 0 rule/declaration line(s) outside the desktop media query

src/lib/components/ShelfChevrons.svelte: 3 rule/declaration line(s) outside the desktop media query
   L120: .chevs {
   L121: display: none;
   L122: }

src/routes/(app)/+layout.svelte: 0 rule/declaration line(s) outside the desktop media query

src/routes/(app)/+page.svelte: 0 rule/declaration line(s) outside the desktop media query

==============================================================================
TOTAL: 4
```

**Result: exactly the two sanctioned CSS exceptions, nothing else.** `--rail-w` is an inert custom
property (declaring it changes no rendering; only the desktop block reads it), and
`.chevs { display: none }` is what makes the chevrons free on mobile — not rendered as boxes, not
focusable, not in the accessibility tree.

The third sanctioned exception is not CSS, so a second pass audited the markup/script delta in the
four pre-existing files:

```
MARKUP / SCRIPT DELTA in pre-existing files (outside <style>)

src/routes/(app)/+layout.svelte: 1 substantive line
   L249: <a class="tab" class:active href={tab.href} aria-current={active ? 'page' : undefined} use:tapBounce>

src/routes/(app)/+page.svelte: 5 substantive lines
   L6:    import ShelfChevrons from '$lib/components/ShelfChevrons.svelte';
   L825/876/944/1002: <ShelfChevrons />

src/lib/components/Nowbar.svelte: 0
src/lib/components/HomeGridPager.svelte: 0
```

So the complete mobile-visible delta of this task is: one `aria-current` attribute (additive, an
accessibility improvement at both sizes) and one `display:none` element after each of the four
home shelves. Nothing else on a phone moved.

### The audit's own first run was wrong, and that matters

The first version of the audit reported `src/app.css: 0` — it had silently swallowed `--rail-w`.
Cause: `app.css`'s new explanatory comment contains the literal string `@media (min-width: 1024px)`
in prose, and the parser did not strip comments, so it treated that sentence as a real media block
and marked every following line as "desktop, therefore safe". A mobile-safety audit that fails
toward "clean" is worse than none. Fixed by blanking `/* */` comments (preserving newlines so line
numbers stay accurate) before locating media blocks; the same guard is baked into
`breakpoints.test.ts`, which had it from the start. Both numbers above come from the corrected run.

## Other verification

- **One navigation source of truth**: `src/routes/(app)/+layout.svelte` still has exactly one
  `<nav>` element and one `const tabs` array. No second nav component, no shared nav-config
  module, no `matchMedia` in JS deciding layout. Keyboard and screen-reader parity is therefore
  structural, not re-implemented — the rail is literally the same landmark with the same anchors
  in the same DOM order.
- **Breakpoint inventory**: `breakpoints.test.ts` scans all 45 `.svelte`/`.css` files under `src/`
  and asserts the distinct set of width breakpoints is exactly `{640, 1024}`. It passes, and it
  names file:line on a future breach.
- **Off-limits files**: `git diff --name-only 2ea3e5d..HEAD | grep -E "settings/|i18n/|android/"`
  → `none`. Zero i18n edits, zero settings edits, zero new dependencies.
- **Deviation from the plan's `grep -c "min-width: 1024px"` == 6 prediction**: the real count is 7
  media blocks across 5 files. Two of them are `@media (min-width: 1024px) and (hover: hover)`
  (layout + ShelfChevrons) rather than nested inside the main block. The plan assumed
  `+layout.svelte` already used `@media (hover: hover)` and a nested block would fit the house
  style; it does not use one at all, and a separate combined query is the boring choice that needs
  no CSS-nesting support. The invariant that actually matters (the distinct breakpoint SET) is
  enforced by the test, not by this count.

## Decisions as shipped

| | As shipped |
|---|---|
| **D-1** breakpoint | `min-width: 1024px`, the `lg` rung of the scale 640 already sits on. iPad portrait (820px) stays mobile; iPad landscape (1024px) gets the rail. |
| **D-2** one nav | Same `<nav class="tabbar">`, restyled. No second component, no JS media query. |
| **D-3** rail shape | 88px, icon-over-label, the three existing tabs. Nothing else in the rail. |
| **D-4** a11y | `aria-current="page"` on the active tab. No `aria-label` on the nav, no new strings. |
| **D-5** content cap | 1920px + 24px gutters above 1024. `ponytail:` hard cap; revisit on a real ultrawide. |
| **D-6** nowbar | `left: var(--rail-w); bottom: 0` behind `:not(.embed)`. NowPlaying untouched. |
| **D-7** search | Unchanged — `/search` stays a rail destination with its own in-page input. |
| **D-8** shelf density | `.grid` → `auto-fill minmax(150px × --cover-scale, 1fr)` at desktop; HomeGridPager capped at `repeat(3, minmax(0, 220px))`; `.albumrow` + CompactPager verified as needing nothing and commented so. |
| **D-9** reduced motion | Nothing to gate on the rail swap (a restyle, not a state change). Honoured in the chevron scroll: `behavior: 'auto'` under `prefers-reduced-motion: reduce`. |
| **D-10** i18n | Zero dictionary edits. Chevrons reuse `nowplaying.previous` / `nowplaying.next`. |

## What I deliberately did NOT do at desktop width

1. **No desktop now-playing redesign.** No two-pane layout (cover left, queue + lyrics right), no
   desktop transport variant, no restructuring of `NowPlaying.svelte`. Tapping the nowbar at
   1440px still opens the same full-screen sheet, which still covers the rail. Reason: CLAUDE.md
   flags `NowPlaying.svelte` (~2000 lines) as a re-render hotspot that should be SPLIT, and adding
   a desktop branch inside it is precisely how it reached that size. A desktop now-playing is its
   own task, and it should start by splitting the file.
2. **No persistent header search field.** `/search` stays a rail destination with its own input.
   A header search is a new always-mounted surface with its own state, focus management and
   strings, duplicating the search page's input — a feature, not a responsive adjustment.
3. **No desktop pagination change in `HomeGridPager`.** `TILES_PER_PAGE = 9` is JS, and changing it
   per-viewport changes behaviour, not layout. The page geometry is capped instead so the dot
   indicator keeps describing what it actually renders.
4. **Two known cosmetic leftovers, left alone on purpose.** `settings/data` and
   `settings/downloads` each place a `.flash` toast at `bottom: calc(var(--tabbar-h) + 70px)`,
   which at desktop floats 56px higher than needed. Those files belong to another agent right now
   and it is a toast offset, not a defect.

## Assumption Drift (advisory)

1. **`--shelf-h` cannot be measured once on mount.** The plan specified a single mount-time read of
   the shelf's `offsetHeight` ("tile height is CSS-fixed, so a ResizeObserver would be ceremony").
   In reality the home shelves populate asynchronously from discovery data, so at mount the target
   is an empty 0px-tall row — a single read would leave every chevron mispositioned and permanently
   disabled. Shipped with a `ResizeObserver`, which fires once on `observe` and again when tiles
   land, covering both the measurement and the enabled state with one mechanism (fewer moving parts
   than a mount read plus a retry), plus a `pointerenter` re-sync for tiles appended to an
   already-tall shelf.
2. **Chevron vertical centring formula.** The plan gave `top: calc(-1 * var(--shelf-h) / 2)`, which
   omits the button's own 36px and would hang it below the shelf midline. Shipped as
   `calc((var(--shelf-h, 160px) + 36px) / -2)`. Unverifiable from this sandbox either way — see the
   browser checklist.
3. **`+layout.svelte` has no `@media (hover: hover)` to match.** The plan said the file already
   used that idiom; it contains no media query at all. Used a separate
   `@media (min-width: 1024px) and (hover: hover)` block (the idiom other components do use).

## Deviations from Plan

**1. [Rule 2 — missing critical functionality] `ResizeObserver` instead of a one-shot mount measure**
- **Found during:** Task 6
- **Issue:** async shelf population means a mount-time `offsetHeight` read returns 0.
- **Fix:** observe the target; `measure()` sets `--shelf-h` and re-syncs the disabled state.
- **Files:** `src/lib/components/ShelfChevrons.svelte` · **Commit:** 7279272

**2. [Rule 1 — bug] chevron `top` calc omitted the button's own height**
- **Found during:** Task 6 · **Fix:** `calc((var(--shelf-h, 160px) + 36px) / -2)` · **Commit:** 7279272

**3. [Rule 1 — bug] the mobile-safety audit's first run failed toward "clean"**
- **Found during:** Task 7 · see the section above · not a product-code change.

**4. [Rule 3 — blocking] `breakpoints.test.ts` file-count floor**
- **Found during:** Task 1. The empty-scan guard was written as `> 50`; there are 45 style files.
  Lowered to `> 30` with the real count recorded in a comment. **Commit:** 85d7a9b

No Rule 4 (architectural) situations arose. No auth gates. No package installs.

## NEEDS A REAL BROWSER AT A REAL WINDOW SIZE

**Nothing below was observed.** Everything in this task is layout, and this environment cannot
render one: Vitest runs node-only with no jsdom, the in-app browser pane has a known frozen-rAF
problem (0 rAF callbacks, so transitions and rAF-deferred work never complete), and the CN upstream
sources that populate the home shelves are blocked in this sandbox, so even a served page would
show empty shelves. The audit above proves what did not change; only a browser can confirm what
did. Full list:

1. **The rail at >=1024px** — it is pinned to the left edge, full height, 88px wide, with a right
   border. The three tabs sit at the TOP stacked vertically and do **not** stretch over 100dvh
   (the `flex: none` override is the thing being checked). Hover highlights a tab on a mouse.
   `Tab` reaches all three links in DOM order, and a screen reader announces the navigation
   landmark with the active item marked current.
2. **Content width** — fills a 1440px window edge to edge (no 720px centre column), and stops at
   1920px on anything wider rather than stretching a CompactRow across an ultrawide.
3. **The nowbar** — starts exactly at the rail's right edge (no gap, no overlap), sits flush on the
   bottom of the window, and expanding to the full-screen now-playing and collapsing again still
   works. Confirm the embedded bar INSIDE the now-playing sheet is unmoved (the `:not(.embed)`
   guard).
4. **Shelves** — an `.albumrow` shows roughly 13 tiles instead of ~5; the fallback `.grid` shows 8+
   tiles per row at phone tile size; the 3x3 speed dial keeps 3 columns of ~220px with a truthful
   dot indicator. Chevrons: appear only on shelves that actually overflow, are **vertically centred
   on the shelf** (deviation 2 above), page by ~80% of the width, left disabled at the start, right
   disabled at the end, and instant rather than smooth under `prefers-reduced-motion: reduce`.
5. **The 1023 / 1024 boundary** — drag the window across it: nothing should jump, flash or
   double-render, and at 1023px the bottom tab bar, 720px column and hidden chevrons must be
   exactly today's mobile layout. Confirm a landscape phone (844–932px) is definitively on the
   mobile layout.
6. **iPad landscape at exactly 1024px** — the accepted edge of D-1. The rail appears here; confirm
   it is usable by touch at 88px, that the `(hover: hover)` gate prevents a sticky hover latching
   on the last-tapped tab, and that the rail's re-stated `padding-bottom` (no safe-area inset)
   does not clip anything.
7. **Regression sweep on a real phone** — not because anything here targets mobile, but because
   nine quick tasks landed today and this one touched the app shell. Confirm the bottom bar,
   nowbar docking and home shelves are unchanged.

## Self-Check: PASSED

All created files exist on disk; all commit hashes resolve in `git log`.

| Task | Commit | Files |
|---|---|---|
| 1 breakpoint + token + inventory test | `85d7a9b` | app.css, (app)/+layout.svelte, styles/breakpoints.test.ts |
| 2 tab bar → left rail | `14b326d` | (app)/+layout.svelte |
| 3 nowbar rail-to-edge | `ffbe24a` | Nowbar.svelte |
| 4 wide shelves | `c1e8bd1` | (app)/+page.svelte, HomeGridPager.svelte |
| 5 RED shelf-scroll test | `e70e34c` | shelf-scroll.test.ts |
| 5 GREEN shelf-scroll impl | `9876c4b` | shelf-scroll.ts |
| 6 desktop chevrons | `7279272` | ShelfChevrons.svelte, (app)/+page.svelte |
