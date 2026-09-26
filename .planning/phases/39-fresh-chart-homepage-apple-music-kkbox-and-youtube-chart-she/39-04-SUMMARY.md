---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 04
subsystem: api
tags: [charts, deezer, itunes-rss, client-services, apiFetch, ttl-cache, allowlist]

requires:
  - phase: 39-01
    provides: "parseItunesGenreFeed, ChartAlbum, APPLE_IMAGE_HOSTS, deezer-116 / itunes-* fixtures"
  - phase: 39-02
    provides: "CHART_GENRES, DEEZER_GENRE_IDS, ChartGenre, ChartRegion"
  - phase: 39-03
    provides: "GET /api/charts?src&kind&cc → { items } (empty = upstream failure, no browser cache)"
provides:
  - "GET /api/deezer/chart?genre={DEEZER_GENRE_IDS}&limit=N → { tracks, artists: [] }"
  - "src/lib/services/deezer.ts: deezerGenreChart(genreId, signal?)"
  - "src/lib/services/charts.ts: appleSongs, appleAlbums, kkboxSongs, kkboxNewReleases, ytTracks, ytArtists, itunesGenreChart, genreChart, CHART_POOL_TTL_MS"
affects: [39-05 home orchestration, 39-07]

tech-stack:
  added: []
  patterns:
    - "Empty-is-failure memo: a chart factory throws on an empty list so cached() never stores a blank shelf"
    - "Client-side third-party fetch through apiFetch (absolute URL passthrough, 32-D-13)"

key-files:
  created:
    - src/lib/services/charts.ts
    - src/lib/services/charts.test.ts
    - src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts
  modified:
    - src/routes/api/deezer/chart/+server.ts
    - src/lib/services/deezer.ts

key-decisions:
  - "Client chart memos treat an empty answer as a failure (never cached), matching 39-03's no-browser-cache-on-empty rule"
  - "The legacy iTunes genre feed is fetched client-side through apiFetch; a 403 is a governor success, so it cannot trip the breaker"

requirements-completed: [P39-01, P39-03, P39-04]

duration: 5min
completed: 2026-09-26
---

# Phase 39 Plan 04: Deezer genre branch + client chart services Summary

**`/api/deezer/chart` now serves Deezer genre charts behind the `DEEZER_GENRE_IDS` allowlist through its existing reshape. The new `charts.ts` gives the home page one governed, 6 h-memoised, never-throw function per shelf kind, plus the client-side legacy iTunes genre feed and a `genreChart` dispatcher driven by `CHART_GENRES`.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-26T03:02Z
- **Completed:** 2026-09-26T03:07Z
- **Tasks:** 2/2
- **Files:** 5 (3 created, 2 modified)

## Accomplishments

- **Route (39-D-16):** a `genre` that is in `DEEZER_GENRE_IDS` fetches `https://api.deezer.com/chart/{id}/tracks?limit=50` (the 50 is a literal) and feeds `{ data }` through the same `reshapeChart` and `safeImageUrl(DEEZER_IMAGE_HOSTS)` binding, answering `{ tracks, artists: [] }`. `999`, `abc` and a missing genre all fall through to today's `/chart` call. The raw-URL cache key keeps genre and no-genre entries separate. The stale "no params we pass through" comment is rewritten.
- **`deezerGenreChart`:** built on the `deezerChart` WR-03 posture, keyed `dz:chart:g{id}`, returning `DeezerChartTrack[]` (which is assignable to `DiscoveryTrack[]`).
- **`charts.ts`:** a private `fetchItems<T>` backs six wrappers over `/api/charts`, keyed `ch:{src}:{kind}:{cc}`. `itunesGenreChart` hits `https://itunes.apple.com/{cc}/rss/topsongs/limit=100/genre={id}/json` through `apiFetch`, keyed `it:genre:{cc}:{id}`, and parses with the 39-01 genre guard plus the Apple host allowlist. `genreChart` dispatches iTunes genres to their fixed storefront and Deezer genres to `deezerGenreChart`.

## Verification (observed)

