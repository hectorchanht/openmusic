---
phase: 27-youtube-music-source
plan: 01
subsystem: sources
tags: [ytmusic, source-adapter, innertube, search-parse, registry]
requires:
  - "src/lib/sources/types.ts (SourceId union, SourceAdapter, makeUid)"
  - "src/lib/sources/registry.ts (SOURCES enumeration)"
  - "src/lib/services/api-base.ts (apiFetch/apiUrl seam)"
provides:
  - "'ytmusic' SourceId + SourceAdapter.autoResolveEligible flag"
  - "ytmusic client adapter: search() InnerTube parse + resolve() deterministic stream-URL stamp"
  - "captured InnerTube WEB_REMIX search fixture (__fixtures__/ytmusic-search.json)"
affects:
  - "src/lib/services/catalog.ts searchAll (registry-driven — picks up ytmusic automatically)"
  - "src/lib/services/fallback.ts fallbackOrder (ytmusic currently included; flag-exclusion lands in 27-04)"
tech-stack:
  added: []
  patterns:
    - "audius-style deterministic own-origin resolve() (no client JSON hop)"
    - "netease/audius-style contract-drift throw for allSettled isolation"
    - "optional-chained typed access over untrusted InnerTube JSON (zero as any)"
key-files:
  created:
    - src/lib/sources/ytmusic.ts
    - src/lib/sources/ytmusic.test.ts
    - src/lib/sources/__fixtures__/ytmusic-search.json
  modified:
    - src/lib/sources/types.ts
    - src/lib/sources/registry.ts
    - src/lib/sources/registry.test.ts
    - src/lib/services/dedupe.ts
decisions:
  - "resolve() stamps a FIXED itag-140 AAC-128 quality tag (not inferQualityFromUrl) — the extension-less proxy path would otherwise mislabel it 320K (spike 006)"
  - "SOURCE_RANK in dedupe.ts extended with ytmusic:-1 — required for the total Record<SourceId,number> to typecheck once 'ytmusic' joined the union (non-mainstream tie-break like jamendo/audius)"
  - "Fixture is a REAL capture trimmed to shelf + 4 CJK rows (menu/trackingParams stripped) — matches the existing trimmed-fixture convention, keeps real evidence"
metrics:
  duration: 10min
  tasks: 2
  files: 7
  completed: 2026-07-15
---

# Phase 27 Plan 01: YouTube Music Source (Types + Registry + Adapter Search/Resolve) Summary

Wired YouTube Music into the source model as a first-class **anonymous** source: `'ytmusic'` is now a
typechecked `SourceId`, the adapter searches by porting the spike-005 InnerTube WEB_REMIX parse over a
real captured fixture (CJK-safe), and `resolve()` deterministically stamps the own-origin
`/api/ytmusic/stream/{videoId}` URL (the audius pattern). It is registered LAST and flagged
`autoResolveEligible: false` so it stays searchable-but-off the kuwo-first resolve floor. Zero auth.

## What Was Built

### Task 1 — `'ytmusic'` SourceId + `autoResolveEligible` flag; adapter registered last (`431a52e`)
- **`types.ts`**: extended `SourceId` with `'ytmusic'`; added optional `autoResolveEligible?: boolean`
  to `SourceAdapter` with a load-bearing doc comment (`false` = searchable + explicit-pick only, never
  an auto-resolve target; declared here, honored by failover/name-stub code in Plan 27-04).
- **`ytmusic.ts`**: new adapter mirroring `audius.ts` — `id:'ytmusic'`, `label:'YouTube Music'`,
  `enabledByDefault:true`, `autoResolveEligible:false`. `resolve()` stamps
  `apiUrl('/api/ytmusic/stream/' + encodeURIComponent(videoId))`, sets a fixed `128k` / `128k AAC`
  quality (itag 140 = 128 kbps AAC/mp4, spike 006), `detailsLoaded=true`; throws on a missing songid.
  No JSON hop, no lyrics fetch (Plan 27-04).
- **`registry.ts`**: imported `ytmusic`, appended LAST in `SOURCES`; extended the enumeration comment
  noting ytmusic is last + off the resolve floor; the kuwo→qq→netease→joox floor is unchanged.
- **`registry.test.ts`**: asserts `SOURCES.ytmusic` exists, `enabledByDefault===true`,
  `autoResolveEligible===false`, ytmusic is the last key (after audius), `getEnabledAdapters({})`
  includes it, mainstream sources' flags stay `undefined`, and `makeUid('ytmusic','abc')==='ytmusic:abc'`.

