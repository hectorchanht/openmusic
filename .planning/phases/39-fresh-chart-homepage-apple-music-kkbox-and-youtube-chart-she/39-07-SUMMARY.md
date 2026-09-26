---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 07
subsystem: home
tags: [charts, home, cache, randomize, revalidate, fusion, compact-row, visibility-gating]

requires:
  - phase: 39-01
    provides: "fuseCharts, ChartAlbum"
  - phase: 39-03
    provides: "GET /api/charts"
  - phase: 39-04
    provides: "appleSongs, appleAlbums, kkboxSongs, kkboxNewReleases, ytTracks, ytArtists, genreChart"
  - phase: 39-05
    provides: "planChartShelves, poolKey, genrePoolKey, samplePicks, regionLabel, chartAlbumHref, CHART_GENRE_LABEL, HOME_CACHE_KEY, LEGACY_HOME_CACHE_KEYS, POOL_STALE_MS, POOL_CAP"
  - phase: 39-06
    provides: "settings.homeChartRegion / homeExtraRegions / homeChartGenres"
provides:
  - "Home page chart orchestration: v3 pools+picks cache, planChartShelves task runner, gated classic refresh, silent revalidate, local Randomize"
  - "Seven chart render arms + titleStatic, artistShelf, albumShelf snippets"
  - "CompactRow variant='album'"
  - "fuseCharts tail-folded fusion key (39-D-44)"
  - "page-local for 39-08: pools, picks, chartRegion, chartExtraRegions, chartGenres, chartTasks(), plannedKeys(), runChartTasks(tasks, gen, apply), chartGen, sampledSongs/Artists/Albums(key), hasPool(key), genreShelves, regionShelves, shelfCount(id), hasAnyContent()"
affects: [39-08 placeholders, 39-09 one-time switch, 39-10 settings/home]

tech-stack:
  added: []
  patterns:
    - "Chart fetch generation (chartGen) separate from refreshGen: a local Randomize never cancels pools still landing"
    - "Silent revalidate parks fresh pools (pendingPools) in the cache; only keys with nothing on screen are applied live"

key-files:
  created: []
  modified:
    - src/routes/(app)/+page.svelte
    - src/lib/components/CompactRow.svelte
    - src/lib/services/chart-parse.ts
    - src/lib/services/chart-parse.test.ts

key-decisions:
  - "39-D-44: fuseCharts keys rows by a tail-folded title (' - subtitle', '《…》' tail) so KKBOX '甲乙丙丁Strangers - 你我怎麼兩清' fuses with Apple '甲乙丙丁Strangers'; display strings unchanged; ceiling: 'Song - Live' merges with the studio cut"
  - "Chart pool writes are guarded by a dedicated chartGen (bumped only by a new chart fetch), not refreshGen, so Randomize during a cold chart-only load does not drop the shelves still landing"
  - "Every song pool (one list or two) goes through fuseCharts and artist/album pools through a key de-dupe, because the shelves key rows by artist+title / name and a duplicate key would break the keyed each"
  - "An empty task answer keeps the existing pool; a planned key with no pool on a warm mount is fetched on its own and shown as it lands"
  - "saveCache keeps only the current plan's pool keys, so region switching cannot grow the blob"

requirements-completed: [P39-07, P39-08, P39-12, P39-13]

duration: 23min
completed: 2026-09-26
---

# Phase 39 Plan 07: Chart shelves on the home page Summary

**The home page now plans, fetches, fuses, persists and samples the chart pools (Apple Music, KKBOX, YouTube Charts, iTunes/Deezer genres). It renders seven new shelf types with static region-qualified titles, fetches classic Deezer/Last.fm shelves only when they are visible, re-samples locally on Randomize, and silently revalidates stale pools for the next visit.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-09-26T03:19:52Z
- **Completed:** 2026-09-26T03:43:18Z
- **Tasks:** 3/3, plus the folded-in fusion-key fix
- **Files modified:** 4

## Accomplishments

- **Cache (39-D-26):** `openmusic:top-picks:v3` holds `pools` (at most 50 rows per key), `picks` and `fetchedAt` next to the classic fields. `loadCache` accepts only `v === 3` that passes a shape guard, so an old v2 blob forces one cold refresh. `saveCache` removes both legacy keys. The E2E confirmed that a seeded `v2` key was gone after the first save.
- **Runner (39-D-28):** tasks from `planChartShelves` are grouped by pool key and run with `FANOUT_CAP` groups in flight. Each pool is assigned as soon as it lands. In hk/tw/sg, Top Songs fuses KKBOX with Apple, and Apple's list goes first so its display strings win.
- **Classic gating (39-D-30):** `deezerChart` runs only if top-hits or top-artists is visible. The tag fan-out runs only if tags is visible, and the country fan-out only if countries is visible. The cover backfill for classic rows follows the same rule. `configSig` (39-D-27) now includes the visible set, the region, the extra regions and the genres.
- **Fallback gate:** `hasAnyContent()` checks planned chart pools, the visible classic shelves and the visible library shelves. It drives both the D-06 fallback and the cold skeleton.
- **Randomize (39-D-29):** re-samples picks locally and adopts `pendingPools` first. The button is disabled and shows "Loading…" only while a classic section is visible and loading.
- **Revalidate (39-D-32):** pools older than 6 h are refetched in the background. The fresh pools and picks go into the cache and `pendingPools`, and nothing swaps on screen.
- **Render:** `titleStatic` (39-D-33) shares one CSS block with `.subhead-nav`; `cursor` and hover stay on `.subhead-nav` only. `artistShelf` is a verbatim extraction. `discoveryShelf` takes a new `coverOnPlay` parameter, and Trending passes `false` (39-D-34). Seven render arms were added in the user's section order. `albumShelf` plus `CompactRow variant="album"` (39-D-35/36) open `chartAlbumHref`, with no long-press.

