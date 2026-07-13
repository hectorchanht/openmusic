---
quick_id: 260713-mqv
title: Fill edge-cache gaps + dedupe the shared edgeCache() helper
status: ready
date: 2026-07-13
---

# Quick Task 260713-mqv: Worker cache — fill gaps + dedupe

## Context / discovery

Cloudflare edge caching via `caches.default` is **already implemented** across most of the
`/api/*` proxy (quick-260704-2os and siblings):

- Catch-all `search` (`[source]/[...path]`, netease/qq/kuwo/joox) — 300s
- All deezer routes (search / artist / artist-albums / album / chart / related) — 86400s
- jamendo/search — 1h · audius/search — 10min · fivesing/search — 1h
- lastfm/discovery — per-method TTL (charts 1h, tags 6h, topAlbums 24h)

Two real gaps remain:

1. **Coverage gap** — three GET routes hit upstream on every request (no cache):
   - `src/routes/api/similar/+server.ts` (artist.getSimilar → `{ artists: string[] }`)
   - `src/routes/api/lastfm/similar-tracks/+server.ts` (track.getSimilar → `{ tracks: [] }`)
   - `src/routes/api/lastfm/info/+server.ts` (artist/track/album getinfo)
   - **NOT** `translate` — POST + soft-fail echo pattern, intentionally uncacheable.
2. **Duplication debt** — the `EdgeCache`/`EdgeCacheStorage` interfaces + `edgeCache()`
   accessor are copy-pasted across **11 files** (a CLAUDE.md Anti-Pattern: cache-write
   duplication).

The blog the user linked describes Cloudflare's NEW declarative Workers Cache
(`cache: { enabled: true }` + `Cache-Tag` purge). We deliberately do **not** adopt it here:
it targets Workers, this app deploys to Cloudflare **Pages**, and the imperative
`caches.default` pattern is already proven project-wide. Staying consistent = lower risk.

## The canonical cache pattern (mirror deezer/search + lastfm/discovery)

- Cache key = **own-origin** request `new Request(url.toString())` — NEVER the secret-bearing
  upstream URL (a LASTFM_KEY/JOOX-token upstream URL must never leak into a cache key).
- Guard `typeof caches` (absent under `vite dev`) → `edgeCache()` returns `null`, live upstream.
- On a hit: re-parse the CORS-FREE stored body and re-apply `corsHeaders(origin)` for THIS
  request (WR-01 — a cross-origin preview/prod hit must never receive a prior requester's
  Access-Control-Allow-Origin) + `Cache-Control: public, max-age=<ttl>`.
- `cache.put` a **CORS-FREE** copy ONLY on a successful upstream parse. NEVER cache the
  `!key` / invalid-param / `data.error` / catch (`EMPTY`) responses — those keep NO
  Cache-Control and are never written (self-heal within TTL, and errors never freeze).

## Tasks

### Task 1 — Extract shared edge-cache module (dedupe)
**Files:** create `src/lib/proxy/edge-cache.ts`; edit the 11 duplicating routes.

- Create `src/lib/proxy/edge-cache.ts` exporting:
  - `export interface EdgeCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void>; }`
  - `export function edgeCache(): EdgeCache | null` (the `typeof caches` guard + `caches.default` narrowing, with the existing explanatory comment consolidated here).
  - `export function ownOriginCacheKey(url: URL | string): Request { return new Request(url.toString()); }` (documents the own-origin-key invariant in one place).
- Replace the local `EdgeCache`/`EdgeCacheStorage`/`edgeCache()` block in each of these with
  `import { edgeCache } from '$lib/proxy/edge-cache';` (add `type EdgeCache`/`ownOriginCacheKey`
  only where referenced). Leave each site's existing `new Request(url.toString())` call and all
  other behavior UNCHANGED — this task is a pure no-behavior-change extraction:
  - `src/routes/api/[source]/[...path]/+server.ts`
  - `src/routes/api/deezer/search/+server.ts`
  - `src/routes/api/deezer/related/+server.ts`
  - `src/routes/api/deezer/chart/+server.ts`
  - `src/routes/api/deezer/artist-albums/+server.ts`
  - `src/routes/api/deezer/artist/+server.ts`
  - `src/routes/api/deezer/album/+server.ts`
  - `src/routes/api/jamendo/search/+server.ts`
  - `src/routes/api/audius/search/+server.ts`
  - `src/routes/api/fivesing/search/+server.ts`
  - `src/routes/api/lastfm/discovery/+server.ts`