### Task 2 (TDD) — `search()` parse over a captured InnerTube fixture (`1ea5b71` RED, `3b3e5fc` GREEN)
- **`__fixtures__/ytmusic-search.json`**: a REAL captured WEB_REMIX songs-filter envelope for
  query "周杰倫 稻香" (live `music.youtube.com` POST, status 200), trimmed to the `musicShelfRenderer`
  + first 4 rows with parse-irrelevant `menu`/`trackingParams` stripped (28 KB, matches the existing
  trimmed-fixture convention in `__fixtures__/`).
- **`search()`**: walks the deeply/inconsistently nested envelope for every `musicShelfRenderer`'s
  `musicResponsiveListItemRenderer` rows; extracts videoId (play-button overlay → `playlistItemData`
  → title `watchEndpoint` fallbacks), title (`flexColumns[0]`), artist/album (disambiguated by each
  run's `browseEndpoint` `pageType`), duration (m:ss run), cover (largest resizable thumbnail).
  Emits colon uids via `makeUid`, skips videoId-less rows (gap-free `displayIndex`), `page>1 → []`
  (audius rule), and throws `ytmusic: contract-drift (expected search shelf)` on a non-object body or
  a shelf-less envelope. Typed over optional-chained interfaces — **zero `as any`** in the adapter.
- **`ytmusic.test.ts`**: 7 assertions — ≥1 Track with videoId==songid + colon uid + https cover;
  CJK top row parses 稻香 / 周杰倫 / 魔杰座 (no mojibake) + duration 224s; encoded search URL;
  `page:2 → []` with no upstream call; null-videoId rows skipped; contract-drift + null-body throw.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `dedupe.ts` SOURCE_RANK for the total-record typecheck**
- **Found during:** Task 1 (pre-flight scan for exhaustive `Record<SourceId, …>` maps)
- **Issue:** `src/lib/services/dedupe.ts` declares `const SOURCE_RANK: Record<SourceId, number>` — a
  TOTAL (non-`Partial`) record. Adding `'ytmusic'` to the `SourceId` union makes this a `pnpm check`
  error (missing key) — and `pnpm check` passing is a plan success criterion.
- **Fix:** Added `ytmusic: -1` (bottom tie-break, alongside the other non-mainstream sources
  jamendo/audius), with a comment explaining the total-record requirement. This is consistent with
  ytmusic being off the mainstream hot path — a mainstream CN version wins any normalized-identity tie.
- **Files modified:** `src/lib/services/dedupe.ts`
- **Commit:** `431a52e`

No other deviations — the plan executed as written. The `registry.ts` comment's claim that "dedupe's
SOURCE_RANK tie-break is UNCHANGED" refers to not REORDERING the existing ranks; appending a new key
is required by the union change and does not alter any existing source's rank.

## Authentication Gates

None. This source is fully anonymous by design (scope guard honored — no auth/OAuth/cookie/token/
visitorData-for-user or library-sync code was added anywhere).

## Notes for Downstream Plans

- **27-02** (edge routes): the client calls `apiFetch('/api/ytmusic/search?q=<keyword>')` and parses
  the returned InnerTube envelope client-side. The proxy must return the InnerTube JSON (or a trimmed
  slice preserving `…sectionListRenderer → musicShelfRenderer.contents[].musicResponsiveListItemRenderer`).
- **27-03** (stream route): `resolve()` already stamps `/api/ytmusic/stream/{videoId}`; the byte-proxy
  must serve itag-140 AAC with Range passthrough for the `128k AAC` quality label to be accurate.
- **27-04** (resilience wiring): `autoResolveEligible: false` is DECLARED but not yet HONORED —
  `fallback.ts fallbackOrder` derives from `getEnabledAdapters({})`, so ytmusic (enabled-by-default)
  currently WOULD appear as a cross-source-failover target. 27-04 must teach `fallbackOrder` /
  `resolveNameStub` to skip `autoResolveEligible === false` sources. No 27-01 test depends on the
  exclusion (there is no failover test here), and no ytmusic playback ships until 27-02/03 exist, so
  this is a scheduled-forward gap, not a regression.

## TDD Gate Compliance

- RED: `test(27-01)` commit `1ea5b71` — 6 parse-behavior assertions fail against the Task 1 skeleton.
- GREEN: `feat(27-01)` commit `3b3e5fc` — all 7 assertions pass.
- No REFACTOR commit needed (implementation was clean on first green).
- Gate sequence (test → feat) satisfied.

## Verification

- `pnpm check` — 0 errors, 0 warnings (SOURCES `Record<SourceId,SourceAdapter>` is total).
- `pnpm test src/lib/sources/` — 8 files, 89 tests passed.
- `pnpm test` (full suite) — 76 files, 1268 tests passed (no regressions from the dedupe/registry
  changes; fallback.test.ts mocks the registry, catalog.test.ts derives prefs dynamically).

## Self-Check: PASSED

- Files: all 7 created/modified files present on disk.
- Commits: `431a52e`, `1ea5b71`, `3b3e5fc` all present in git history.
