---
phase: 27-youtube-music-source
plan: 02
subsystem: api-proxy
tags: [ytmusic, innertube, edge-proxy, search, lyrics, visitor-data, cors]
requires:
  - "src/lib/proxy/http.ts (fetchWithRetry raw edge fetch + corsHeaders own-origin CORS)"
  - "src/lib/proxy/edge-cache.ts (edgeCache + ownOriginCacheKey — own-origin cache key)"
  - "src/hooks.server.ts (the single CORS seam / OPTIONS 204 preflight for all /api/*)"
provides:
  - "src/lib/proxy/ytmusic.ts — shared edge module: verified InnerTube consts (WEB_REMIX key/songs filter/context/endpoint URLs), innerTubePost(), getVisitorData(), findLyricsTab()/extractLyrics()"
  - "GET /api/ytmusic/search — edge InnerTube search forwarder (WEB_REMIX POST edge-side, own-origin JSON passthrough, edge cache, OPTIONS 204)"
  - "GET /api/ytmusic/lyrics — edge next->browse two-hop, returns { text, attribution } (or {} on miss/error)"
affects:
  - "src/lib/sources/ytmusic.ts search() (27-01) — its apiFetch('/api/ytmusic/search?q=') now has a real edge backend to parse"
  - "Plan 27-03 stream route — imports getVisitorData() + PLAYER_URL + innerTubePost + WEB_REMIX_KEY from the shared module"
  - "Plan 27-04 lyrics wiring — resolve()'s best-effort plain-lyrics fetch calls /api/ytmusic/lyrics"
tech-stack:
  added: []
  patterns:
    - "audius-style dedicated route (GET/OPTIONS, edgeCache TTL, jsonPassthrough + corsHeaders, no-cache-write-on-error)"
    - "thin edge forwarder: InnerTube POST edge-side, the row->Track parse stays client-side + unit-tested (27-01)"
    - "recursive-walk over untrusted InnerTube JSON typed via optional-chained interfaces (zero as any in prod source)"
    - "edge-managed anonymous visitorData: module-scope var + timestamp + edgeCache(), refresh-on-demand, never client-exposed"
key-files:
  created:
    - src/lib/proxy/ytmusic.ts
    - src/lib/proxy/ytmusic.test.ts
    - src/routes/api/ytmusic/search/+server.ts
    - src/routes/api/ytmusic/lyrics/+server.ts
    - src/routes/api/ytmusic/ytmusic-routes.test.ts
  modified: []
decisions:
  - "getVisitorData caches under a synthetic own-origin edgeCache key (https://openmusic.lol/__ytmusic__/visitorData) — NEVER the key-bearing upstream URL — with a ~6h soft TTL; a refresh (27-03 LOGIN_REQUIRED) clears the cache so a known-bad token is never reused"
  - "search route returns an empty-but-VALID shelf envelope (musicShelfRenderer w/ zero rows) on empty-q / upstream error, so the 27-01 client parse yields [] instead of tripping its shelf-absent contract-drift throw"
  - "lyrics route caches a genuine no-lyrics {} (TTL 1d) so a lyric-less track never re-pays the browse hop; upstream errors are NOT cached so a retry can succeed"
  - "innerTubePost throws on non-OK (caller picks the sentinel) and strips the query-string from its error message so the ?key= never lands in a log (T-27-02-02)"
metrics:
  duration: 7min
  tasks: 3
  files: 5
  completed: 2026-07-15
---

# Phase 27 Plan 02: YouTube Music Edge Routes + Shared InnerTube Module Summary

