---
phase: 39-fresh-chart-homepage-apple-music-kkbox-and-youtube-chart-she
plan: 01
subsystem: api
tags: [charts, apple-music-rss, kkbox, youtube-charts, itunes-rss, deezer, parsers, rrf, security-allowlist]

requires: []
provides:
  - "src/lib/services/chart-parse.ts: parseAppleRss, parseKkbox, parseYtCharts, parseItunesGenreFeed, fuseCharts, stripLatinAlias, stripReleaseSuffix, resizeMzstatic, resizeYtThumb, ChartAlbum, ImageValidator"
  - "APPLE_IMAGE_HOSTS / KKBOX_IMAGE_HOSTS / YOUTUBE_IMAGE_HOSTS in src/lib/proxy/safe-image-url.ts"
  - "11 trimmed live fixtures under src/lib/services/__fixtures__/charts/"
affects: [39-03 edge charts route, 39-04 client chart services, 39-05 home orchestration]

tech-stack:
  added: []
  patterns:
    - "Parser takes an ImageValidator parameter, so one pure parser serves edge and client"
    - "Echo/genre gates: trust the body's own echo, not the HTTP status"

key-files:
  created:
    - src/lib/services/chart-parse.ts
    - src/lib/services/chart-parse.test.ts
    - src/lib/services/__fixtures__/charts/*.json (11 files)
  modified:
    - src/lib/proxy/safe-image-url.ts
    - src/lib/proxy/safe-image-url.test.ts

key-decisions:
  - "39-D-04: parseYtCharts returns [] unless the echoed countryCode equals cc (the global-fallback 200 is never trusted)"
  - "39-D-06: parseItunesGenreFeed keeps only rows whose category im:id equals the requested genre (bogus id = overall chart with a 200)"
  - "39-D-07: fuseCharts = reciprocal-rank fusion (k=60, cap 50) keyed by matchKey; list order is display precedence"
  - "39-D-03: KKBOX ' - subtitle' title suffixes are kept (display + unmeasured resolve impact)"

patterns-established:
  - "str()/rows() narrowing helpers: schema drift degrades to '' / [] instead of throwing, with zero `as any`"

requirements-completed: [P39-01, P39-09, P39-13]

duration: 7min
completed: 2026-09-26
---

# Phase 39 Plan 01: Chart parsers, fusion and image allowlists Summary

**Pure never-throw parsers for Apple Music RSS, KKBOX kma, YouTube Charts and the legacy iTunes genre feed, with a YouTube country-echo gate, an iTunes per-row genre gate, reciprocal-rank fusion for Top Songs, and three new image-host allowlists. All of it is pinned by 11 trimmed real responses.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-26T02:34:48Z
- **Completed:** 2026-09-26T02:41:12Z
- **Tasks:** 3/3
- **Files:** 15 (13 created, 2 modified)

## Accomplishments

- `chart-parse.ts` exports the exact `<interfaces>` contract. Every parser returns `[]` for null, undefined, `{}`, `[]`, `'garbage'` and `42`, reads at most 50 rows, and passes every image through the caller's validator. Result: zero `as any`, and no imports from stores, `$app` or svelte.
- YouTube: the real `cn` response echoes `countryCode: "global"` and parses to `[]`. An `hk` body read as `tw` also parses to `[]`, in both directions.
- iTunes: the real bogus-genre (99999) feed parses to `[]`. A single-entry feed, where `entry` is an object rather than an array, parses to one row.
- `fuseCharts` (RRF): a song on both charts ranks first. The first list's display strings win. The image is the first non-null one, and the inputs are not mutated. Ties keep first-appearance order, blank keys are skipped, the result is capped at 50, and when one list is empty the other passes through.
- The three allowlists accept mzstatic, i.kfs.io, yt3/lh3.googleusercontent, i.ytimg and yt3.ggpht. They reject lookalikes, apex domains and http.

## Verification (observed)

- `pnpm vitest --run src/lib/services/chart-parse.test.ts src/lib/proxy/safe-image-url.test.ts`: **49 passed** (36 chart-parse, including 9 under `fuseCharts (39-D-07 / P39-13)`; 13 safe-image-url), 215 ms.
- `pnpm test`: **147 files / 3063 tests passed**.
- `pnpm check`: **0 errors, 0 warnings** (4591 files).
- Every acceptance command produced the expected output: `global`, `false` (single entry is not an array), `true` (KKBOX Latin alias present), 11 fixture files with all JSON valid, and allowlist grep count 3.
- `grep -rn "__fixtures__/charts" src … | grep -v test` prints nothing, so no app source imports the fixtures.
- TDD gates in git: `test` 4353fde → `feat` f66a585 (parsers), `test` 218e2d8 → `feat` 7a1c869 (fusion).

## Task Commits

1. **Task 1: allowlists + fixtures** — `80df2c8` (feat)
2. **Task 2: parsers + helpers** — `4353fde` (test, RED) → `f66a585` (feat, GREEN)
3. **Task 3: fuseCharts** — `218e2d8` (test, RED) → `7a1c869` (feat, GREEN)

## Fixture provenance

- **All 11 fixtures are real.** None are synthetic. Each was captured live on 2026-09-25 with a scratchpad script (not committed) and trimmed to 5 rows with the envelope kept. The largest file is 8.6 KB.
- **`yt-cn-global.json` echoed `global` at capture time**, so no hand-edited variant was needed.
- `apple-hk-albums.json` contains real ` - EP` names: `Fallen Angel - EP` and `SYNK : COMPLaeXITY - 2026 Special Digital Single - EP`. No suffix was faked.
- `yt-hk-tracks.json` holds rows 0-3 plus the first multi-artist row (`旋轉木馬`, 米爺 / 黃淑蔓) instead of a plain slice(0,5), so the `', '` artist join is pinned by real data.
- `itunes-hk-1251-single.json` is derived from `itunes-hk-1251.json`: its `entry` is the first entry as a bare object.
- `itunes-bogus.json` rows carry ids 14 and 1251, and none carry 99999.

## Decisions Made

Covered by the key-decisions above. No other product decisions were made.

## Deviations from Plan

- **Minor fixture choice:** `yt-hk-tracks.json` keeps rows [0,1,2,3, first multi-artist] rather than the first 5, for the reason given above. The size limit and envelope are unchanged.
- The header comment of `chart-parse.ts` no longer names the fixture directory, so the plan's "no app source mentions `__fixtures__/charts`" grep stays clean. Nothing imported it anyway.

Otherwise the plan was executed as written.

## Assumption Drift (advisory)

- **Found during:** Task 3, checked against the full live charts.
- **Planned:** the Apple + KKBOX overlap would be detected by `matchKey`, with KKBOX subtitles kept (39-D-03).
- **Actual:** on today's HK charts, 3 songs share a title across the two sources. `matchKey` catches 2 of them (`Gareth.T / 玻璃`, `周杰倫 / 擱淺`). It misses `李佳薇 / 甲乙丙丁Strangers`, because KKBOX titles it `甲乙丙丁Strangers - 你我怎麼兩清` and `norm()` strips only remaster/live/acoustic/explicit/feat suffixes.
- **Why it matters:** a kept subtitle stops the song from rising in the fusion. It also shows up twice in Top Songs, once under each name. A fold such as `title.replace(/\s+-\s+.*$/, '')` for the fusion key only, with display unchanged, would fix it. That belongs to Open Question 5 or plan 39-04 and was not built here.

## Issues Encountered

None. Every upstream was reachable.

## Known Stubs

None.

## Next Phase Readiness

39-03 (edge route) and 39-04 (client services) can import the parsers and allowlists directly. The edge binds `(u) => safeImageUrl(u, APPLE_IMAGE_HOSTS | KKBOX_IMAGE_HOSTS | YOUTUBE_IMAGE_HOSTS)` as the `ImageValidator`.

## Self-Check: PASSED

- FOUND: src/lib/services/chart-parse.ts, src/lib/services/chart-parse.test.ts, all 11 fixtures, src/lib/proxy/safe-image-url.ts (+ test)
- FOUND commits: 80df2c8, 4353fde, f66a585, 218e2d8, 7a1c869
