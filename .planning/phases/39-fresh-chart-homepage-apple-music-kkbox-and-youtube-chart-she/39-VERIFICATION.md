---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
verified: 2026-09-26T04:38:41Z
status: gaps_found
score: 27/30 must-haves verified
has_blocking_gaps: true
overrides_applied: 0
gaps:
  - truth: "The D-06 fallback grid appears only when EVERY visible shelf (new + classic + library) is empty after settle (39-07-PLAN must-have #3)"
    status: failed
    severity: blocking
    reason: >
      On the default/migrated layout, classic sections are hidden, so classicVisible is false and the
      Randomize button's disabled expression (`loading && classicVisible`) is always false during a
      cold chart load — the button is enabled for essentially every target user during the ~1-5s window
      before any chart pool lands. A press in that window runs redrawPicks() over still-empty pools,
      then hasAnyContent() (reading the same still-empty pools) is false, so useFallback is set true and
      buildDiversePicks()'s generic grid replaces every chart/classic/library section and is persisted
      to openmusic:top-picks:v3. Nothing re-checks hasAnyContent() for the rest of that session once the
      background chartGen fetch lands (no $effect, no post-land check in runChartTasks/refresh()), so the
      user is stuck on the old-style fallback grid — the exact stale experience this phase exists to
      replace — until the NEXT app open, when onMount's revalidatePools() finally clears the flag (and
      even then it first re-applies the cached fallback queue via player.setQueue() before self-healing).
      Verified by direct code trace (src/routes/(app)/+page.svelte:769-911, 615-638), independently
      reproducing code-review finding WR-01 in 39-REVIEW.md, not fixed by 39-08/39-09/39-10 (checked;
      the file's disabled expression at line 1184 is unchanged from the reviewed diff).
    artifacts:
      - path: "src/routes/(app)/+page.svelte"
        issue: "Randomize button stays enabled during a cold chart-only load; a press before any pool lands sets useFallback=true and nothing clears it until the next mount's revalidatePools()"
    missing:
      - "Disable Randomize while any chart placeholder is in flight (e.g. `disabled={(loading && classicVisible) || anyPlaceholder}`), or otherwise block the fallback gate from firing on a still-loading first refresh"
      - "Stamp poolsFetchedAt / re-check hasAnyContent() once the superseded chartGen task finishes landing within the same session, so a mistimed Randomize press self-heals immediately instead of only on next launch"
  - truth: "/api/deezer/chart never caches an empty/error answer (CONTEXT.md Caching/resilience: 'cold miss + upstream failure → empty shelf', mirrored by /api/charts' explicit no-cache-on-empty rule)"
    status: failed
    severity: minor
    reason: >
      The genre branch (src/routes/api/deezer/chart/+server.ts:124-149) never checks `res.ok` or whether
      the reshaped result is empty before `cache.put`. Deezer answers quota/error cases with a 200 body
      such as `{"error":{...}}`; that reshapes to `{tracks:[],artists:[]}`, which is still stored at the
      edge and sent to the browser with `Cache-Control: public, max-age=3600`, blanking a genre shelf for
      up to 1h per device/PoP. Confirmed by code read; matches 39-REVIEW.md WR-02, not fixed since.
    artifacts:
      - path: "src/routes/api/deezer/chart/+server.ts"
        issue: "genre branch caches an empty/error result for 3600s at the edge and in the browser"
    missing:
      - "Check res.ok and result.tracks.length before cache.put / before sending a browser Cache-Control TTL (see 39-REVIEW.md WR-02 fix)"
  - truth: "/api/deezer/chart's cache key is canonical/own-origin, built only from validated params (the posture /api/charts was built to, per CONTEXT 'query params must be allowlisted; cache key must be own-origin')"
    status: failed
    severity: minor
    reason: >
      `cacheReq = new Request(url.toString())` (src/routes/api/deezer/chart/+server.ts:114) keys the edge
      cache on the raw request URL, so junk params or non-canonical numeric spellings each mint a new
      cache entry and a fresh Deezer subrequest from the shared Workers egress IP (~50 req/5s limit).
      The new `genre` param widens this pre-existing hole. Confirmed by code read; matches 39-REVIEW.md
      WR-03, not fixed since.
    artifacts:
      - path: "src/routes/api/deezer/chart/+server.ts"
        issue: "cache key is the raw request URL, not built from validated genre/limit values only"
    missing:
      - "Build the cache key from validated genre/limit only via the same ownOriginCacheKey helper /api/charts uses"
---

# Phase 39: Fresh chart homepage (Apple Music, KKBOX, YouTube Charts) Verification Report

**Phase Goal:** The home page shows what is actually hot in the listener's region right now. New default
shelves — Top Songs (KKBOX for hk/tw/sg fused with Apple Music RSS elsewhere/together), Top Albums (Apple
Music RSS), New Releases (KKBOX), Top Artists + Trending (YouTube Charts), and genre shelves (regional
pop via client-side legacy iTunes RSS, Western genres via Deezer genre charts) — driven by one main Chart
region (defaulted from app language) plus optional extra regions. The existing Deezer Top Hits/Top Artists
and Last.fm tag/country shelves stay available in /settings/home but are hidden by default, with a
one-time switch for existing users. Randomize samples a random N from each cached top-50/100 pool so the
first render varies at zero extra requests.

**Verified:** 2026-09-26T04:38:41Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Req | Status | Evidence |
|---|-------|-----|--------|----------|
| 1 | Chart parsers never throw on null/{}/[]/string/garbage, cap 50 rows, route images through the caller's validator | P39-01 | ✓ VERIFIED | `src/lib/services/chart-parse.ts` `str()/rows()/isObject()` guards; `chart-parse.test.ts` 36/36 pass |
| 2 | YouTube Charts' global-fallback 200 (unsupported cc) is rejected via the echoed countryCode, never trusted from status | P39-01 | ✓ VERIFIED | `parseYtCharts` echo gate (lines 219-225); live `?src=kkbox&kind=song&cc=us`→`[]` analog confirmed the same allowlist posture at the route |
| 3 | Legacy iTunes feed keeps only rows whose `category.attributes['im:id']` equals the requested genre; single-entry (object, not array) feed parses to one row | P39-01/04 | ✓ VERIFIED | `parseItunesGenreFeed` (lines 258-286); live `itunes.apple.com/hk/rss/topsongs/limit=5/genre=1251/json` returned 5 on-genre entries |
| 4 | Image allowlists accept mzstatic / i.kfs.io / googleusercontent / i.ytimg / yt3.ggpht and reject look-alikes/apexes | P39-09 | ✓ VERIFIED | `src/lib/proxy/safe-image-url.ts` suffix/exact rules; `safe-image-url.test.ts` 13/13 pass; live route responses show images from all three hosts |
| 5 | `fuseCharts` reciprocal-rank-fuses two ranked lists: a song on both charts outranks single-chart peers, Apple's display name wins on overlap, one empty list yields the other alone | P39-13 | ✓ VERIFIED | `chart-parse.ts` `fuseCharts`/`fusionKey` (lines 288-337); live `hk` data shows KKBOX's `甲乙丙丁Strangers - 你我怎麼兩清` tail-folds to fuse with Apple's plain title (39-D-44), matching the 39-07 E2E claim |
| 6 | `GET /api/charts?src=&kind=&cc=` answers `{items}` only for the allowlisted apple/kkbox/yt combos; anything else → `{items:[]}` with zero upstream/cache touches | P39-02 | ✓ VERIFIED | Live curl against the running dev server: apple/kkbox/yt × hk returned 50 items each; `kkbox/song/us` and `src=deezer` returned `{"items":[]}` |
| 7 | `/api/charts` uses a canonical own-origin cache key, serves fresh ≤6h with no subrequest, and serves-stale ≤48h with a `waitUntil` background refill that only overwrites on a non-empty parse | P39-02 | ✓ VERIFIED (code) / ? UNCERTAIN (`unverifiable_runtime`) | `src/lib/proxy/charts.ts` `serveChart`/`chartCacheKey`; 44/44 route tests pass against a stubbed `caches`/`fetch`/`waitUntil`. Real Cache API + `waitUntil` semantics under deployed workerd cannot be exercised from `vite dev` (`edgeCache()` is null there) — genuinely needs a post-deploy check, as 39-03's own SUMMARY states |
| 8 | `GET /api/deezer/chart?genre=` fetches the allowlisted genre chart through the existing reshape; an unknown genre falls through to the plain chart; the two are distinct cache entries | P39-03 | ✓ VERIFIED | Live curl: `genre=116`→5 real tracks/0 artists; `genre=999`→ falls through to the overall chart (5 tracks + 5 artists) |
| 9 | `/api/deezer/chart` never caches an empty/error genre answer | P39-03/context | ✗ FAILED | See frontmatter gap (WR-02) — genre branch caches a 200-with-error-body for 1h |
| 10 | `/api/deezer/chart`'s cache key is canonical/own-origin, built only from validated params | P39-03/context | ✗ FAILED | See frontmatter gap (WR-03) — cache key is the raw request URL |
| 11 | The legacy iTunes genre feed is fetched CLIENT-SIDE through `apiFetch` (never from the edge), genre-guarded per row, single-entry-safe, mzstatic art resized+host-validated | P39-04 | ✓ VERIFIED | `src/lib/services/charts.ts` `itunesGenreChart`; live direct curl from this machine's IP (not the edge) returned CORS `*` + 200 |
| 12 | `genreChart(id)` dispatches iTunes-genre ids to their fixed storefront and Deezer-genre ids to `/api/deezer/chart?genre=` | P39-04 | ✓ VERIFIED | `charts.ts` dispatcher; `charts.test.ts` 36/36 pass incl. `dispatch: cantopop` / `dispatch: hiphop` |
| 13 | Every client chart fetch is governed by `apiFetch`, memoised 6h, and treats an empty answer as a failure (never cached) | P39-04 | ✓ VERIFIED | `charts.ts` `nonEmpty()` guard + `deezerGenreChart` throw-on-empty; `charts.test.ts` pins a refetch after an empty answer |
| 14 | `resolveChartRegion` covers all 15 AppLangs, never yields `cn`, prefers an offered `navigator.language` region subtag, falls back to `us` | P39-05 | ✓ VERIFIED | `home-layout.ts` `resolveChartRegion`/`LANG_REGION`; `home-layout.test.ts` (part of 77 passing) |
| 15 | `resolveExtraRegions` drops the main region/dupes/unknowns; `resolveChartGenres` keeps only pool ids and an empty selection stays empty | P39-05 | ✓ VERIFIED | `home-layout.ts` lines 184-241; unit-tested |
| 16 | `migrateHomeLayout` inserts only the missing chart ids at the first classic slot, unions the four classic ids into hidden, carries per-section density, and is idempotent | P39-06 | ✓ VERIFIED | `home-layout.ts` `migrateHomeLayout` (lines 488-509); dev-smoke in 39-09-SUMMARY reproduced exactly this on a seeded old blob |
| 17 | `reorderListed` moves one listed row while every classic id keeps its exact array index | P39-06 | ✓ VERIFIED | `home-layout.ts` lines 331-340; unit-tested |
| 18 | `settings.homeChartRegion`/`homeExtraRegions`/`homeChartGenres` persist through init/load/save/resetHome, with a `CHART_REGIONS` allowlist guard (never a bare cast) | P39-06 | ✓ VERIFIED | `settings.svelte.ts` lines 234-238, 399-410, 524-533, 666-668 |
| 19 | The one-time migration runs inside `settings.load()`, version-gated (`homeLayoutVersion`), saves once when migrated; a truly fresh install (no persisted blob) skips it entirely and gets `HOME_DEFAULTS` (classic pre-hidden) directly | P39-06/09 | ✓ VERIFIED | `settings.svelte.ts` lines 271-274 (`if (raw)` gates the whole coercion block incl. migration), 448-471; `defaults.ts` `homeHidden: [...CLASSIC_SECTIONS]`, `homeLayoutVersion: HOME_LAYOUT_VERSION` |
| 20 | `planChartShelves` emits one task per visible+region-capable shelf and nothing for a hidden section; hk/tw/sg `chart-songs` emits 2 tasks (KKBOX+Apple) under one pool key | P39-07 | ✓ VERIFIED | `home-charts.ts` `planChartShelves` (lines 55-91); `home-charts.test.ts` 30/30 pass |
| 21 | A hidden classic section issues ZERO requests (Deezer chart / tag fan-out / country fan-out each gated on its own section's visibility) | P39-07 | ✓ VERIFIED | `+page.svelte` line 804 `if (classicVisible)` gate + per-shelf `hitsVisible`/`artistsVisible`/`tagPool`/`countryPool` guards |
| 22 | The D-06 fallback grid appears only when EVERY visible shelf is empty after settle | P39-07 | ✗ FAILED | See frontmatter gap (WR-01, blocking) |
| 23 | Randomize re-samples the cached pools locally (zero requests); the persisted arrangement survives a reload | P39-07/12 | ✓ VERIFIED (mechanism), entangled with gap #22 | `samplePicks`/`redrawPicks` re-draw with no fetch (code + unit tests); the *gating* around when this correctly reflects on screen is where gap #22 lives |
| 24 | A cached pool older than 6h revalidates silently in the background; tiles on screen do not swap until the next app open | P39-07 | ✓ VERIFIED | `revalidatePools()` parks fresh pools in `pendingPools`, only live-applies keys with nothing on screen (lines 615-638) |
| 25 | Song/artist/album tile taps route to `playStub`/`/artist/{name}`/`chartAlbumHref` with zero extra calls at tap time; Trending passes a null cover | P39-07/08 | ✓ VERIFIED | `+page.svelte` `discoveryShelf` snippet (`onclick={() => playStub(item, coverOnPlay ? item.image : null)}`), `yt-trending` arm passes `false` for `coverOnPlay` |
| 26 | Per-shelf placeholders reserve each planned shelf's slot; `shelfCount` counts a placeholder like a real shelf; the global skeleton shows only when no placeholder is on screen | P39-07/08 | ✓ VERIFIED | `+page.svelte` `inflight`/`isPlanned`/`anyPlaceholder`/`shelfPlaceholder` (lines 452-457, 1296+) |
| 27 | `/settings/home` shows one global drag list (13 non-classic rows w/ source lines), a Charts group (region/extra-regions/genres), and a collapsed Classic accordion holding the 4 old shelves + their chip pickers | P39-10 | ✓ VERIFIED | `settings/home/+page.svelte` structure matches; `<details class="advanced classic">` block present |
| 28 | Every visibility switch/chip carries the correct ARIA state (`role=switch`+`aria-checked`, `aria-pressed`, region `role=group`) | P39-10 | ✓ VERIFIED | grep confirms `role="switch"`, `aria-checked`, `aria-pressed` (13+ occurrences), `role="group"` on the region chip set |
| 29 | All 15 locales carry the 36 new i18n keys with parity and double-quote style; `settings.homeCountriesLabel` is gone | P39-11 | ✓ VERIFIED | `i18n.test.ts` 33/33 pass |
| 30 | The old shelves (top-hits/top-artists/tags/countries) stay fully operable under the Classic accordion, including their own chip pickers and Randomize page trick | P39-10 | ✓ VERIFIED | `settings/home/+page.svelte` Classic block retains tag/country chip pickers; `+page.svelte` `RANDOM_PAGE_BOUND` classic-only page-shuffle logic unchanged |

**Score:** 27/30 truths verified (1 blocking gap, 2 minor gaps)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/services/chart-parse.ts` | Pure parsers + fusion + strip helpers | ✓ VERIFIED | All exports present, wired, tested (36 tests) |
| `src/lib/services/home-layout.ts` | Region/genre resolvers, migration, reorderListed | ✓ VERIFIED | All exports present, wired, tested (77 tests) |
| `src/lib/proxy/charts.ts` + `src/routes/api/charts/+server.ts` | Edge `/api/charts` route | ✓ VERIFIED | Live-tested against real upstreams, 44 route tests |
| `src/routes/api/deezer/chart/+server.ts` | `?genre=` branch | ⚠️ WIRED but degraded | Works for the happy path; caches empty/error answers (WR-02) and uses a raw-URL cache key (WR-03) |
| `src/lib/services/charts.ts` + `src/lib/services/deezer.ts` | Client chart services | ✓ VERIFIED | 36+6 tests, live-tested iTunes CORS |
| `src/lib/services/home-charts.ts` | Planner, sampler, labels, cache keys | ✓ VERIFIED | 30 tests, all exports present |
| `src/lib/stores/settings.svelte.ts` + `src/lib/config/defaults.ts` | Chart settings fields + one-time migration | ✓ VERIFIED | Migration gated correctly behind `if (raw)`, version check, save-once |
| `src/routes/(app)/+page.svelte` | Home chart orchestration + render + placeholders | ⚠️ WIRED but has a functional defect | Fallback-grid gate can mis-trigger and stick for a session (gap #22) |
| `src/routes/(app)/settings/home/+page.svelte` | Redesigned settings page | ✓ VERIFIED | Structure, a11y, wiring all match plan |
| `src/lib/components/CompactRow.svelte` | `variant="album"` | ✓ VERIFIED | Present, one button, no long-press, matches spec |
| 15 locale files | 36 new keys, parity | ✓ VERIFIED | i18n.test.ts green |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `+page.svelte refresh()` | `home-charts.ts planChartShelves` | task list → `mapWithConcurrency` | ✓ WIRED | `chartTasks()` builds a `ChartPlanConfig` from resolved settings and calls `planChartShelves` |
| `+page.svelte` | `chart-parse.ts fuseCharts` | two-task pool keys | ✓ WIRED | `runChartTasks`'s song branch always routes through `fuseCharts`, Apple-first |
| `+page.svelte refresh()` | `deezerChart`/`getTagTopTracks`/`getGeoTopTracks` | `classicVisible` gate | ✓ WIRED | Confirmed at line 804 and per-shelf sub-gates |
| `+page.svelte saveCache` | `HOME_CACHE_KEY`/`LEGACY_HOME_CACHE_KEYS` | localStorage write + legacy removal | ✓ WIRED | `saveCache()` writes v3, removes v1/v2 every call |
| `settings/home/+page.svelte onReorder` | `home-layout.ts reorderListed` | import | ✓ WIRED | Confirmed; classic ids keep their index |
| `settings/data/+page.svelte clearPicks` | `home-charts.ts HOME_CACHE_KEY` | import | ✓ WIRED | Confirmed via grep; 3 `removeItem` calls |
| `charts.ts` | `api-base.ts apiFetch` | every fetch incl. absolute iTunes URL | ✓ WIRED | 2 `apiFetch(` call sites, 0 raw `fetch(` |
| `charts.ts itunesGenreChart` | `chart-parse.ts parseItunesGenreFeed` | import | ✓ WIRED | Confirmed |
| `api/charts/+server.ts GET` | `proxy/charts.ts validateChartQuery` | pre-cache/pre-fetch gate | ✓ WIRED | Live-confirmed: disallowed combos return `{items:[]}` immediately |
| `proxy/charts.ts serveChart` | `platform.ctx.waitUntil` | stale refill | ✓ WIRED (code) / ? UNCERTAIN (runtime) | Present in code and unit-tested against a stub; real workerd behavior needs a post-deploy check |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| P39-01 | 39-01, 39-03, 39-04 | ✓ SATISFIED | Parsers + edge route + allowlists all live-verified |
| P39-02 | 39-03 | ✓ SATISFIED (code); serve-stale/waitUntil runtime behavior unverifiable here |
| P39-03 | 39-04 | ⚠️ PARTIALLY SATISFIED | Route works; caching hygiene gaps (WR-02/WR-03) |
| P39-04 | 39-01, 39-04 | ✓ SATISFIED | Client services + client-side iTunes feed verified live |
| P39-05 | 39-02, 39-06, 39-10 | ✓ SATISFIED | Resolvers, settings fields, settings UI all verified |
| P39-06 | 39-02, 39-06, 39-09 | ✓ SATISFIED | Migration verified in code and by 39-09's own dev smoke |
| P39-07 | 39-05, 39-07, 39-08, 39-09 | ⚠️ PARTIALLY SATISFIED | Planning/gating/placeholders correct; fallback-grid gate has a real defect (gap #22) |
| P39-08 | 39-05, 39-07 | ✓ SATISFIED | `chartAlbumHref` verified |
| P39-09 | 39-01 | ✓ SATISFIED | Image allowlists verified |
| P39-10 | 39-10 | ✓ SATISFIED | Settings redesign verified |
| P39-11 | 39-02, 39-10 | ✓ SATISFIED | i18n parity test green |
| P39-12 | 39-05, 39-07, 39-09 | ⚠️ PARTIALLY SATISFIED | Zero-request Randomize mechanism is correct; the same code path is where gap #22 lives |
| P39-13 | 39-01, 39-07 | ✓ SATISFIED | fuseCharts verified against live data |

No orphaned requirements — all 13 researcher-derived ids (P39-01..13) are claimed by at least one plan's frontmatter and were checked above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/api/deezer/chart/+server.ts` | 124-149 | Caches a 200-with-error-body / empty result for 1h | ⚠️ Warning | Genre shelf can go blank for up to 1h per device/PoP on a Deezer flake (WR-02) |
| `src/routes/api/deezer/chart/+server.ts` | 110-114 | Cache key built from the raw request URL, not validated params | ⚠️ Warning | Junk/non-canonical params can mint unlimited cache entries, burning the shared egress IP's Deezer rate budget (WR-03) |
| `src/routes/(app)/+page.svelte` | 1184 | Randomize stays enabled during a cold, classic-hidden chart load | 🛑 Blocker | Can trigger and stick the D-06 fallback grid for a session (WR-01) |
| `src/lib/components/CompactRow.svelte` | 97-100, 122 | Private `fallbackGradient()` duplicates `coverGradient()` | ℹ️ Info | Convention deviation only (CV-01 in 39-REVIEW.md); no functional impact |
| `src/routes/api/charts/+server.ts` | 24-25 | Route-local `jsonResult` alias re-added after the shared-primitive sweep | ℹ️ Info | Convention deviation only (CV-02); no functional impact |

No `TBD`/`FIXME`/`XXX` debt markers found in any file this phase modified.

### Human Verification Suggested (not blocking `status`, informational)

These were called out by the executors themselves as untestable in this sandbox/headless setup, or in
the environment notes for this run. They do not change the `gaps_found` status (which is driven by the
code-verified defects above), but a human should confirm them before fully trusting the phase in
production:

1. **Real Cache API + `waitUntil` semantics on deployed workerd** — `edgeCache()` is null under `vite dev`,
   so `/api/charts`' serve-stale path only ran against an in-memory shim in every test run (unit and live
   dev-server). Nothing is pushed yet. **Test:** after deploy, `curl -sI https://openmusic.lol/api/charts?src=apple&kind=songs&cc=hk` twice, ~6h apart, and confirm a stale hit still answers instantly with a background refill. **Why human:** requires the real Cloudflare edge.
2. **The "Auto (香港)" label for a zh-Hant app language with no region subtag** — `home-layout.test.ts` covers the resolver order, but the exact browser-rendered label was not observed (headless Chromium reported `en-US`). **Test:** open `/settings/home` on a zh-Hant device/profile and read the Chart-region Auto chip. **Why human:** needs a real `navigator.language` without a region subtag.
3. **iOS Safari / Android device behavior** — all E2E in the plan SUMMARYs ran via headless Chromium over CDP against the dev server; no physical device or iOS Safari was used. **Test:** load Home on an iPhone and an Android phone, confirm chart shelves render, covers load, and tapping a song plays. **Why human:** background-audio/PWA quirks and real-device rendering are this repo's own documented constraint.
4. **The exact WR-01 race in a live browser** — verified here by static code trace (independently reproducing 39-REVIEW.md's WR-01), not by an actual timed tap in a browser. **Test:** on a fresh profile with a throttled/slow connection, tap "Randomize" within ~1s of the Home page appearing and observe whether the generic "diverse picks" grid appears instead of the region chart shelves. **Why human:** needs precise timing against real network latency, which a static trace can describe but not time-box.

### Gaps Summary

Ten of ten plans landed the artifacts and wiring they promised, all 320 phase-scoped unit/route tests
plus the full 3244-test suite pass, `pnpm check` is clean, and `pnpm build` succeeds. Live requests
against the real Apple RSS, KKBOX kma, YouTube Charts, Deezer and legacy-iTunes upstreams (run
independently in this verification, not just trusted from SUMMARY narration) confirm the edge route,
the Deezer genre branch, the client iTunes feed and the RRF fusion all work exactly as specified — the
fresh regional chart data genuinely reaches the home page.

However, one FAILED must-have from 39-07's own contract is directly demonstrable in the current code and
was not caught by any of the plan's own tests or E2E runs (which never tapped Randomize during the cold
load window): because the new default layout hides every classic section, the Randomize button is
*always* enabled while the first chart fetch is still in flight. A press in that window can flip the page
into the old-style "diverse picks" fallback grid — the exact stale, non-regional experience this phase
exists to replace — and nothing clears it for the rest of that session. This is a BLOCKER: it directly
contradicts a stated 39-07 must-have ("the D-06 fallback grid appears only when every visible shelf is
empty") via an easily-reachable, non-hypothetical path, so the phase goal ("the home page shows what is
actually hot ... right now") is not reliably achieved.

Two further gaps (WR-02, WR-03 in 39-REVIEW.md, both still present and independently confirmed by code
read here) affect the Deezer genre-chart edge branch's caching hygiene. They are narrower — self-healing
within an hour and requiring an upstream Deezer flake or malformed params to manifest — so they are
scored as minor rather than blocking, but they should not be waved through silently since they were
flagged by code review and remain unfixed.

All three gaps already have a specific, small proposed fix on record in 39-REVIEW.md; none require new
design work.

---

*Verified: 2026-09-26T04:38:41Z*
*Verifier: Claude (gsd-verifier)*
