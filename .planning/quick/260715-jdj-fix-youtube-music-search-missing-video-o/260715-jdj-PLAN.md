---
quick_id: 260715-jdj
slug: fix-youtube-music-search-missing-video-o
title: Fix YouTube Music search missing video-only tracks (songs + videos filter merge)
date: 2026-07-15
mode: quick
autonomous: true
files_modified:
  - src/lib/proxy/ytmusic.ts
  - src/routes/api/ytmusic/search/+server.ts
  - src/routes/api/ytmusic/ytmusic-routes.test.ts
  - src/lib/sources/ytmusic.ts
  - src/lib/sources/ytmusic.test.ts
  - src/lib/sources/__fixtures__/ytmusic-search.json
must_haves:
  truths:
    - "YTMusic search returns video-only uploads (not just the Songs catalog) so YT-only tracks surface"
    - "A track present in both the songs and videos shelves is emitted once (songs variant wins)"
    - "A single upstream failure still returns the other shelf; both failing returns a shelf-shaped empty sentinel (no client contract-drift throw)"
  artifacts:
    - "VIDEOS_FILTER const in src/lib/proxy/ytmusic.ts"
    - "search route issues songs + videos InnerTube POSTs in parallel and merges"
    - "parseSearchEnvelope dedupes by videoId"
---

# Quick Task 260715-jdj: Fix YouTube Music search missing video-only tracks

## Problem (root cause — diagnosed against live InnerTube)

YTMusic search uses ONLY the "Songs" filter (`SONGS_FILTER`). Tracks that exist only as YouTube
**videos** (community/MV uploads, not YT-Music catalog "songs") never appear — exactly the niche,
CN-unavailable tracks this source is meant to add. Verified with `dUlAfTZkjpE` (摩四老年《港耆》):
songs-filter never returns it for any query; a **videos** filter returns it at row #0 inside a clean
`musicShelfRenderer → musicResponsiveListItemRenderer` (same structure the existing parser handles).

## Fix

Query **both** the Songs and Videos filters in parallel and merge the two shelves (songs first, so
official catalog rows outrank video rows); dedupe by videoId downstream.

### Task 1 — `src/lib/proxy/ytmusic.ts`: add VIDEOS_FILTER + a search helper
<read_first>
- src/lib/proxy/ytmusic.ts (SONGS_FILTER, WEB_REMIX_CONTEXT, SEARCH_URL, innerTubePost)
</read_first>
<action>
- Add `export const VIDEOS_FILTER = 'EgWKAQIQAWoKEAkQChAFEAMQBBAV';` next to SONGS_FILTER, commented:
  the YouTube "Videos" tab param — surfaces community/video uploads absent from the Songs catalog
  (the source's whole value for niche tracks); verified against live InnerTube (quick-260715-jdj).
- Add a small exported helper `searchInnerTube(query: string, params: string, signal?: AbortSignal): Promise<unknown>`
  that POSTs `SEARCH_URL` with `{ context: WEB_REMIX_CONTEXT, query, params }` via `innerTubePost`
  (reused by the route for both filters). Keep it edge-side; no visitorData (metadata endpoint).
</action>
<acceptance_criteria>
- `VIDEOS_FILTER` exported; `pnpm check` clean.
- src/lib/proxy/ytmusic.ts contains `searchInnerTube` (or the route composes both POSTs cleanly without duplication).
</acceptance_criteria>

### Task 2 — `src/routes/api/ytmusic/search/+server.ts`: parallel songs+videos, merge
<read_first>
- src/routes/api/ytmusic/search/+server.ts (current single-search route + edge-cache + empty-query/error sentinel)
- src/lib/proxy/ytmusic.ts (searchInnerTube, SONGS_FILTER, VIDEOS_FILTER)
</read_first>
<action>
- Run the two searches in parallel (`Promise.allSettled` — songs SONGS_FILTER, videos VIDEOS_FILTER).
- Return ONE merged envelope so the existing client recursive walk collects both shelves:
  `{ ytmusicMerged: [songsJson, videosJson] }` with SONGS FIRST (songs variant ranks above video).
- Resilience: if ONE search rejects, return `{ ytmusicMerged: [<the successful one>] }`; if BOTH reject
  (or the query is empty), return the SAME shelf-shaped empty sentinel the route returns today (so the
  client `parseSearchEnvelope` sees a shelf and returns `[]` rather than throwing contract-drift).
- Preserve empty-query short-circuit, edge-cache TTL, CORS/OPTIONS. Edge raw fetch only (no apiFetch).
</action>
<acceptance_criteria>
- Route test asserts: merged envelope contains rows from both shelves; a videos-only videoId survives;
  one-upstream-fails → other shelf still returned; both-fail/empty → empty sentinel, HTTP 200, no throw.
- `pnpm test src/routes/api/ytmusic/ytmusic-routes.test.ts` passes.
</acceptance_criteria>

### Task 3 — `src/lib/sources/ytmusic.ts`: dedupe parseSearchEnvelope by videoId
<read_first>
- src/lib/sources/ytmusic.ts (parseSearchEnvelope — recursive walk collecting every musicShelfRenderer's rows)
- src/lib/sources/ytmusic.test.ts + src/lib/sources/__fixtures__/ytmusic-search.json
</read_first>
<action>
- In `parseSearchEnvelope`, track emitted videoIds in a `Set<string>`; skip a row whose videoId is already
  emitted (songs shelf is walked first, so the songs variant wins the slot). No other parser change —
  the recursive walk already finds every `musicShelfRenderer`, including a merged videos shelf.
- Extend the fixture with a videos shelf (a second `musicShelfRenderer`), including one video-only row
  (e.g. videoId `dUlAfTZkjpE`) and one row duplicating a songs videoId (to prove dedupe). Add assertions:
  a video-only row parses to a Track (`uid` `ytmusic:dUlAfTZkjpE`); a videoId in both shelves emits once.
- Comment the change with the quick-task id.
</action>
<acceptance_criteria>
- `pnpm test src/lib/sources/ytmusic.test.ts` passes with the new dedupe + videos-shelf assertions.
- Zero `as any` in prod source; tabs; single quotes; `import type` where applicable.
</acceptance_criteria>

## Verify (mandatory)
- `pnpm check` clean + full `pnpm test` green (no regressions; ~1320 baseline).
- E2E via dev server (`preview_start name=dev`): `GET /api/ytmusic/search?q=港耆` → run the client parse (or
  assert the merged envelope contains it) → videoId `dUlAfTZkjpE` present. Stop the dev server after.

## Scope guard
Fully anonymous — no auth/OAuth/cookie/token/visitorData-for-user/library. Do NOT touch the stream route,
resolve(), or the kuwo-first off-hot-path exclusion. YTMusic stays off the auto-resolve floor.