## Verification (observed)

- `pnpm check`: **0 errors, 0 warnings** after every task, including the intermediate Task 3 commit.
- `pnpm vitest --run chart-parse.test.ts`: RED **1 failed / 36 passed** before the fix, then GREEN **37 passed**.
- Task 1 tests (home-charts, charts, chart-parse): **103 passed**. Task 2 tests (i18n, home-charts): **63 passed**. Task 3 test (home-charts): **30 passed**.
- `pnpm test`: **151 files / 3236 tests passed**.
- `pnpm build` (adapter-cloudflare): `✔ done` before every product commit.
- All acceptance greps matched:
  - `top-picks:v2` appears 0 times. The cache-key constants appear 7 times. All five identifiers are present. `classicVisible` appears 3 times.
  - `hasAnyDiscovery` appears 0 times and `hasAnyContent()` 4 times. `let pendingPools` is not `$state`. Every decision-ref comment survives at its original count (WR-04, WR-02, VX2, D-06, hhd, pgu, w87, T-w87-01/03, FIX-A, 0bb).
  - There are 8 new snippets, and the id-arm count is ≥ 7. `.subhead-nav, .subhead-static` is present with no `cursor` inside it. 39-D-34 and `densityOf('yt-trending'), false)` are present. The `titleNav(` count is unchanged at 11.
  - The album grep checks passed: 0 longpress/MoreVertical/RowBadges in the album branch, 2 album snippets, 3 `chartAlbumHref(` calls, and 0 `use:longpress` in albumShelf.

### E2E (headless Chromium over CDP against the running :5173 dev server, fresh profile, zh-Hant, region hk, 390×844 mobile)

- **Cold home: 14 chart requests, all 200.** The exact URLs:
  - `/api/charts?src=kkbox&kind=song&cc=hk`, `/api/charts?src=apple&kind=songs&cc=hk`, `/api/charts?src=kkbox&kind=newrelease&cc=hk`, `/api/charts?src=yt&kind=artists&cc=hk`, `/api/charts?src=apple&kind=albums&cc=hk`, `/api/charts?src=yt&kind=tracks&cc=hk`
  - `itunes.apple.com/{hk/1251, tw/1253, hk/51, jp/27}` (browser-side)
  - `/api/deezer/chart?genre={116,152,113,165}&limit=50`
- On top of those, the still-visible classic shelves added **30** requests (1 bare `/api/deezer/chart?limit=24` + 22 tag + 7 geo). Total `/api/*` plus iTunes requests during the 15 s window, cover backfill included: **203–271** across runs. Most of the backfill comes from the imageless Last.fm tag rows.
- **Shelves rendered:** 13 chart headings: Top songs · 香港, New releases, Top artists, Top albums, YouTube Trending and the 8 genre shelves. Covers were **24/24 on every chart shelf** in the final run; YouTube showed 23/24 in one earlier run. The first Top Songs rows were `甲乙丙丁Strangers`, `玻璃`, `擱淺`: all three cross-chart overlaps fused and ranked first, confirming the 39-D-44 fix on live data. Classic shelves still rendered below. No console errors or warnings.
- **Reload:** tiles were identical and there were **0 chart and 0 classic requests**.
- **Randomize:** the first shelf changed, with **0 `/api/charts` requests**. The classic random-page refetch still ran (30) because classic is visible. The cache was updated immediately.
- **Stale (fetchedAt − 7 h) → reload:** tiles on screen were unchanged. One background batch of **14** chart requests ran, `fetchedAt` was updated, and the cached picks changed. **Reload again:** a new sample appeared, with 0 chart requests.
- **Four classic sections hidden → reload:** **no** `/api/lastfm/discovery` and **no** bare `/api/deezer/chart` requests, no fallback grid, and Randomize enabled. The 14 chart requests re-ran because the config signature changed (expected). **Randomize with classic hidden: 0 requests.** **Warm reload with classic hidden: 0 requests.**
- **Album tap:** landed on `/album/{name}?artist={artist}`. The home tap itself issued nothing, and the album page then made its own `lastfm/info album.getinfo` and `deezer/album` calls. Track rows listed: 16 for *The Life of a Showgirl: The Encore* and 10 for *要去什麼地方*. *petal* (Ariana Grande) rendered its header with 0 rows inside 7 s, which is the album page's own Last.fm tracklist behaviour, not this plan.
- **Song tap (Top songs):** the now-bar seated `甲乙丙丁Strangers · Li Jiawei` (another run: `玻璃 · Gareth.T`).
- **Not verified:** the in-app Browser pane (rAF there is frozen). Headless Chromium runs rAF normally, so the progressive reveal completed in these runs. iOS Safari was not checked, and no device was used.