Built the two anonymous metadata edge routes for YouTube Music and the shared module they (and the
Plan 27-03 stream route) reuse. `GET /api/ytmusic/search` and `GET /api/ytmusic/lyrics` are thin,
well-commented forwarders that do the InnerTube WEB_REMIX POSTs edge-side (public key + client
context kept off the client bundle), matching the audius dedicated-route posture (own-origin CORS,
OPTIONS 204, edge cache, no-cache-write-on-error). `src/lib/proxy/ytmusic.ts` centralizes the verified
InnerTube constants, `innerTubePost`, the edge-managed anonymous `getVisitorData()` (the stream
route's dependency), and the pure `findLyricsTab`/`extractLyrics` walkers. Zero auth.

## What Was Built

### Task 1 (TDD) — shared edge module (`2b51c1d` RED, `687df28` GREEN)
- **`src/lib/proxy/ytmusic.ts`**: verified InnerTube consts as SCREAMING_SNAKE exports, each with its
  spike ref — `WEB_REMIX_KEY`, `SONGS_FILTER`, `WEB_REMIX_CONTEXT` (typed `InnerTubeContext`),
  `SEARCH_URL`/`NEXT_URL`/`BROWSE_URL` (music.youtube.com) + `PLAYER_URL` (www.youtube.com, for 27-03).
  The key literal appears exactly ONCE (composed into the four URLs), edge-side only.
  - `innerTubePost(url, body, opts?)` — RAW edge fetch via `fetchWithRetry` (never `apiFetch`), native
    `AbortSignal.timeout`, base InnerTube headers merged with an optional custom UA (27-03 ANDROID_VR),
    non-OK → throw with the query-string stripped from the message (no key in logs).
  - `getVisitorData(refresh?)` — grabs `responseContext.visitorData` from a WEB_REMIX search, caches it
    (module-scope var + timestamp AND `edgeCache()` under a synthetic own-origin key), reuses it, and
    re-fetches on `refresh===true`. Never throws — returns `null` on a grab miss so the 27-03 stream
    route can 502. Anonymous visitor token, NOT a user credential.
  - `findLyricsTab(nextJson)` → `{ browseId, disabled }`; `extractLyrics(browseJson)` →
    `{ text, attribution }` from `musicDescriptionShelfRenderer` (plain path), degrading to nulls.
    Both ported from spike-007 harness, re-typed over optional-chained interfaces (zero `as any`).
- **`ytmusic.test.ts`** (11 tests): consts present; `innerTubePost` body/custom-UA + non-OK throw
  (no key in message); `getVisitorData` grab + cache-hit-no-2nd-fetch + refresh re-fetch + null on
  no-token + null on upstream failure; `findLyricsTab`/`extractLyrics` parse + degrade.

### Task 2 — `GET /api/ytmusic/search` (`c351cd6`)
- **`search/+server.ts`**: mirrors the audius search route. Reads `q` (trim), empty → empty
  shelf-shaped envelope with no upstream call; edgeCache lookup on the own-origin key; on miss
  `innerTubePost(SEARCH_URL, { context, query: q, params: SONGS_FILTER })`, cache.put (TTL 600), return
  via `jsonPassthrough` (corsHeaders + Cache-Control). Upstream error → empty envelope, no cache write.
  OPTIONS → 204. The client adapter parses the returned JSON (27-01); the route does NOT parse.
- Tests (5): envelope passthrough + allowlisted CORS + songs-filter/query in the body; zero upstream
  fetches for empty/whitespace q; WEB_REMIX key absent from the response body AND headers; upstream
  error → shelf-shaped empty body; OPTIONS 204.

### Task 3 — `GET /api/ytmusic/lyrics` (`9679e6f`)
- **`lyrics/+server.ts`**: reads `videoId` (trim), empty → `{}` with no call; edgeCache per videoId;
  on miss `innerTubePost(NEXT_URL, { context, videoId, isAudioOnly:true })` → `findLyricsTab` → no
  browseId → cacheable `{}` (no browse hop); else `innerTubePost(BROWSE_URL, { context, browseId })` →
  `extractLyrics` → `{ text, attribution }` (TTL 1d). Upstream error → `{}` with NO cache write.
  OPTIONS → 204.
- Tests (5): with-lyrics two-hop returns `{ text, attribution }` (attribution carried, key absent);
  no-lyrics-tab → `{}` with exactly ONE fetch (no browse hop); empty videoId → `{}` no fetch;
  upstream error → `{}` (never a 500); OPTIONS 204.

## Deviations from Plan

None — the plan executed as written. Notes on choices made within the plan's latitude:
- The "empty InnerTube-shaped body" for empty-q / upstream-error was realized as a **valid shelf with
  zero rows** rather than `{}`, specifically so the 27-01 client parse (`parseSearchEnvelope`) returns
  `[]` instead of throwing its shelf-absent contract-drift error. Logged as a decision above.
- A one-line `res.json()` typed cast was added in the lyrics route test (svelte-check types
  `Response.json()` as `unknown`); this is a test-only cast to a concrete shape, not `as any`.

## Authentication Gates

None. Fully anonymous by design (scope guard honored): `getVisitorData` grabs an ANONYMOUS
`responseContext.visitorData` token, not a user credential — and search/lyrics don't use it at all
(metadata endpoints aren't bot-gated, spike 007). No account / OAuth / device-flow / cookie /
user-token / library-sync code was added anywhere.

## Notes for Downstream Plans

- **27-03** (stream route): import `getVisitorData`, `PLAYER_URL`, `innerTubePost`, and `WEB_REMIX_KEY`
  from `src/lib/proxy/ytmusic.ts`. Build the ANDROID_VR context (`InnerTubeContext` supports the
  optional `visitorData`/`androidSdkVersion`/`deviceModel` fields) and pass the ANDROID_VR user-agent
  via `innerTubePost(..., { headers: { 'user-agent': ... } })`. On `LOGIN_REQUIRED`/expiry call
  `getVisitorData(true)` to force a refresh. Media BYTES use raw `fetch` (Range passthrough), NOT
  `innerTubePost`/`apiFetch` — only the `player` JSON hop uses `innerTubePost`.
- **27-04** (lyrics wiring): `resolve()`'s best-effort plain-lyrics fetch should call
  `/api/ytmusic/lyrics?videoId=` (via `apiFetch`) and populate `Track.lrc` from `text`, carrying
  `attribution`. Timed LRC reuses the existing `crossSourceLyric` fallback.

## TDD Gate Compliance

- RED: `test(27-02)` commit `2b51c1d` — 4 behavioral assertions fail against the skeleton stubs
  (consts/degradation cases pass: 7/11).
- GREEN: `feat(27-02)` commit `687df28` — all 11 module assertions pass; `pnpm check` clean.
- No REFACTOR commit needed (clean on first green). Gate sequence (test → feat) satisfied.
- Tasks 2 and 3 are non-TDD `type="auto"` tasks (feat commits `c351cd6`, `9679e6f`).

## Verification

- `pnpm test -- src/lib/proxy/ytmusic.test.ts src/routes/api/ytmusic/ytmusic-routes.test.ts` — 2 files,
  21 tests passed.
- `pnpm test` (full suite) — 78 files, 1289 tests passed (+21 over 27-01's 1268; no regressions).
- `pnpm check` — 0 errors, 0 warnings.
- `grep -n "WEB_REMIX_KEY\|SONGS_FILTER\|EgWKAQIIAWoKEAkQBRAKEAMQBA" src/lib/proxy/ytmusic.ts` — verified
  consts present edge-side; the key literal (`AIzaSy…`) appears exactly ONCE in the module.
- Key/visitorData never appear in any client-facing response body (asserted for both routes); both
  routes answer OPTIONS 204 with allowlisted corsHeaders (never `*`).
