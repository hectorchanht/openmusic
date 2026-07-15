---
quick_id: 260715-jdj
slug: fix-youtube-music-search-missing-video-o
title: Fix YouTube Music search missing video-only tracks (songs + videos filter merge)
date: 2026-07-15
mode: quick
status: complete
files_modified:
  - src/lib/proxy/ytmusic.ts
  - src/routes/api/ytmusic/search/+server.ts
  - src/routes/api/ytmusic/ytmusic-routes.test.ts
  - src/lib/sources/ytmusic.ts
  - src/lib/sources/ytmusic.test.ts
  - src/lib/sources/__fixtures__/ytmusic-search.json
commits:
  - c034af7 fix(260715-jdj): add VIDEOS_FILTER + searchInnerTube helper
  - 2dd5939 fix(260715-jdj): merge songs+videos shelves in ytmusic search route
  - d97779c test(260715-jdj): dedupe parseSearchEnvelope by videoId across merged shelves
---

# Quick Task 260715-jdj: Fix YouTube Music search missing video-only tracks Summary

YTMusic search now queries the Songs **and** Videos InnerTube filters in parallel and merges the two
shelves, so video-only community/MV uploads (the niche, CN-unavailable tracks this source exists for)
finally surface — with a per-videoId dedupe that keeps the official catalog variant when a track
appears in both shelves.

## What changed (per task)

### Task 1 — `src/lib/proxy/ytmusic.ts` (commit c034af7)

- Added `export const VIDEOS_FILTER = 'EgWKAQIQAWoKEAkQChAFEAMQBBAV'` next to `SONGS_FILTER`, with a
  decision-record comment (verified live; surfaces `dUlAfTZkjpE` 港耆 which the Songs filter never returns).
- Added `searchInnerTube(query, params, signal?)` — a thin exported helper that POSTs `SEARCH_URL` with
  `{ context: WEB_REMIX_CONTEXT, query, params }` via `innerTubePost`, so both filters share one
  fixed-URL edge POST instead of duplicating it. Anonymous metadata endpoint — no visitorData. Throws on
  a non-OK upstream so the route's `allSettled` records a per-filter failure.

### Task 2 — `src/routes/api/ytmusic/search/+server.ts` (commit 2dd5939)

- Route now runs `Promise.allSettled([searchInnerTube(q, SONGS_FILTER), searchInnerTube(q, VIDEOS_FILTER)])`
  and returns ONE merged envelope `{ ytmusicMerged: [songsJson, videosJson] }` — **songs first** so the
  catalog variant ranks above (and wins the client dedupe against) its video variant.
- Resilience contract honored exactly: one filter failing → `{ ytmusicMerged: [<the successful one>] }`;
  both failing (or empty query) → the SAME shelf-shaped `EMPTY_SEARCH_ENVELOPE` sentinel the route returned
  before, so the client `parseSearchEnvelope` sees a shelf and returns `[]` instead of throwing contract-drift.
- Edge cache is written **only for a full 2-shelf merge** — a partial (one filter failed) is left uncached
  so a retry can fetch the missing shelf (extends the existing "no cache write so retry can succeed" rule).
- Preserved: empty-query short-circuit (zero upstream calls), TTL, CORS/OPTIONS, edge raw fetch only (no apiFetch).
- Route tests rewritten/extended: merge order + videos-only survival, one-fail (both directions), both-fail
  sentinel (HTTP 200, no throw, `ytmusicMerged` absent), plus the preserved key-leak / empty-q / OPTIONS tests.

### Task 3 — `src/lib/sources/ytmusic.ts` + fixture (commit d97779c)

- `parseSearchEnvelope` now tracks emitted videoIds in a `Set<string>` and skips a row whose videoId is
  already emitted. The recursive walk already collects every `musicShelfRenderer` (and walks the
  `ytmusicMerged` array), so no structural parser change was needed — only the dedupe. Songs shelf is
  walked first (route order), so its variant wins the slot; `displayIndex` stays gap-free (only pushed rows
  increment the counter).
- Fixture extended with a second (Videos) `musicShelfRenderer`: one video-only row (`dUlAfTZkjpE` 港耆) and
  one duplicate of the top Songs row (`l6a5D6yxqEU`). Injected via a JSON round-trip that is byte-identical
  to the original formatting, so the diff is only the added shelf.
- Adapter tests added: the video-only row parses to `ytmusic:dUlAfTZkjpE`; the cross-shelf duplicate emits
  once with the Songs variant winning (`album === '魔杰座'`); and the `{ ytmusicMerged: [songsJson, videosJson] }`
  route shape is walked + deduped end to end.

## Merge contract (as implemented)

| Case | Response |
|------|----------|
| both filters succeed | `{ ytmusicMerged: [songsJson, videosJson] }` (songs first), cached for TTL |
| one filter fails | `{ ytmusicMerged: [<successful one>] }`, NOT cached |
| both fail / empty query | `EMPTY_SEARCH_ENVELOPE` (shelf-shaped sentinel), HTTP 200, NOT cached |

## Verification

- `pnpm check` — clean (0 errors, 0 warnings, 4337 files).
- `pnpm test` — **79 files, 1325 tests passed** (baseline ~1320; +5 new tests across the route + adapter
  files). No regressions.
- Deferred to orchestrator (per task instructions): dev-server E2E of `GET /api/ytmusic/search?q=港耆`
  asserting `dUlAfTZkjpE` is present in the merged/parsed result.

## Deviations from Plan

None material. Two convention-driven refinements within scope:
- Task 2 caches only a **full** 2-shelf merge (not a partial). The plan left partial-cache behavior
  unspecified; this matches the existing "leave uncached so a retry can succeed" philosophy already applied
  to the both-fail sentinel.
- Task 3 added a third adapter test (the `{ ytmusicMerged: [...] }` route-shape walk) beyond the two the plan
  named, to validate the route↔adapter merge contract directly (the core of the fix). Cheap, strengthens the
  safety net.

## Scope guard honored

Fully anonymous — no auth/OAuth/cookie/token/visitorData-for-user/library touched. The stream route,
`resolve()`, and the kuwo-first off-hot-path exclusion (`autoResolveEligible: false`) were NOT modified.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: all 6 modified files present on disk.
- Commits exist: c034af7, 2dd5939, d97779c all in `git log`.
- `VIDEOS_FILTER` exported; `searchInnerTube` present; route returns `ytmusicMerged`; parser dedupes by videoId.