- `pnpm vitest --run src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts`: **6 passed**. The names include `unknown genre (999)` and `distinct cache keys`.
- `pnpm vitest --run src/lib/services/charts.test.ts`: **36 passed**. The names include `single-entry`, `bogus genre 99999`, `already-aborted` and `dispatch: cantopop` / `dispatch: hiphop`.
- The three plan files (endpoint, charts and the existing `deezer.test.ts`) run together: **82 passed**, and `deezer.test.ts` shows no regression.
- `pnpm test`: **150 files / 3188 tests passed**.
- `pnpm check`: **0 errors, 0 warnings** (4599 files).
- `pnpm build` (adapter-cloudflare): done.
- Acceptance greps:
  - Route: 3 `DEEZER_GENRE_IDS` lines (import, gate, header comment) and one `/chart/${genre}/tracks?limit=50` line.
  - `deezer.ts`: one `export async function deezerGenreChart` and one `dz:chart:g`.
  - `charts.ts`: 8 exported functions, `export const CHART_POOL_TTL_MS`, 2 `apiFetch(`, 0 raw `fetch(`, the exact iTunes URL template and 0 `as any`.
- **Live dev smoke on :5173:** `/api/deezer/chart?genre=116&limit=3` returned 3 tracks (Drake / Kendrick Lamar / Shakira) with dzcdn images and `artists: []`. `?genre=999&limit=2` returned the overall chart (Tame Impala …). `https://itunes.apple.com/hk/rss/topsongs/limit=100/genre=1251/json` sent with an `Origin` header returned **200, `access-control-allow-origin: *`**.
- **Not verified here:** a real browser `fetch()` of the iTunes feed from the app origin. The curl result shows CORS `*` and a 200 from this machine's IP. The in-browser request itself was not run.

## Task Commits

1. **Task 1: Deezer genre branch + deezerGenreChart:** `ce36710` (test, RED) → `1af403f` (feat, GREEN)
2. **Task 2: charts.ts client services:** `61c7348` (test, RED) → `219f412` (feat, GREEN)

## Decisions Made

- Empty answers are never memoised on the client (see deviation 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] An empty chart answer is never memoised on the client**
- **Found during:** Task 2
- **Issue:** The plan's factories returned `[]` from inside `cached()` for an empty or malformed body, which stores it for 6 h. `/api/charts` answers `{ items: [] }` with a 200 when its upstream failed on a cold miss, and 39-03 deliberately sends no browser Cache-Control for that case. `/api/deezer/chart` likewise answers `{ tracks: [] }` with a 200 when Deezer throws. Caching those would pin a blank shelf for 6 h on the client, the same bug 39-03 fixed at the browser layer.
- **Fix:** `charts.ts` has a `nonEmpty()` guard that throws on an empty list inside the factory (for `fetchItems` and `itunesGenreChart`). `deezerGenreChart` throws on `!data.tracks?.length`. The caller still gets `[]` from the outer `.catch`. Tests pin a refetch after an empty answer for both paths. The existing `deezerChart` is left unchanged because it is outside this plan's scope.
- **Files modified:** src/lib/services/charts.ts, src/lib/services/deezer.ts
- **Commit:** 219f412

**2. Extra coverage beyond `<behavior>`**
- Added tests for: a genre chart whose `limit` clamps the reshape while the upstream stays at 50, the per-row guard on a mixed feed, an off-allowlist image mapping to null (T-39-17), a failure followed by a successful refetch, and kpop dispatch.

## Assumption Drift (advisory)

- **Found during:** Task 2
- **Planned:** "maps every failure to [] outside the cache" meant a non-ok response or a throw. An empty 200 was implicitly a cacheable success.
- **Actual:** both chart routes signal upstream failure with an empty 200, so on the client an empty result has to count as a failure.
- **Why:** 39-03's deviation (no browser cache on empty) implies the same rule for the client memo. Without it, one transient miss blanks a shelf for the whole 6 h TTL. Downside: a genre whose feed really is empty refetches on every refresh, one governed request each time.

## Issues Encountered

None. Every upstream was reachable.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the allowlisted `genre` param (T-39-16) and the client-side itunes.apple.com request (T-39-17 / T-39-19), and both are in the plan's threat model.

## Next Phase Readiness

39-05 can import from `$lib/services/charts` directly. Every function resolves (never rejects), so an empty array means the shelf degrades.

## Self-Check: PASSED

- FOUND: src/lib/services/charts.ts, src/lib/services/charts.test.ts, src/routes/api/deezer/chart/deezer-chart-endpoint.test.ts, src/routes/api/deezer/chart/+server.ts, src/lib/services/deezer.ts
- FOUND commits: ce36710, 1af403f, 61c7348, 219f412