- **verify:** `pnpm check` clean; `pnpm test` green (existing cache-hit tests in
  proxy.test.ts / deezer-endpoint.test.ts / lastfm-discovery-endpoint.test.ts still pass —
  they exercise the same runtime behavior through the handlers).
- **done:** exactly one `function edgeCache()` definition remains in the repo (in the new
  module); `grep -rn "function edgeCache" src/lib src/routes` → 1 hit.
- Commit: `refactor(proxy): extract shared edgeCache() into $lib/proxy/edge-cache (quick-260713-mqv)`

### Task 2 — Add edge caching to the 3 uncached GET routes (coverage)
**Files:** edit `similar/+server.ts`, `lastfm/similar-tracks/+server.ts`, `lastfm/info/+server.ts`.

For each route, mirror the deezer/search cache flow:
- Import `edgeCache`, `ownOriginCacheKey` from `$lib/proxy/edge-cache`.
- Add an optional `ttl?: number` param to its json helper (`jsonArtists` / `jsonTracks` /
  `jsonInfo`) that adds `Cache-Control: public, max-age=${ttl}` only when `ttl != null`
  (copy the `lastfm/discovery` `jsonX(result, origin, ttl?)` shape).
- After param validation, before the upstream fetch: `const cache = edgeCache(); const cacheReq = ownOriginCacheKey(url);`
  On `cache.match(cacheReq)` hit → re-parse JSON, return via the json helper with `(payload, origin, TTL)`.
- On successful upstream parse: `cache.put(cacheReq, <CORS-free Response with Cache-Control>)`, then return `(payload, origin, TTL)`.
- Keep every `EMPTY`/error/`!key`/invalid-param return exactly as-is (no ttl → no cache write).
- TTLs (module const per route, with a one-line rationale comment):
  - `similar` (artist.getSimilar): `86400` — recommendation graph is near-static (parity with lastfm topAlbums 24h).
  - `lastfm/similar-tracks` (track.getSimilar): `86400` — same stable recommendation graph.
  - `lastfm/info` (getinfo): `21600` (6h) — bio/tags static but listeners/playcount drift.
- Tag new comments with `quick-260713-mqv`.
- **verify:** `pnpm check` clean.
- **done:** each of the 3 routes reads+writes `caches.default` for the success path only.
- Commit: `feat(proxy): edge-cache similar / lastfm similar-tracks / lastfm info (quick-260713-mqv)`

### Task 3 — Cache-hit tests for the 3 newly-cached routes
**Files:** extend `similar/similar-endpoint.test.ts`, `lastfm/similar-tracks/similar-tracks-endpoint.test.ts`, `lastfm/info/lastfm-info-endpoint.test.ts`.

- Mirror the existing `deezer-endpoint.test.ts` pattern: stub an in-memory `caches.default`,
  fire two identical requests, assert the SECOND is served from cache with **no second
  upstream fetch** (fetch spy called once).
- Add one negative assertion per route: an error/`EMPTY` response (e.g. `!key` or `data.error`)
  is NOT written to the cache (second identical request still fetches upstream).
- **verify:** `pnpm test` green (all ~67 files); `pnpm check` clean.
- **done:** each new route has a cache-hit + no-cache-on-error test.
- Commit: `test(proxy): cache-hit + no-cache-on-error for the 3 newly-cached routes (quick-260713-mqv)`

## Must-haves
- Truth: exactly ONE `edgeCache()` definition remains (in `$lib/proxy/edge-cache.ts`); all 14 consumers import it.
- Truth: similar / lastfm-similar-tracks / lastfm-info serve a repeat identical GET from `caches.default` with no second upstream fetch.
- Truth: error/EMPTY responses are never cached; cache key is always the own-origin URL, never the token-bearing upstream URL.
- Truth: `translate` (POST) remains uncached.
- Artifact: `src/lib/proxy/edge-cache.ts`.
- Key gate: `pnpm check` clean AND `pnpm test` green.
