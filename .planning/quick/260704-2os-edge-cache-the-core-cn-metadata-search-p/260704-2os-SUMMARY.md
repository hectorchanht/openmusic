---
phase: quick-260704-2os
plan: 01
subsystem: api-proxy
tags: [edge-cache, performance, cors, proxy, cloudflare]
requires:
  - src/lib/proxy/http.ts (corsHeaders, fetchWithRetry)
  - src/lib/proxy/proxy-registry.ts (PROXIES)
  - caches.default (Cloudflare Cache API; absent in vite dev)
provides:
  - search-only edge cache on the /api/[source]/[...path] catch-all proxy
affects:
  - src/routes/api/[source]/[...path]/+server.ts
  - src/routes/api/proxy.test.ts
tech-stack:
  added: []
  patterns:
    - Inline EdgeCache/EdgeCacheStorage interfaces + edgeCache() typeof-caches dev guard (mirrors the Deezer route per-route convention)
    - Own-origin Request cache key (never the token-bearing upstream URL)
    - CORS-free cached body + per-request corsHeaders(origin) re-apply on a hit
key-files:
  created: []
  modified:
    - src/routes/api/[source]/[...path]/+server.ts
    - src/routes/api/proxy.test.ts
decisions:
  - "SEARCH_TTL=300 (5 min), deliberately NOT the Deezer 86400 — search results are volatile and a short TTL self-heals any briefly-bad entry within minutes while still absorbing the keystroke-hot repeat-search burst."
  - "Cache branches off the normalized [...path] segment (`type === 'search'`); the cache is only even instantiated when cacheable, so url/detail/lrc take a byte-identical passthrough (no cache read/write, no Cache-Control header)."
  - "Cache key = new Request(url.toString()) (own-origin), never the upstream URL — keeps the JOOX token out of the cache key (T-2os-02) and re-serves a CORS-free body so a cross-origin hit gets its own Access-Control-Allow-Origin (WR-01)."
  - "Inlined the edge-cache helper per the established per-route pattern; no shared cache module, no new npm dep."
metrics:
  duration: 8 min
  completed: 2026-07-04
  tasks: 2
  files: 2
  commits: 2
---

# Phase quick-260704-2os Plan 01: Edge-cache the CN metadata search path Summary

Edge-cache ONLY the 200-OK `search` responses of the `/api/[source]/[...path]` catch-all CN proxy (netease/qq/kuwo/joox) in `caches.default` with a short 300s TTL keyed by the own-origin request, while `url`/`detail`/`lrc` keep their exact streaming passthrough so no expiring audio/lyric URL is ever frozen.

## What Was Built

**Task 1 — search-only edge cache (commit `1bf4094`):**
- Added module-level `const SEARCH_TTL = 300;` with a justification comment (short metadata TTL, not the Deezer 86400).
- Inlined the `EdgeCache` / `EdgeCacheStorage` interfaces and the `edgeCache()` function with the `typeof caches === 'undefined'` dev guard (verbatim from the Deezer reference route), reusing the existing `corsHeaders` + `fetchWithRetry` imports — no new module, no new dep.
- Normalized the path exactly as the adapters do: `const type = (params.path || 'search').replace(/^\/+|\/+$/g, '');`, and `const cacheable = type === 'search';`.
- `const cache = cacheable ? edgeCache() : null;` and `const cacheReq = cacheable ? new Request(url.toString()) : null;` — the cache is not even looked up unless the segment is `search`, and the key is the own-origin request (never the token-bearing upstream URL).
- Cache HIT: reads `hit.text()` + stored `content-type`, returns a fresh 200 Response with `corsHeaders(origin)` re-applied for THIS request plus `Cache-Control: public, max-age=300`.
- Cache MISS + `res.status === 200` + `search`: buffers `res.arrayBuffer()` once, stores a CORS-FREE copy via `cache.put`, and returns the same buffer with per-request CORS + Cache-Control. Non-200 is never cached.
- All other segments (`url`/`detail`/`lrc`/empty/unknown) and the no-cache-API / non-200 cases fall through to the UNCHANGED `new Response(res.body, ...)` streaming passthrough with no Cache-Control header.
- Preserved the top-of-handler validation order (isKnownSource 404 → `!proxy` 404 → env read → buildUrl 400) so bad input can never reach the cache. `OPTIONS` untouched. Updated the header comment to note search now caches while url/detail/lrc stay a passthrough.

**Task 2 — vitest coverage (commit `4e95c94`):**
- Appended a `describe('/api/[source]/[...path] — search edge cache (CONCERNS perf #1)', ...)` block to the existing `src/routes/api/proxy.test.ts` (no new test file). Added a local `fakeEvent` with a configurable origin and a Map-backed fake Cache API (`match`/`put` `vi.fn` spies; body stored as buffered text + content-type and reconstructed per `match` since a Response body is single-use). `vi.unstubAllGlobals()` in `afterEach`.
- Five tests: (1) caches on 200 — two identical netease searches → one upstream `fetch`, one `cache.put`, equal body, `Cache-Control: public, max-age=300`; (2) never caches url/detail/lrc — `cache.put`/`cache.match` untouched, every call re-fetches, no Cache-Control header; (3) non-200 search not cached — 500 upstream → no `cache.put`, re-fetch on the next call; (4) cache hit re-applies CORS for the requesting origin — primed from `https://openmusic.lol`, hit served to `https://localhost` carries `Access-Control-Allow-Origin: https://localhost`, never the priming origin, never `*`; (5) dev fallback — `caches` undefined → live upstream body, status 200, no crash.

## Verification Results (actual)

- `pnpm check` (svelte-check): **0 errors / 0 warnings** (4297 files) — run after both tasks.
- `pnpm vitest run src/routes/api/proxy.test.ts`: **16 passed / 16** (11 pre-existing JOOX no-leak + hooks.server tests still green, 5 new search-cache tests pass). Verbose reporter confirmed all five new test names ran.
- Guardrail grep: `edgeCache()` is gated by `cacheable`; `res.body` streaming passthrough still present in the file.

## Guardrail Compliance

- Caches ONLY the `search` path — `url`/`detail`/`lrc` are byte-identical passthrough (no cache, no Cache-Control). ✅
- Writes only on `res.status === 200`. ✅
- Own-origin cache key (`new Request(url.toString())`), never the upstream URL (JOOX token never entered the key). ✅
- CORS re-applied per request on a hit from a CORS-free stored body; never `*`. ✅
- `typeof caches` guard keeps `vite dev` working (no-op, live body). ✅
- Existing security guards (isKnownSource 404, buildUrl 400, own-origin CORS, JOOX token never logged) preserved and run before any cache logic. ✅

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

This is a `type: tdd` plan structured as implementation-first (Task 1 route, Task 2 tests) per the plan's own task ordering and `<verify>` blocks. Git log for this plan shows a `feat(...)` commit (`1bf4094`) followed by a `test(...)` commit (`4e95c94`). The canonical RED-before-GREEN order (`test` then `feat`) is inverted here because the plan explicitly sequenced the route change (Task 1, verified by `pnpm check`) ahead of the test coverage (Task 2, verified by `pnpm vitest`). Both gates are present and the full suite is green.

## Self-Check: PASSED

- FOUND: src/routes/api/[source]/[...path]/+server.ts
- FOUND: src/routes/api/proxy.test.ts
- FOUND commit: 1bf4094 (feat — route)
- FOUND commit: 4e95c94 (test — coverage)
