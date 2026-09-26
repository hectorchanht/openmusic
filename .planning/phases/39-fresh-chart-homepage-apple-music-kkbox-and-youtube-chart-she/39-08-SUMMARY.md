---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 08
subsystem: home
tags: [charts, home, placeholders, skeleton, progressive-mount, layout-stability]

requires:
  - phase: 39-07
    provides: "runChartTasks, chartGen, chartTasks(), plannedKeys(), sampled*(key), hasPool(key), genreShelves, regionShelves, shelfCount(id), hasAnyContent(), compactSkeletonColumn"
provides:
  - "inflight SvelteSet of pool keys a visible refresh is fetching"
  - "isPlanned(key), anyPlaceholder, hasItems(key)"
  - "shelfPlaceholder(density, round) snippet wired into all seven chart sections"
  - "shelfCount counts planned chart shelves and no longer counts empty classic/library singles"
affects: [39-09 one-time switch, 39-10 settings/home]

tech-stack:
  added: []
  patterns:
    - "Placeholder ownership is an explicit runChartTasks(…, placeholders) flag, not derived from the per-key apply predicate"
    - "inflight key cleared in a per-group finally, in the same tick as the pool write"

key-files:
  created:
    - .planning/phases/39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she/deferred-items.md
  modified:
    - src/routes/(app)/+page.svelte

key-decisions:
  - "39-D-37: in-flight pool keys live in a SvelteSet (a plain Set is not proxied by $state). Only the visible refresh fills it, through an explicit placeholders flag on runChartTasks; the silent revalidate never does, so a warm load never shows a placeholder"
  - "39-D-37: one delete in a per-group finally covers landed, settled-empty and superseded groups (T-39-33); ceiling: two overlapping visible refreshes share the Set, so the older one settling drops the newer one's placeholder early (cosmetic)"
  - "39-D-38: shelfPlaceholder reuses compactSkeletonColumn, .compact-skel-pager, .albumrow, .grid and .cs-bar; the new CSS adds no font-size and no colour"
  - "Empty classic and library singles (top-hits, top-artists, liked, downloads, history, radio, fav-artists) count 0 in shelfCount, the same rule as the chart singles, so a fresh profile's first reveal slots go to chart placeholders"

requirements-completed: [P39-07]

duration: 12min
completed: 2026-09-26
---

# Phase 39 Plan 08: Per-shelf loading placeholders Summary

**Each chart shelf that is being fetched and has nothing to show now holds its slot with a placeholder matched to its density: a 44px heading bar, then two skeleton list columns, four cover tiles or nine grid squares. The real shelf replaces the placeholder in the same slot, or the slot disappears if the fetch comes back empty. The reveal budget counts placeholders, and the global "Top picks" skeleton only shows when no placeholder is on screen.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-26T03:48:44Z
- **Completed:** 2026-09-26T04:00Z
- **Tasks:** 2/2
- **Files modified:** 1 source file, plus deferred-items.md

## Accomplishments

- **Tracking (39-D-37):** `inflight` is a `SvelteSet<string>`. `refresh()` calls `runChartTasks(tasks, ++chartGen, () => true, true)`. That adds every group key before the fan-out, and each group removes its key in a `finally`, whether it landed, came back empty or was superseded. `revalidatePools` passes no flag, so it never touches `inflight`.
- **Placeholder condition:** `isPlanned(key)` is `inflight.has(key) && !hasItems(key)`. `hasItems` is the sampled-items test that `hasAnyContent()` now shares.
- **Reveal budget:**
  - A single chart shelf counts 1 when it has items or is planned, and 0 otherwise.
  - `genreShelves` and `regionShelves` now include planned entries (`planned: boolean`), so `genreShelves.length` and `regionShelves.length` already count their placeholders.
- **Global skeleton:** now also requires `!anyPlaceholder`.
- **Render (39-D-38):** one `shelfPlaceholder(density, round)` snippet (`aria-hidden="true"`), used in seven places: the five single chart blocks (`{:else if isPlanned(key)}`; Top artists passes `round`) and the `{:else}` arm inside the budgeted genre and region loops.

## Verification (observed)

- `pnpm check`: **0 errors, 0 warnings** after each task.
- `pnpm vitest --run home-charts.test.ts`: **30 passed** (Task 1). With `i18n.test.ts` added: **63 passed** (Task 2).
- `pnpm test`: **151 files / 3236 tests passed**.
- `pnpm build` (adapter-cloudflare): `✔ done` before each commit.
- Acceptance greps:

  | Check | Result |
  |---|---|
  | lines matching `inflight` | 5 (declaration, `isPlanned`, doc comment, add, delete) |
  | `function isPlanned` | matches |
  | `anyPlaceholder` lines | 2 (derived + skeleton condition) |
  | `inflight` inside `revalidatePools` | **0** |
  | `{#snippet shelfPlaceholder` | 1 |
  | `shelfPlaceholder(` | 8 (definition + 7 call sites) |
  | `aria-hidden="true"` inside the snippet | 1 |
  | `.ph-*` selectors | 8 |
  | `font-size` count | 12 before, **12 after** |

### E2E

Setup: headless Chromium (playwright `chrome-headless-shell` 1228) over raw CDP against the running :5173 dev server. Fresh profile, 390×844 mobile, English. A page-side sampler logged the heading/placeholder sequence of `section.section` every 50 ms.

