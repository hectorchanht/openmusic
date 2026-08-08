---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 02
subsystem: api
tags: [cloudflare-workers, edge-proxy, deezer, refactor-extraction, never-throw, vitest]

# Dependency graph
requires:
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 01
    provides: nothing consumed directly (independent wave-1 sibling — no code overlap)
provides:
  - "$lib/proxy/deezer-cover.ts — the shared Deezer cover upstream call (OG-EP-03)"
  - "fetchDeezerCover(q, signal, retries, prefer, limit) — never-throw, two-valued: null = fault, { cover: null, artistPicture: null } = clean miss"
  - "reshapeDeezerSearch(data: unknown, limit, prefer) — unknown-widened so a raw parsed body can be handed in"
  - "safeDeezerImageUrl / safeDeezerPreviewUrl — the per-tier *.dzcdn.net https allow-list, renamed for the three-tier /api/og chain"
  - "deezerSearchUrl(q, limit) + DEEZER_COVER_TTL + DeezerCover / DeezerHit types"
  - "prefer 'xl' | 'big' variant selector (cover_xl 208 KB vs cover_big 73 KB) for crawler budgets"
affects: [30-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared proxy helpers live in $lib/proxy/*.ts, never exported from a +server.ts (verb-only export rule)"
    - "Never-throw fetch with a TWO-VALUED sentinel: null = fault (do not cache), empty object = clean miss (cacheable)"
    - "Per-tier safe<Source>ImageUrl allow-lists rather than one widened host list"
    - "An existing endpoint test suite used UNMODIFIED as the behavior-preservation proof for an extraction"

key-files:
  created:
    - src/lib/proxy/deezer-cover.ts
    - src/lib/proxy/deezer-cover.test.ts
  modified:
    - src/routes/api/deezer/search/+server.ts

key-decisions:
  - "fetchDeezerCover took a 5th `limit` param (not in the planned signature): the route's ?limit=N results payload has a live caller (deezerSearchTracks, deezer.ts:186, limit=10). The planned 4-arg signature would have silently dropped it — a real regression the harness does not cover."
  - "reshapeHit keeps the legacy xl-first order; `prefer` deliberately does not reach it — `results` is a client-only dedupe payload and /api/og reads cover/artistPicture only"
  - "fetchDeezerCover returns null on a non-ok response, so a non-ok upstream is no longer cached as an empty result for 24h (it previously was). Plan-directed, and it satisfies the cache-posture invariant: only successes may be cached."
  - "reshapeDeezerSearch narrows with a single Array.isArray(body.data) guard for BOTH the top hit and the results slice (the original array-guarded only the slice)"
  - "The route's cache key line (`new Request(url.toString())`) was left as-is per the plan's scope fence — the ownOriginCacheKey() cleanup is out of scope"

patterns-established:
  - "A +server.ts extraction is proven by its pre-existing endpoint test passing with ZERO edits; editing that file would invalidate the requirement"

requirements-completed: [OG-EP-03]

# Metrics
duration: 4min
completed: 2026-08-07
---

# Phase 30 Plan 02: Deezer Cover Extraction (OG-EP-03) Summary

**The Deezer cover upstream call now lives in `$lib/proxy/deezer-cover.ts` as a never-throw, two-valued (`null` = fault vs `{ cover: null, artistPicture: null }` = clean miss) `fetchDeezerCover` with an `'xl' | 'big'` variant selector, leaving `/api/deezer/search` a thin CORS + cache shell whose 19-test harness passes with zero edits.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-08T03:21:48Z
- **Completed:** 2026-08-08T03:25:37Z
- **Tasks:** 2/2

## What Was Built

### Task 1 — `src/lib/proxy/deezer-cover.ts` + thinned route (commit `4e5970f`)

Moved out of `src/routes/api/deezer/search/+server.ts`, per RESEARCH §C.12's per-symbol table:

| Export | Notes |
|---|---|
| `DEEZER_COVER_TTL = 86400` | was the route's private `TTL` |
| `DeezerCover` / `DeezerHit` | unchanged shapes, JSDoc moved with them |
| `safeDeezerImageUrl` | renamed from `safeImageUrl`; both guards verbatim (`/[)\s"'\\(]/` CSS/attribute-breaker reject + https-only + `*.dzcdn.net`), 6-line rationale JSDoc moved with it, plus a note that the allow-list is per-tier (T-wv8-05) |
| `safeDeezerPreviewUrl` | renamed from `safePreviewUrl` |
| `reshapeDeezerSearch(data: unknown, limit, prefer = 'xl')` | param widened to `unknown` and narrowed inside so `/api/og` can hand over a raw parsed body |
| `deezerSearchUrl(q, limit = 1)` | the passthrough-only fixed template, T-wv8-01 comment moved along |
| `fetchDeezerCover(q, signal, retries = 2, prefer = 'xl', limit = 1)` | never-throw with the enumerated null-return JSDoc list (itunes-cover.ts:83-100 posture) and the mandatory `// RAW fetch (not apiFetch — fetch→apiFetch audit)` tag |

`DEEZER_SEARCH`, `DzAlbum`/`DzArtist`/`DzResult`/`DeezerSearchResponse` and `reshapeHit` stayed module-private. A new private `pickAlbumCover(album, prefer)` holds the variant order in one place.

The route kept `jsonResult`, `GET`, `OPTIONS` and all cache orchestration — same 8000 ms `AbortSignal.timeout`, same `retries = 2`, same TTL, same WR-01 CORS re-application on a hit, same no-cache-write on error, same untouched `new Request(url.toString())` cache key. `grep '^export'` on the route shows only `GET` and `OPTIONS`.

### Task 2 — `src/lib/proxy/deezer-cover.test.ts` (commit `39f6df4`)

26 `it()` blocks over the now-directly-reachable helpers: the host allow-list (foreign host, `mzstatic` specifically, http, each of the six breaker chars, null/undefined/''/unparseable), both `prefer` orders and the artist-picture order, empty + malformed + non-object + `{ error }` bodies to the empty sentinel, the `limit>1` results payload and the no-id drop, URL encoding (incl. CJK and an injected `&limit=99` proving it is encoded), and the miss-vs-error contract with a comment naming OG-EP-01 negative caching as the reason it is two-valued. `vi.stubGlobal` + the `restoreAllMocks`/`unstubAllGlobals` lifecycle copied from the harness.

## Verification — commands actually run, with observed output

| Gate | Command | Observed |
|---|---|---|
| Baseline harness (pre-change) | `pnpm vitest --run …/deezer-endpoint.test.ts` | 1 file / 19 tests passed |
| Harness after extraction | same | 1 file / 19 tests passed |
| Harness UNMODIFIED | `git diff --exit-code …/deezer-endpoint.test.ts` | exit 0 (`UNMODIFIED`), re-checked after both commits |
| New helper tests | `pnpm vitest --run src/lib/proxy/deezer-cover.test.ts …/deezer-endpoint.test.ts` | 2 files / 45 tests passed |
| Typecheck | `pnpm check` | `4348 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` | `83 passed (83)` files, `1406 passed (1406)` tests |

Baseline was 82 files / 1380 tests; +1 file / +26 tests, zero regressions. The `tongwen-core` sourcemap notices in `pnpm test` output are pre-existing and unrelated.

Not verified (no environment for it): no live `api.deezer.com` request and no deployed-edge run — every assertion above is stubbed `fetch` + typecheck. The real-upstream and crawler checks belong to 30-03/30-06 per 30-VALIDATION.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `fetchDeezerCover` gained a 5th `limit` parameter the planned signature omitted**
- **Found during:** Task 1
- **Issue:** RESEARCH §C.12 and the plan both specified `fetchDeezerCover(q, signal, retries = 2, prefer = 'xl')` and a rewiring snippet calling it with no `limit`. The route's `?limit=N` mode (quick-260607-jau) feeds `DeezerCover.results`, and `deezerSearchTracks()` (`src/lib/services/deezer.ts:186`) is a live caller that passes `limit = 10`. Following the planned signature literally would have pinned every upstream request to `limit=1` and made `results` permanently undefined — a silent feature regression the untouched harness does NOT cover (it only ever asserts `limit=1`).
- **Fix:** appended `limit = 1` as the 5th parameter, threaded into both `deezerSearchUrl` and `reshapeDeezerSearch`; the route passes its clamped `limit`. 30-03 still gets the documented `(q, signal, retries, 'big')` call shape.
- **Files modified:** `src/lib/proxy/deezer-cover.ts`, `src/routes/api/deezer/search/+server.ts`
- **Commit:** `4e5970f`
- **Covered by:** the "threads `limit` through so the ?limit=N results payload is not regressed" test.

### Behavior notes (plan-directed, not deviations)

- **Non-ok upstream is no longer cached.** Previously `fetchWithRetry` had no `res.ok` check, so a non-ok response carrying valid JSON (e.g. a Deezer `{ error: … }` envelope) reshaped to the empty result and was written to `caches.default` with a 24h TTL. `fetchDeezerCover` returns `null` on non-ok (as the plan specifies), so the route now returns the empty payload WITHOUT a cache write. This is the cache-posture invariant (only successes cached) and no test asserted the old behavior.
- **`reshapeDeezerSearch` array narrowing is slightly stricter.** The original read `data?.data?.[0]` unguarded and `Array.isArray` only for the results slice; the extracted version uses one `Array.isArray` guard for both. Only differs for a non-array truthy `data.data` — malformed JSON, which is the never-throw domain either way.

## TDD Gate Compliance

Task 2 is marked `tdd="true"` but is a **test-only** task over code Task 1 already landed (the plan sequences extraction → coverage, and the extraction's own gate is a pre-existing harness). The RED gate is therefore not applicable in isolation: `test(30-02)` (`39f6df4`) follows the `refactor(30-02)` implementation commit (`4e5970f`) rather than preceding it. No `feat` commit exists because the plan adds no new behavior — it is a behavior-preserving extraction, which is exactly what the untouched harness proves.

## Assumption Drift (advisory)

**`fetchDeezerCover`'s planned arity assumed the route's only mode was cover-mode.**
- **Found during:** Task 1
- **Planned:** the route body reduces to `fetchDeezerCover(q, AbortSignal.timeout(8000), 2)` (RESEARCH §C.12 rewiring step 1).
- **Actual:** the route has a second, live mode (`?limit=N` → `results`), so the call is `fetchDeezerCover(q, AbortSignal.timeout(8000), 2, 'xl', limit)`.
- **Why:** §C.12's table was written from the cover path; the `jau` limit feature is documented in the very interface it moved but not in the rewiring snippet. Non-blocking — recorded so 30-03 knows the signature has a 5th arg it can ignore.

## For 30-03

`import { fetchDeezerCover, safeDeezerImageUrl, reshapeDeezerSearch, deezerSearchUrl } from '$lib/proxy/deezer-cover';`

- Deezer tier: `const dz = await fetchDeezerCover(q, tierSignal(deadline), 1, 'big');` — `null` → treat as an ERROR (do not negative-cache), `{ cover: null, … }` → a cacheable MISS, fall through to iTunes.
- `'big'` yields the 500 px `cover_big` (~73 KB) rather than the 208 KB `cover_xl`.
- The `safeItunesImageUrl` / `safeKuwoImageUrl` siblings are still to be written in `og-cover.ts` — copy `safeDeezerImageUrl`'s two guards verbatim, per-tier host only (RESEARCH §C.12).

## Threat Flags

None. No new network surface, endpoint, auth path or schema was introduced — the only fetch is the same `api.deezer.com` search call, moved. `T-wv8-05` and `T-wv8-01` mitigations moved verbatim with their code and are now directly unit-tested; `T-30-03` (extraction regression) is discharged by the unmodified harness.

## Known Stubs

None.

## Self-Check: PASSED

- `src/lib/proxy/deezer-cover.ts` — FOUND
- `src/lib/proxy/deezer-cover.test.ts` — FOUND
- `.planning/phases/30-…/30-02-SUMMARY.md` — FOUND
- commits `4e5970f`, `39f6df4` — FOUND in git log
