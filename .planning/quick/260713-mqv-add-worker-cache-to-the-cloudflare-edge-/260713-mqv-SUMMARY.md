---
quick_id: 260713-mqv
title: Fill edge-cache gaps + dedupe the shared edgeCache() helper
status: complete
date: 2026-07-13
---

# Quick Task 260713-mqv: Worker cache — fill gaps + dedupe — Summary

**One-liner:** Extracted the copy-pasted `edgeCache()` accessor into a single `$lib/proxy/edge-cache` module (14 consumers, one definition) and added `caches.default` edge caching to the three previously-uncached GET routes (`/api/similar`, `/api/lastfm/similar-tracks`, `/api/lastfm/info`) — success-path only, own-origin cache key, error/EMPTY responses never written.

## What shipped

### Task 1 — Extract shared edge-cache module (dedupe) — commit `83e0c3f`
- Created `src/lib/proxy/edge-cache.ts` exporting `EdgeCache` (interface), `edgeCache()` (the `typeof caches` dev guard + `caches.default` narrowing) and `ownOriginCacheKey(url)` (the own-origin-key invariant in one place).
- Replaced the local `EdgeCache`/`EdgeCacheStorage`/`edgeCache()` block in all 11 duplicating routes with `import { edgeCache } from '$lib/proxy/edge-cache';`. Each site's existing `new Request(url.toString())` call and all other behavior left unchanged — pure no-behavior-change extraction.
- Files: `[source]/[...path]`, `deezer/{search,related,chart,artist-albums,artist,album}`, `jamendo/search`, `audius/search`, `fivesing/search`, `lastfm/discovery`.
- **Verified:** exactly ONE `function edgeCache()` definition remains (`grep -rn "function edgeCache" src/lib src/routes` → 1 hit, in the new module).

### Task 2 — Add edge caching to the 3 uncached GET routes (coverage) — commit `f980eca`
- Each route now imports `edgeCache, ownOriginCacheKey`, gained an optional `ttl?: number` on its json helper (Cache-Control emitted only when `ttl != null`, mirroring `lastfm/discovery`), reads `caches.default` on an own-origin key after param validation, and writes a CORS-free copy on the successful-upstream path only.
- TTLs: `similar` (artist.getSimilar) `86400`; `lastfm/similar-tracks` (track.getSimilar) `86400`; `lastfm/info` (getinfo) `21600` (6h).
- Every `!key` / invalid-param / `data.error` / `!entity` / catch EMPTY return kept exactly as-is → no ttl → no Cache-Control → never written to the cache.
- `translate` (POST) intentionally left uncached.

### Task 3 — Cache-hit + no-cache-on-error tests — commit `2dcad30`
- Extended the three existing endpoint test files (no new files) mirroring `deezer-endpoint.test.ts`: an in-memory `caches.default` stub, two identical requests, assert the 2nd is served from cache with the fetch spy called once, plus own-origin-cache-key and Cache-Control assertions.
- Added a no-cache-on-error assertion per route (malformed JSON for `similar`; Last.fm error-6 for `similar-tracks` and `info`): `put` is never called and a second identical request re-fetches upstream.
- Added `vi.unstubAllGlobals()` to each file's `beforeEach`/`afterEach` so the `caches` stub does not leak between tests.

## Truths verified
- Exactly ONE `edgeCache()` definition remains (in `$lib/proxy/edge-cache.ts`); 14 consumers import it (11 from Task 1 + 3 from Task 2).
- `similar` / `lastfm-similar-tracks` / `lastfm-info` serve a repeat identical GET from `caches.default` with no second upstream fetch (asserted by new tests).
- Error/EMPTY responses are never cached (no-cache-on-error assertions); cache key is always the own-origin URL, never the token-bearing upstream URL (`.not.toContain('audioscrobbler.com')` + `.not.toContain(FAKE_KEY)`).
- `translate` (POST) remains uncached (no edge-cache import).

## Deviations from Plan
None — plan executed exactly as written. Task 1 was a pure no-behavior-change extraction; no site's TTL, CORS handling, or cache-key construction was altered.

## Verification gates (both green)
- `pnpm check` → `COMPLETED 4323 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`
- `pnpm test` → `Test Files 75 passed (75)` / `Tests 1254 passed (1254)` (was 1242 before; +12 new cache tests).

## Commits
- `83e0c3f` refactor(proxy): extract shared edgeCache() into $lib/proxy/edge-cache (quick-260713-mqv)
- `f980eca` feat(proxy): edge-cache similar / lastfm similar-tracks / lastfm info (quick-260713-mqv)
- `2dcad30` test(proxy): cache-hit + no-cache-on-error for the 3 newly-cached routes (quick-260713-mqv)

## Key files
- Created: `src/lib/proxy/edge-cache.ts`
- Modified (Task 1): `src/routes/api/[source]/[...path]/+server.ts`, `src/routes/api/deezer/{search,related,chart,artist-albums,artist,album}/+server.ts`, `src/routes/api/jamendo/search/+server.ts`, `src/routes/api/audius/search/+server.ts`, `src/routes/api/fivesing/search/+server.ts`, `src/routes/api/lastfm/discovery/+server.ts`
- Modified (Task 2): `src/routes/api/similar/+server.ts`, `src/routes/api/lastfm/similar-tracks/+server.ts`, `src/routes/api/lastfm/info/+server.ts`
- Modified (Task 3): `src/routes/api/similar/similar-endpoint.test.ts`, `src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts`, `src/routes/api/lastfm/info/lastfm-info-endpoint.test.ts`

## Self-Check: PASSED
- `src/lib/proxy/edge-cache.ts` exists (FOUND).
- Commits `83e0c3f`, `f980eca`, `2dcad30` present in `git log` (FOUND).
- Exactly one `edgeCache()` definition (1 hit); 14 consumers import the shared module.
