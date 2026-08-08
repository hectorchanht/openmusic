---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 03
subsystem: api
tags: [cloudflare-workers, edge-proxy, og-image, streaming, edge-cache, tiered-resolve, never-throw, vitest, tdd]

# Dependency graph
requires:
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 02
    provides: "fetchDeezerCover(q, signal, retries, prefer, limit) + safeDeezerImageUrl — the Deezer tier's implementation"
provides:
  - "GET /api/og?type=song|album|artist&artist=&title= — own-origin streaming cover endpoint for og:image (OG-EP-01/02)"
  - "$lib/proxy/og-cover.ts — resolveCoverTiered (Deezer → iTunes → kuwo, one 2.5s deadline, three-valued url|null|'ERROR')"
  - "safeItunesImageUrl (*.mzstatic.com) + safeKuwoImageUrl (*.kuwo.cn) — the per-tier host allow-lists"
  - "OG_FALLBACK_SVG + OG_FALLBACK_TYPE — the inlined 1200x630 branded card (zero network)"
  - "OG_TYPES / isOgType / OgType / OG_RESOLVE_MS — the closed card-type set + the resolve deadline"
  - "upgradeArtwork(url, size?) — optional iTunes artwork size (default 1200x1200bb unchanged)"
affects: [30-04, 30-05, 30-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tiered never-throw resolve: sequential tiers, TierOutcome hit/miss/error, only a MISS is cacheable"
    - "Per-tier AbortSignal.any budget under ONE overall deadline (the itunes-cover combinedSignal idiom)"
    - "Streaming byte proxy with a FRESH header allow-list + VALIDATED content-type (deezer shell + ytmusic-stream body)"
    - "TWO caches.default layers: raw request URL for bytes, matchKey-normalized synthetic key for the resolve"
    - "Size-capped clone() for a cache write so the documented clone()-buffers-everything cost stays bounded"
    - "A route that never fails: closed-set input COERCION instead of 404, outermost catch returning a branded 200"

key-files:
  created:
    - src/lib/proxy/og-cover.ts
    - src/routes/api/og/+server.ts
    - src/routes/api/og/og-endpoint.test.ts
  modified:
    - src/lib/services/itunes-cover.ts

key-decisions:
  - "resolveCoverTiered short-circuits on an empty artist+title itself (returns null with zero fetches), not just in the route — the module is the reusable unit and T-og-01 should hold for any caller"
  - "The bytes cache write builds a NEW CORS-free Response from streamed.clone().body rather than caching the clone directly; the clone carries this requester's Access-Control-Allow-Origin, and WR-01 requires the stored copy be header-clean"
  - "IMAGE_MS = 2500 is a SEPARATE budget from OG_RESOLVE_MS: the image fetch happens after the resolve deadline is spent, and folding it under the same signal would abort a hit that already cost 3 subrequests"
  - "cache reads are individually try/caught (not just the outermost catch) so a broken Cache API degrades to a cold resolve rather than to the branded fallback"
  - "await cache.put, NOT ctx.waitUntil — src/app.d.ts stays untouched per the plan's scope fence; every existing route awaits it too"
  - "Content-Type is parameter-stripped and allow-listed (image/jpeg|png|webp, image/jpg folded to jpeg); the live Deezer CDN sends 'image/jpeg; charset=binary', so a naive equality check would have fallen back on every real hit"

patterns-established:
  - "An /api/* route that must NEVER fail: coerce unknown input, try/catch every cache and network hop, and return a 200 branded body from the outermost catch"

requirements-completed: [OG-EP-01, OG-EP-02]

# Metrics
duration: 11min
completed: 2026-08-08
---

# Phase 30 Plan 03: `/api/og` Cover Endpoint (OG-EP-01/02) Summary

**`GET /api/og?type=&artist=&title=` now streams a real album cover from our own origin — resolved server-side through a bounded Deezer → iTunes → kuwo chain under one 2.5 s deadline, cached in two own-origin `caches.default` layers, and degrading to an inlined branded 1200×630 card on every possible fault — so a share link needs no `?c=` cover carrier at all.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-08T03:31:49Z
- **Completed:** 2026-08-08T03:42:34Z
- **Tasks:** 2/2 (each RED → GREEN, 4 commits)

## What Was Built

### Task 1 — `src/lib/proxy/og-cover.ts` (RED `0bfef78` → GREEN `c4b6a64`)

The tier chain lives in `$lib/proxy` (not the route) because a `+server.ts` may export only HTTP
verbs — a non-verb export 500s at request time and unit tests miss it entirely
(`svelte-server-endpoint-only-verb-exports`). That is what makes OG-EP-01 unit-testable.

| Export | Notes |
|---|---|
| `resolveCoverTiered(type, artist, title, deadline)` | sequential tiers; `deadline.aborted` re-checked before each; returns `url` \| `null` (clean all-miss, cacheable) \| `'ERROR'` (any tier faulted, never cacheable) |
| `safeItunesImageUrl` / `safeKuwoImageUrl` | `safeDeezerImageUrl`'s two guards verbatim (https-only + `/[)\s"'\\(]/` CSS/attribute-breaker reject) with `*.mzstatic.com` / `*.kuwo.cn` — three SEPARATE per-tier functions, never one widened list (T-wv8-05) |
| `OG_FALLBACK_SVG` / `OG_FALLBACK_TYPE` | `static/og.svg` inlined as a template literal: zero network, zero subrequest, zero loop risk on the worst-case path |
| `OG_TYPES` / `isOgType` / `OgType` | the closed card-type set + the narrowing predicate |
| `OG_RESOLVE_MS = 2500` | one constant, shared with the route |

Module-private: `TierOutcome`, `TIER_MS` (deezer 1200 / itunes 900 / kuwo 1200 — deliberately
over-summing, the deadline is the ceiling), `tierSignal()` (the `AbortSignal.any` feature-detect
copied from `itunes-cover.ts:76-81`, inline structural type on the global — no `as any`),
`OG_ARTWORK_SIZE = '600x600bb'`, and the three tiers.

Tier specifics as measured by research: Deezer calls `fetchDeezerCover(term, sig, 0, 'big')` and
maps `type === 'artist'` to `artistPicture`; iTunes reuses `buildItunesSearchUrl` (song → `song`,
album → `album`, artist → `album` + `attribute=artistTerm`, since `musicArtist` carries no
artwork); kuwo builds ONE search URL via `kuwoProxy.buildUrl` (which throws, so it sits inside the
never-throw `try`) and reads `data[0].pic` — no `/detail` follow-up — with `code !== 200` or a
non-array `data` classified as ERROR (drift) and an empty array as a cacheable MISS.

`itunes-cover.ts` changed by exactly one thing: `upgradeArtwork(url, size = '1200x1200bb')`. Client
tiles are byte-identical; `/api/og` asks for `600x600bb` (101 KB vs 332 KB, Pitfall 6).

### Task 2 — `src/routes/api/og/+server.ts` (RED `ec28a4d` → GREEN `6ef27d3`)

The deezer/search SHELL around the ytmusic/stream BODY:

- **Never 500s, never 30x.** Coerces an unknown `type` to `'song'`; caps `artist`/`title` at 200
  chars; try/catches every cache hop, the image hop, and the whole handler; every fault path
  returns `200` + `OG_FALLBACK_SVG`.
- **Streams**, does not redirect: `new Response(upstream.body, { headers })` with a FRESH header
  object (own-origin CORS + validated content-type + `public, max-age=86400, immutable` +
  `Content-Length` only when upstream supplied one). No upstream header is ever copied, so
  `Set-Cookie` cannot reach the client or the cached copy (`cache.put` throws on one).
- **Content-Type is validated, not relayed** — parameters stripped, `^image/` + a
  jpeg/png/webp allow-list; a CDN `text/html` error page is drained and falls back (T-30-04).
- **Two layers, both `ownOriginCacheKey`** (4 references; zero `new Request(url.toString())`
  hand-rolls): bytes on the request URL, resolve on
  `${origin}/api/og/_resolve?k=${matchKey(artist,title)}&t=${type}`. A clean `null` IS written
  (negative cache → repeat crawls cost 0 subrequests); `'ERROR'` writes nothing.
- **Bounded clone:** the bytes write only happens when `Content-Length` is finite, > 0 and
  ≤ `CACHE_BYTES_CAP = 3_000_000`, and the cached copy is rebuilt CORS-free from
  `streamed.clone().body` (WR-01) while the original streams to the crawler.
- `OPTIONS` → 204 with own-origin CORS. `src/app.d.ts` untouched (`await cache.put`, no
  `ctx.waitUntil`).

Test file: 41 `it()` blocks — 25 direct tier-chain/allow-list/constant cases plus 16 route-level
cases (short-circuit, coercion, input cap, streaming headers, html/non-ok/throw fallbacks, tier
faults, a throwing Cache API, OPTIONS, non-allow-listed origin, bytes-layer hit with CORS
re-application, own-origin key assertions, param-order resolve sharing, negative caching,
no-write-on-ERROR, no-Content-Length → no bytes write). Every case runs `platform: undefined`,
which is itself the assertion that all three tiers are keyless.

## Verification — commands actually run, with observed output

| Gate | Command | Observed |
|---|---|---|
| RED (task 1) | `pnpm vitest --run …/og-endpoint.test.ts` | `1 failed`, `Cannot find module '$lib/proxy/og-cover'` |
| GREEN (task 1) | same | `1 passed`, `25 passed (25)` |
| RED (task 2) | same | `1 failed`, cannot resolve `'./+server'` |
| GREEN (task 2) | same | `1 passed`, `41 passed (41)` |
| Typecheck | `pnpm check` | `4352 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` | `84 passed (84)` files, `1447 passed (1447)` tests |
| Build | `pnpm build` | `✓ built in 5.57s`, `@sveltejs/adapter-cloudflare ✔ done` |
| Scope fence | `git diff --exit-code src/app.d.ts` / `…/deezer-endpoint.test.ts` | both exit 0 — UNTOUCHED |
| Verb-only route | `grep '^export' src/routes/api/og/+server.ts` | only `GET` and `OPTIONS` |
| kuwo-only lock | `grep -c 'searchAll' src/lib/proxy/og-cover.ts` | `0` |
| Cache-key helper | `grep -c 'ownOriginCacheKey' …/+server.ts` / `grep -c 'new Request(url.toString())'` | `4` / `0` |

Baseline was 83 files / 1406 tests; now 84 / 1447 (+1 file, +41 tests), zero regressions. The
`tongwen-core` sourcemap notices are pre-existing and unrelated.

### Live corroboration — **resolved port `http://localhost:5173`**

`:4321` was NOT listening (no `launch.json` server running), so the executor started its own
`pnpm dev`, which Vite serves on `:5173`. Resolution was done with the mandated probe
(`DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173`). All three
upstreams answered `200` from this sandbox when probed directly (Deezer, iTunes, kuwo), so these
are genuine live tier resolutions, not stubs.

| Request | Observed |
|---|---|
| `GET /api/og?type=song&artist=Nirvana&title=Come+As+You+Are` | `200`, `image/jpeg`, **72,650 bytes** in 1.58 s — exactly the measured Deezer `cover_big` size, i.e. tier 1 answered |
| `HEAD` same URL (warm) | `200`, `content-type: image/jpeg`, `content-length: 72650`, `cache-control: public, max-age=86400, immutable` |
| `GET /api/og?type=album&artist=Nirvana&title=Nevermind` | `200`, `image/jpeg`, 70,313 bytes |
| `GET /api/og?type=artist&artist=Nirvana` | `200`, `image/jpeg`, 199,741 bytes (see Deferred) |
| `GET /api/og?type=song&artist=周杰倫&title=稻香` (CJK) | `200`, `image/jpeg`, 49,589 bytes |
| `GET /api/og` (no params) | `200`, `content-type: image/svg+xml`, 1,493 bytes — branded card |
| `GET /api/og?type=banana&artist=Nirvana&title=x` | `200` (coerced to `song`, never fails) |
| `GET /api/og?...&artist=zzqqxx9&title=zzqqxx9nosuchsong` | `200`, `image/svg+xml` — the real all-tier-miss fallback |
| `OPTIONS /api/og` | `204` |

**Cold-start caveat (dev-only, worth knowing):** the very FIRST request to the route returned the
branded SVG. Vite compiles the SSR module on demand, and that cold compile consumed the 2.5 s
resolve deadline. Every subsequent request returns the real cover. On workerd the module is
pre-bundled, so this is a `vite dev` artifact — but it is the deadline behaving exactly as designed
(fall through, never hang, never fail).

**Not verified here (no environment for it):** real `caches.default` behavior —
`edgeCache()` returns `null` under `vite dev` by design (Pitfall 8), so BOTH cache layers are
proven only by the in-memory `caches.default` stub in the unit tests. TTL, eviction, edge hit-rate
and real crawler rendering need the deploy (30-06). `pnpm preview` was not run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Content-Type` had to be parameter-stripped, not compared whole**
- **Found during:** Task 2
- **Issue:** The plan says "validate Content-Type against `^image/` + the jpeg/png/webp allowlist".
  A literal set-membership test on the raw header value fails on every real hit — the Deezer CDN
  sends `image/jpeg; charset=binary` (observed live), so a whole-value check would have fallen back
  to the branded card 100 % of the time while all unit tests using a bare `image/jpeg` stub passed.
- **Fix:** `normalizeImageType()` splits on `;`, trims, lowercases, requires the `image/` prefix,
  folds `image/jpg` → `image/jpeg`, then checks the allow-list. The route test stubs
  `image/jpeg; charset=binary` specifically so the parameter case is locked in.
- **Files modified:** `src/routes/api/og/+server.ts`
- **Commit:** `6ef27d3`

**2. [Rule 2 - Missing critical functionality] The bytes cache write was rebuilt CORS-free**
- **Found during:** Task 2
- **Issue:** RESEARCH §C.10's snippet caches `streamed.clone()` directly, but `streamed` already
  carries THIS requester's `Access-Control-Allow-Origin`. Caching it violates WR-01 — the invariant
  the deezer route documents at length — and would hand a preview-origin requester a prod ACAO (or
  vice versa) if the cached headers were ever relayed.
- **Fix:** the cached entry is a new `Response(streamed.clone().body, …)` with only
  content-type / Cache-Control / Content-Length; `withCors()` re-applies CORS per request on a hit.
  Asserted by the cache-hit test, which requests the second time from a DIFFERENT allow-listed
  origin and expects that origin back.
- **Files modified:** `src/routes/api/og/+server.ts`
- **Commit:** `6ef27d3`

**3. [Rule 2 - Missing critical functionality] Per-hop try/catch around the cache reads**
- **Found during:** Task 2
- **Issue:** With only the outermost catch, a `caches.default` that throws on `match` would
  short-circuit a request that could have resolved perfectly well, turning a transient cache fault
  into a branded (wrong) card.
- **Fix:** `readResolveCache` / `writeResolveCache` / the bytes `match` each swallow their own
  failure and degrade to "cache miss". A dedicated test stubs a Cache API that throws on both
  methods and asserts a 200.
- **Files modified:** `src/routes/api/og/+server.ts`
- **Commit:** `6ef27d3`

### Plan-directed choices worth flagging (not deviations)

- **`resolveCoverTiered` also short-circuits an empty artist+title** (zero fetches), duplicating the
  route's T-og-01 guard. The module is the reusable unit; the invariant should not depend on the
  caller.
- **`IMAGE_MS` is a separate 2500 ms budget** rather than a continuation of `OG_RESOLVE_MS`. Folding
  the image hop under the resolve deadline would abort a hit that already cost up to 3 subrequests.
- **`grep -c 'searchAll'` in `og-cover.ts` is 0** — the header comment originally used that word
  while documenting the kuwo-only lock, which tripped the mechanical criterion; it now says "the
  catalog's multi-source search fan-out". Same meaning, criterion satisfied.

## Assumption Drift (advisory)

**The plan assumed a cover URL's `Content-Type` header would be a bare media type.**
- **Found during:** Task 2
- **Planned:** "validate Content-Type against `^image/` + the jpeg/png/webp allowlist" — phrased as
  a membership test.
- **Actual:** real CDN responses carry parameters (`image/jpeg; charset=binary`), so validation has
  to normalize before comparing.
- **Why:** RESEARCH §C.10 measured sizes and hosts but recorded the type as `image/jpeg`. Recorded
  because it is the one place where a passing unit suite could have shipped a 100 %-fallback
  endpoint (see Deviation 1).

**The plan assumed `:5173` because it assumed the executor starts its own dev server.**
- **Found during:** Task 2 live corroboration
- **Planned/Actual:** both resolutions were pre-authorized; the probe resolved to `:5173` because
  nothing was listening on `:4321`. No impact — recorded so the port in the criteria table is not
  read as an assumption that held by luck.

## Deferred Issues

Logged to
`.planning/phases/30-carrier-free-share-links-type-artist-title-api-og/deferred-items.md`:

- **The Deezer ARTIST tier streams `picture_xl` (~200 KB)** instead of a 500 px variant, because
  `reshapeDeezerSearch`'s `prefer` selector reaches `pickAlbumCover` only, never the
  `picture_xl ?? picture_big` order. Observed live at 199,741 bytes vs 70–73 KB for song/album.
  Under the 3 MB cap and under Pitfall 6's 332 KB warning, so it streams correctly — just ~3×
  larger than needed. `src/lib/proxy/deezer-cover.ts` is outside this plan's scope fence (30-02
  owns it), so the one-line fix is deferred rather than smuggled in.

## For 30-04

`ogImageUrl(origin, type, artist, title)` should emit
`${origin}/api/og?type=${type}&artist=${enc(artist)}&title=${enc(title)}`. The endpoint is live and
verified for all three `type` values; an unknown `type` coerces rather than failing, and an empty
`artist`+`title` is a zero-subrequest branded card, so a partially-built URL can never break a
card. For the in-app `<img>` remember Pitfall 7 — route it through `apiUrl()` or the APK resolves
`/api/og` to `https://localhost/api/og`.

## TDD Gate Compliance

Both tasks ran a real RED → GREEN cycle, and the gate sequence is visible in `git log`:
`test(30-03) 0bfef78` → `feat(30-03) c4b6a64` → `test(30-03) ec28a4d` → `feat(30-03) 6ef27d3`. Each
RED was observed failing (module-resolution failure on the not-yet-written module) before the
implementation commit. No REFACTOR commit was needed.

## Threat Flags

None beyond the plan's register. `/api/og` is new network surface, but it is exactly the surface the
`<threat_model>` enumerates, and every disposition is discharged in code and asserted in tests:
T-24-08 (no URL parameter exists — text only, length-capped), T-wv8-05 (three per-tier host
allow-lists, plus explicit cross-tier smuggling tests), T-wv8-06 (both cache keys own-origin,
asserted `not.toContain` for all three upstream hosts), T-wv8-04 (`retries=0`, per-tier budgets
under one 2.5 s deadline, ≤4 subrequests, negative caching, 24 h TTL), T-og-01 (zero-subrequest
empty-query path), T-og-02 (`CACHE_BYTES_CAP`), T-30-04 (validated Content-Type). No package was
installed (T-{30}-SC).

## Known Stubs

None. Every code path is wired and live-verified; the branded SVG fallback is intentional
end-state behavior (and a PNG raster is a pre-existing, separately logged follow-up), not a stub.

## Self-Check: PASSED

- `src/lib/proxy/og-cover.ts` — FOUND
- `src/routes/api/og/+server.ts` — FOUND
- `src/routes/api/og/og-endpoint.test.ts` — FOUND
- `src/lib/services/itunes-cover.ts` — modified (upgradeArtwork size param), verified in `git log -p`
- `30-03-SUMMARY.md` / `deferred-items.md` — FOUND
- commits `0bfef78`, `c4b6a64`, `ec28a4d`, `6ef27d3` — all FOUND in git log