## Task Commits

1. **Folded-in: fusion-key fold** — `618c5e4` (fix; RED observed locally, test + fix in one commit)
2. **Task 1: orchestration** — `8c1bc90` (feat)
3. **Task 2: seven render arms** — `1ce704e` (feat)
4. **Task 3: album shelf + CompactRow album variant** — `fd95dc0` (feat)
5. **Follow-up fixes found in the Task 3 E2E** — `37468cb` (fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Randomize cancelled pools still landing on a cold chart-only load**
- **Found during:** Task 1
- **Issue:** The plan gates chart pool assignment on `refreshGen`. With classic hidden, the Randomize button stays enabled during a cold load (UI-SPEC §1.7). A press bumps `refreshGen`, so every group still in flight would bail and those shelves would stay blank until the next visit.
- **Fix:** a plain `chartGen` counter guards pool writes, and only a new chart fetch bumps it. `revalidatePools` checks both counters and bumps neither.
- **Commit:** 8c1bc90

**2. [Rule 2 - Correctness] Duplicate row keys and empty answers**
- **Found during:** Task 1
- **Issue:** The shelves key rows by `artist + ' ' + title` (or name). A single chart listing the same song twice (explicit and clean) would produce a duplicate key in a keyed `{#each}`. Separately, an empty answer (the upstream-failure signal from 39-03/39-04) would overwrite a good pool.
- **Fix:** every song pool goes through `fuseCharts`, which keeps rank order and collapses duplicates. Artist and album pools get a key de-dupe. An empty result keeps the current pool.
- **Commit:** 8c1bc90

**3. [Rule 2 - Correctness] A failed first fetch blanked a shelf for 6 h**
- **Found during:** Task 1. The first headless run saw Apple `us` songs answer `{items:[]}`, a live upstream flake.
- **Fix:** on a warm mount, a planned key with no pool runs `revalidatePools(true)`, which fetches only the missing keys and shows them as they land. The live-apply rule means a key with nothing on screen is never parked. A cached D-06 fallback is cleared once a pool exists, otherwise the grid would be persisted and shown again on every later visit.
- **Commit:** 8c1bc90

**4. [Rule 2 - Resource] Cache growth across region switches**
- **Fix:** `saveCache` keeps only the current plan's pool keys, which bounds the blob to one plan (about 120 KB).
- **Commit:** 8c1bc90

**5. [Rule 1 - Bug] Hidden classic rows still backfilled covers on the transition load**
- **Found during:** Task 3 E2E. After hiding classic, the mount ran `scheduleBackfill()` over the cached classic rows before the cfg revalidate emptied them, which sent Last.fm hip-hop tag rows to Deezer search.
- **Fix:** classic rows are gathered only for visible classic sections. Afterwards, a warm reload with classic hidden made 0 requests.
- **Commit:** 37468cb

**6. [Rule 1 - Bug] Randomize re-sample lost on a reload while classic was refetching**
- **Found during:** Task 3 E2E. With classic visible, the cache was written only after the ~30-request classic refetch finished. A reload before then showed the pre-Randomize tiles.
- **Fix:** `saveCache()` runs right after `redrawPicks()`. In the rerun the cache changed immediately and "stale tiles unchanged" held.
- **Commit:** 37468cb

**7. [Process] The folded-in fix is one commit** (test + fix). The RED run (1 failed / 36 passed) was observed before the fix was written.

## Assumption Drift (advisory)

- **Found during:** Task 1
- **Planned:** chart pool writes gen-guarded with `refreshGen`, and the Randomize button disabled only while loading with classic visible.
- **Actual:** together these two let a Randomize press cancel the cold chart fetch, so the guard moved to `chartGen`.
- **Why:** a Randomize press is not a newer chart fetch. Pools landing after it are new content, not stale content.

## Known Stubs

None. Per-shelf loading placeholders are the next plan's scope (UI-SPEC §1.7). Until then a cold load shows no skeleton for chart shelves while library or classic content exists, and a chart shelf simply appears when its pool lands.

## Threat Flags

None. There are no new endpoints, and the only new storage is the planned `openmusic:top-picks:v3`. T-39-28 (v3 shape guard), T-39-29 (non-array and out-of-range picks skipped; Randomize guards non-array pools), T-39-30 (tasks only from the planner, FANOUT_CAP, classic and backfill gated, revalidate never bumps a generation) and T-39-31 (fixed `/artist/` + `chartAlbumHref` paths) are mitigated as planned.

## Self-Check: PASSED

- FOUND: src/routes/(app)/+page.svelte, src/lib/components/CompactRow.svelte, src/lib/services/chart-parse.ts, src/lib/services/chart-parse.test.ts
- FOUND commits: 618c5e4, 8c1bc90, 1ce704e, fd95dc0, 37468cb
