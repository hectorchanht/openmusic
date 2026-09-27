---
phase: quick-260927-1fx
plan: 01
status: complete
subsystem: home / charts
tags: [home, charts, radio, see-all, tapBounce]
requires: [planChartShelves, charts.ts fetchers, buildRadio, SongRow, PageHeader, TrackMenu]
provides:
  - fetchChartPool(group, cap) + ChartPool (charts.ts)
  - poolTasks(kind, id), CHART_POOL_KINDS, CHART_POOL_LABEL, exported RegionPool / ChartPoolKind (home-charts.ts)
  - /charts/shelf/[kind]/[id] route (7 kinds)
  - /radio route
affects: [src/routes/(app)/+page.svelte]
tech-stack:
  added: []
  patterns: [shared pool fetch between shelf and see-all page, allowlisted route params derived from the planner]
key-files:
  created:
    - src/routes/(app)/charts/shelf/[kind]/[id]/+page.svelte
    - src/routes/(app)/radio/+page.svelte
  modified:
    - src/lib/services/charts.ts
    - src/lib/services/charts.test.ts
    - src/lib/services/home-charts.ts
    - src/lib/services/home-charts.test.ts
    - src/routes/(app)/+page.svelte
decisions:
  - "39-D-33 superseded: every chart shelf heading is a titleNav into /charts/shelf/[kind]/[id], which lists the whole pool (up to POOL_CAP) the shelf samples from"
  - "The home runGroup and the see-all page both call fetchChartPool, so the two show the same fused pool, and the SPA nav costs zero requests (6 h memo)"
  - "Your Radio heading opens /radio (buildRadio at the home shelf's cap, same session seed), no longer /library?tab=history"
metrics:
  duration: ~20 min
  completed: 2026-09-27
  tasks: 4
  files: 7
---

# Phase quick-260927-1fx Plan 01: Shelf titles open see-all pages Summary

Every home shelf heading is now a tappable titleNav row. The 7 chart shelves open `/charts/shelf/[kind]/[id]`, which lists the whole pool the shelf samples from through the same `fetchChartPool` the home uses. "Your Radio" opens a new `/radio` page with the same draw as full SongRows. Headings and home buttons bounce on press and dim on hover, and the chevron now sits right after the title.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | ca00f9ec | test(quick-260927-1fx): add failing tests for fetchChartPool and poolTasks |
| 1 (GREEN) | d69ddf10 | feat(quick-260927-1fx): share one chart pool fetch between the home shelf and its see-all page |
| 2 | 78d50dff | feat(quick-260927-1fx): add chart see-all route and Your Radio page |
| 3 | 053770b7 | feat(quick-260927-1fx): every home shelf title opens its see-all page |
| 4 | 12c96a0f | feat(quick-260927-1fx): press bounce and hover dim on home headings and buttons; chevron trails the title |

All commits are local on `main`. Nothing was pushed.

## Gates (observed)