| Scenario | Observed |
|---|---|
| **Cold, hk** | 4 placeholders in the first sample (173 ms) and 13 by 252 ms (5 main + 8 genres). **No global skeleton in any sample.** Each placeholder was replaced in its own slot: Top artists (624 ms), Top albums (751), New releases (867), Top songs + Trending (1001), then the genres through about 3.5 s. |
| **Budget, before vs after the shelfCount fix** | Before, the first sample had 1 placeholder, because empty liked/downloads/radio used up all 3 initial slots. After, 4–5. |
| **Warm reload, cache written** | The cache was written about 5.5 s after the cold navigation. The reload showed **no placeholder, no skeleton and 0 chart requests**. |
| **Chart region hk → jp, cache kept** | 4 placeholders (Top songs, Top artists, Top albums and Trending for jp), and **no New releases placeholder or heading**, because jp has no KKBOX. The cached genre shelves stayed. Placeholders resolved under the "· Japan" titles, and Hong Kong items never appeared under them. Apple jp songs came back empty at about 5.3 s, and that **placeholder was removed with nothing left behind**. |
| **Warm reload then Randomize (jp)** | 0 `.ph` elements in any 50 ms sample for 6 s after the click. The tag shelves reshuffled and the button read "Loading…" while classic refetched. The one chart request was the missing `chart-songs:jp` key, fetched by the silent `revalidatePools(true)`, which showed no placeholder. |
| **Extra region tw added** | One placeholder in the regions slot, replaced in place by "Top songs · Taiwan". |
| **Classic-only config (all chart sections hidden), cold** | The global skeleton showed at 151 ms, then the classic shelves appeared. |
| **Densities (region change)** | See geometry below. |
| **Console** | 0 errors and 0 warnings in every scenario. |

Placeholder geometry by density:

| Density | Normal | `.section.compact` |
|---|---|---|
| Pile | four 130×130 tiles, r=10px | 96×96, r=10px |
| Pile, Top artists | 130×130, r=50% | 96×96, r=50% |
| Grid | nine 111×111 cells, r=12px (`--radius-md`) | 114×114 |
| List | two skeleton columns with 40×40 art | same |

In every case the heading row was 342×44 with margin `14px 16px 14px 0`, the bar was 137×12 (40%), and every node sat under `aria-hidden="true"`.

**Not verified:** the in-app Browser pane (its rAF is frozen), iOS Safari, and a real device.

## Task Commits

1. **Task 1: in-flight keys; planned-aware shelfCount and skeleton** — `d219d2b` (feat)
2. **Task 2: shelfPlaceholder snippet, seven call sites, CSS; empty singles count 0** — `2353080` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Empty library/classic sections used up the initial reveal slots**
- **Found during:** Task 2 E2E
- **Issue:** `shelfCount` returned 1 for every single section, even an empty one that renders nothing. On a fresh profile the default order starts with liked, downloads and radio, so all three `REVEAL_INITIAL` slots went to empty sections. The first chart placeholder only mounted one frame later, which misses the must-have "the first 3 reveal slots fill the viewport on a cold load". The plan had said library counts stay unchanged.
- **Fix:** top-hits, top-artists, liked, downloads, history, radio and fav-artists now count `length ? 1 : 0`, the same rule 39-07 gave the chart singles.
- **Evidence:** the first cold sample went from 1 placeholder to 4–5.
- **Commit:** 2353080

**2. [Process] The intermediate Task 1 commit rendered planned genre/region entries as a heading over an empty shelf**
- **Issue:** `d219d2b` made `genreShelves` and `regionShelves` include planned entries, but the templates only branched on `items.length` in `2353080`. During the roughly 6 minutes between the two commits, a cold load would have shown genre headings over empty pagers until the pools landed.
- **Deploy risk:** `main` auto-pushes, so that build may have gone to production briefly. The tip is correct, and the app built and loaded at both commits.

## Assumption Drift (advisory)

- **Found during:** Task 1
- **Planned:** "in `runChartTasks` when `apply` is true … `revalidatePools` (apply=false) never touches `inflight`".
- **Actual:** `apply` is a per-key predicate, not a boolean. `revalidatePools` passes `(key) => !hasPool(key)`, which is **true** for exactly the keys with nothing on screen. Tying placeholders to `apply` would have shown them on warm loads during the missing-key revalidate, which breaks UI-SPEC "Warm load … no skeleton or placeholder". It would also flash one on every visit for a shelf whose upstream keeps returning nothing.
- **Why:** placeholders are therefore owned by an explicit `placeholders` flag that only `refresh()` passes. The plan's intent holds: revalidate never touches `inflight`.

## Known Stubs

None.

## Deferred Issues

- Logged in `deferred-items.md`: chart pools are persisted only when the whole refresh settles, about 5.5 s after a cold navigation, once the classic fan-out finishes. A full reload in that window makes the next open cold again. This predates this plan (39-07) and is out of scope.

## Threat Flags

None. The only new state is page-internal. T-39-33 is mitigated as planned: keys are removed in a per-group `finally` on land, on an empty result and on supersede, and the silent revalidate never adds any. T-39-34 is mitigated: placeholders are static markup with no listeners or observers, bounded by the plan's keys.

## Self-Check: PASSED

- FOUND: src/routes/(app)/+page.svelte, deferred-items.md
- FOUND commits: d219d2b, 2353080
