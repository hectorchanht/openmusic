---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 03
subsystem: api
tags: [charts, edge-cache, serve-stale, cloudflare, apple-music-rss, kkbox, youtube-charts, allowlist]

requires:
  - phase: 39-01
    provides: "parseAppleRss / parseKkbox / parseYtCharts + APPLE_/KKBOX_/YOUTUBE_IMAGE_HOSTS + fixtures"
  - phase: 39-02
    provides: "CHART_REGIONS / KKBOX_REGIONS / YT_REGIONS / ChartRegion"
provides:
  - "GET /api/charts?src=apple|kkbox|yt&kind=…&cc=… → { items } (OPTIONS 204)"
  - "src/lib/proxy/charts.ts: validateChartQuery, chartCacheKey, readChartEntry, writeChartEntry, serveChart, loadChartUpstream, ytChartsInit, CHART_* constants, YT_CHARTS_CLIENT_VERSION"
affects: [39-04 client chart services, 39-07]

tech-stack:
  added: []
  patterns:
    - "Serve-stale over caches.default: in-body fetchedAt, 48 h stored max-age, 6 h freshness, waitUntil refill that only overwrites on a non-empty parse"

key-files:
  created:
    - src/lib/proxy/charts.ts
    - src/routes/api/charts/+server.ts
    - src/routes/api/charts/charts-endpoint.test.ts
  modified: []

key-decisions:
  - "An empty /api/charts answer carries no browser Cache-Control; only non-empty answers get max-age=1800"

requirements-completed: [P39-01, P39-02]

duration: 5min
completed: 2026-09-26
---

# Phase 39 Plan 03: Edge /api/charts route Summary

**One verb-only edge route serves Apple Music RSS, KKBOX kma and YouTube Charts behind a closed allowlist. It keeps a canonical versioned cache key and serves stale entries over `caches.default` (fresh 6 h, stale 48 h, background refill through `waitUntil`), with a 5 s total upstream budget. Nothing empty is ever cached.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-26T02:56:24Z
- **Completed:** 2026-09-26T03:01Z
- **Tasks:** 2/2
- **Files:** 3 created

## Accomplishments

- `validateChartQuery` accepts exactly apple×songs|albums×27, kkbox×song|newrelease×hk|tw|sg and yt×tracks|artists×27, which bounds the cache at 114 keys. Everything else is null. It narrows through an `isIn` type guard, with no casts of user input and zero `as any`.
- `chartCacheKey` builds `/api/charts/_k?v=1&src&kind&cc` from the validated query only, so junk params map onto the same key.
- `serveChart`: on a miss it loads once and stores only a non-empty result. A fresh hit makes no subrequest. A stale hit returns immediately and schedules one refill through `ctx.waitUntil`. That refill overwrites the entry only when it parses non-empty, and a throwing refill never rejects.
- `loadChartUpstream` makes one `AbortSignal.timeout(5000)` per load, shared across the `fetchWithRetry(…, 1)` attempts, which gives a total budget. Non-2xx and non-JSON responses throw. The pure 39-01 parsers are bound to their per-source image allowlists.
- `ytChartsInit` sends `WEB_MUSIC_ANALYTICS` with the pinned version `'2.0'`, `hl` zh-TW for hk/tw and en for everything else, and `gl` = CC in upper case.
- `+server.ts` exports only `GET` and `OPTIONS`.

## Verification (observed)

- `pnpm vitest --run src/routes/api/charts/charts-endpoint.test.ts`: **44 passed** (31 helper tests, 12 GET, 1 OPTIONS). The test names match /stale/, /never.*cached/, /global/ and /junk|extra/.
- `pnpm test`: **148 files / 3146 tests passed**.
- `pnpm check`: **0 errors, 0 warnings** (4595 files).
- `pnpm build` (adapter-cloudflare): done.
- **Live smoke test on the running dev server (:5173) against the real upstreams:** apple/songs/hk, apple/albums/us, kkbox/song/hk, kkbox/newrelease/tw, yt/tracks/hk and yt/artists/us each returned 200 with 50 items, `cache-control: public, max-age=1800` and own-origin ACAO. Images came from mzstatic, i.kfs.io and yt3.googleusercontent. `kkbox/song/us` and `src=deezer` returned `{"items":[]}` with no Cache-Control. This proves the route does not hit the verb-only 500.
- Acceptance greps: 16 `^export` lines in charts.ts; the `YT_CHARTS_CLIENT_VERSION = '2.0'` line, `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` and `/api/charts/_k?v=` are present; 0 `as any`; 3 `items.length`. In the route: exactly 2 `export const` (GET, OPTIONS), 0 function/interface/type exports, `platform?.ctx` present, 0 `platform.context`.
- **Not verified here:** real Cache API semantics and a `waitUntil` refill on workerd. `edgeCache()` is null under `vite dev`, so the dev smoke test always takes the miss path, and the serve-stale logic is proven against the in-memory shim only. The post-deploy `curl -sI https://openmusic.lol/api/charts?...` check belongs to verify-work.

## Task Commits

1. **Task 1: edge helpers** — `d627bde` (test, RED) → `cd68c87` (feat, GREEN)
2. **Task 2: verb-only route + endpoint tests** — `08e3c0a` (test, RED) → `d2e140f` (feat, GREEN)

## Decisions Made

- An empty answer omits the browser ttl (see the deviation below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] No browser cache on an empty answer**
- **Found during:** Task 2
- **Issue:** The plan's GET always sent `jsonResult({ items }, origin, CHART_CLIENT_TTL_S)`. After a cold miss with an upstream failure, the browser would then cache `{ items: [] }` for 30 minutes and pin a blank shelf. That breaks the phase's "empty is never cached" rule at the one layer the edge rule does not cover.
- **Fix:** `items.length ? CHART_CLIENT_TTL_S : undefined`. A non-empty answer still sends `public, max-age=1800`. A test pins the empty case (no Cache-Control).
- **Files modified:** src/routes/api/charts/+server.ts
- **Commit:** d2e140f

**2. Test-file sequencing (TDD mechanics)**
- In Task 1, the helper `describe` imported only `$lib/proxy/charts`. The `./+server` import and the route/fixture blocks were added in Task 2's RED commit, so Task 1's GREEN did not depend on the route existing.

## Issues Encountered

None. Every upstream was reachable.

## Known Stubs

None.

## Next Phase Readiness

39-04 can call `apiFetch('/api/charts?src=…&kind=…&cc=…')` and read `{ items }`. An empty array means the shelf degrades, never an error.

## Self-Check: PASSED

- FOUND: src/lib/proxy/charts.ts, src/routes/api/charts/+server.ts, src/routes/api/charts/charts-endpoint.test.ts
- FOUND commits: d627bde, cd68c87, 08e3c0a, d2e140f