- `pnpm check`: `COMPLETED 4641 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. No unused `.subhead-static` selector.
- `pnpm test`: `Test Files 165 passed (165)`, `Tests 3656 passed (3656)`.
- Task 1 RED: 9 of 75 tests failed before the implementation. GREEN: 75/75 in the two files.
- Grep gates: `{@render titleStatic` = 0, `{@render titleNav` = 17, `'/radio'` present, `fetchChartPool(group` = 1, no `function fetchTask` / `function uniqBy` in the home page.
- No i18n keys added. No dependencies added.

## E2E (dev server on 5173, headless Chrome, 390x844, en-US)

Port 4321 was down and 5173 (`pnpm dev` from this repo) was up. The Browser-pane preview tools were not available to this agent, so E2E ran through headless Chrome driven by an existing `playwright-core` 1.59.1 loaded from another local project by absolute path. Nothing was installed. Settings were seeded with `homeChartRegion='hk'` and `homeExtraRegions=['jp']`, and history with 3 entries.

**Home headings** (step 3): 19 `button.subhead-nav`, each with an aria-label ending in ", See all": Your Radio, Top songs · Hong Kong, New releases · Hong Kong, Top artists · Hong Kong, Top albums · Hong Kong, Trending on YouTube · Hong Kong, 11 genres (Cantopop … Asian music), Top songs · Japan, Recently played. `h3.subhead-static` count: 0.

**Via heading click** (steps 3-5):
| Heading | URL | Page title | Rows |
|---|---|---|---|
| Top songs · Hong Kong | /charts/shelf/chart-songs/hk | Top songs · Hong Kong | 50 song rows |
| New releases · Hong Kong | /charts/shelf/new-releases/hk | New releases · Hong Kong | 50 song rows |
| Top artists · Hong Kong | /charts/shelf/chart-artists/hk | Top artists · Hong Kong | 50 round-avatar rows |
| Top albums · Hong Kong | /charts/shelf/chart-albums/hk | Top albums · Hong Kong | 50 album rows (a later run; see note) |
| Trending on YouTube · Hong Kong | /charts/shelf/yt-trending/hk | Trending on YouTube · Hong Kong | 50 song rows |
| Top songs · Japan (extra region) | /charts/shelf/region/jp | Top songs · Japan | 50 song rows |

- Artist row tap goes to `/artist/陳奕迅`. Album row tap goes to `/album/The Life of a Showgirl: The Encore?artist=Taylor Swift`.
- After the Top albums heading tap, no new `/api/charts` request fired. Every chart request in the log came from the home mount, which confirms the zero-request SPA nav.
- Note: the first run's Top-albums heading tap showed 0 rows. A dedicated re-run showed 50 album rows at 500 ms, 2 s and 5 s, and the direct deep-link also rendered. This was a transient: the Apple albums fetch was probably still in flight or came back empty on the cold edge during that run.

**Cold deep-links** (step 7), each a fresh `page.goto`:
- `/charts/shelf/chart-songs/hk`: 50 rows. Requests were `/api/charts?src=kkbox&kind=song&cc=hk` + `/api/charts?src=apple&kind=songs&cc=hk` (the fused pair).
- `/charts/shelf/chart-albums/us`: 50. `/charts/shelf/genre/kpop`: 49 (client iTunes hk genre=51). `/charts/shelf/region/jp`: 50. `/charts/shelf/new-releases/tw`: 50. `/charts/shelf/yt-trending/hk`: 50.
- `/charts/shelf/bogus/xx` and `/charts/shelf/nope/xx`: header with an empty title, empty list, **0 `/api` requests**, no page errors. The only console errors were the pre-existing cross-origin cloudflareinsights RUM beacon.

**Radio** (step 6): the home "Your Radio" shelf had 24 tiles. Clicking the heading went to URL `/radio` with title "Your Radio" and 24 rows. The row titles matched the shelf tiles **in the same order**. Tapping row 2 ("Letting Go") gave: now-bar = "Letting Go", `player.current.title` = "Letting Go", `player.queueContext` = `home-discovery`, `player.queue.length` = 24, and queue[0..5] equal to the radio list[0..5]. The persisted `openmusic:player:v1` agrees.

**Task 4 feedback** (desktop pointer context): all 17 headings have the chevron as the element right after `.subhead-label` with computed `margin-left: 0px`. The label-to-chevron gap is 8px, with the chevron's right edge at 235px on a row that ends at 374px. A dispatched `pointerdown` added `tap-bouncing` on a heading, Randomize, the gear and the search pill, and it was gone again 600 ms later. Hover opacity is 0.7 on a heading and on Randomize. Retry only renders on an error, so it was not exercised live; it has the same markup and CSS as Randomize.

## Deviations from Plan

1. **[Rule 2 - Correctness] Hover dim added to `.searchpill` too.** The plan listed hover dim for `.more, .retry, .gear` and said to skip the search pill only "if it already has a hover style". It had none, so it gets the same `(hover: hover)` dim. Randomize's dim is `:not(:disabled)`, so the disabled "Loading…" state does not look pressable. The gear keeps its existing background hover as well. Files: `src/routes/(app)/+page.svelte`. Commit 12c96a0f.
2. **`.subhead-nav { cursor: pointer; }` folded into the main `.subhead-nav` rule** once `.subhead-static` left the shared selector (Task 3). No behaviour change.
3. **E2E tooling.** The plan assumed the Browser-pane tools (`read_page` / `get_page_text` / `javascript_tool`). They were not exposed to this agent, so the same checks ran in headless Chrome via an already-present `playwright-core` (no install, scripts kept in the session scratchpad only).
4. **Extra test coverage.** `poolTasks` gets a parity sweep (every region kind × all 27 regions equals `planChartShelves` filtered by key) and extra allowlist cases (`genre/hk`, `region/kpop`, bogus kind). `CHART_POOL_LABEL` and `CHART_POOL_KINDS` are pinned.

## Known Stubs

None.

## Threat Flags

None. The new routes read only allowlisted params (T-1fx-01, test-pinned, and E2E showed 0 requests for a bogus kind). The home dests are fixed paths with an `encodeURIComponent`-wrapped enum segment (T-1fx-02).

## Self-Check: PASSED

- FOUND: src/routes/(app)/charts/shelf/[kind]/[id]/+page.svelte (292 lines, min 150)
- FOUND: src/routes/(app)/radio/+page.svelte (143 lines, min 60)
- FOUND commits: ca00f9ec, d69ddf10, 78d50dff, 053770b7, 12c96a0f
