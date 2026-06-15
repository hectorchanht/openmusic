---
phase: quick-260616-0zn
plan: 01
subsystem: source-adapters
tags: [audius, source-adapter, edge-proxy, streaming, range-requests]
requires:
  - "$lib/proxy/http (fetchWithRetry, corsHeaders)"
  - "$lib/services/api-base (apiFetch, apiUrl)"
  - "$lib/services/lrc (inferQualityFromUrl)"
  - "$lib/sources/types (SourceAdapter, Track, makeUid)"
provides:
  - "Audius SourceAdapter (search + resolve), enabledByDefault: true"
  - "/api/audius/search (JSON passthrough proxy)"
  - "/api/audius/stream/[id] (redirect-following audio stream proxy, Range-aware)"
affects:
  - "src/lib/sources/registry.ts (SOURCES now enumerates audius)"
  - "src/lib/sources/types.ts (SourceId union + audius)"
  - "src/lib/services/dedupe.ts (SOURCE_RANK audius:-1)"
tech-stack:
  added: []
  patterns:
    - "Dedicated edge route (not catch-all) for a source whose stream is a 302 redirect"
    - "redirect:'follow' + body passthrough keeps <audio>.src own-origin (Capacitor/CORS-safe)"
key-files:
  created:
    - src/routes/api/audius/search/+server.ts
    - src/routes/api/audius/stream/[id]/+server.ts
    - src/lib/sources/audius.ts
    - src/lib/sources/audius.test.ts
  modified:
    - src/lib/sources/types.ts
    - src/lib/sources/registry.ts
    - src/lib/sources/registry.test.ts
    - src/lib/services/dedupe.ts
decisions:
  - "Audius enabledByDefault:true — verified-working, zero-overlap net-new Western/indie/UGC supply; parallel Promise.allSettled fan-out cannot break existing sources"
  - "resolve() has no JSON hop — stream URL is deterministic from the track id; resolve only stamps the own-origin proxy path + quality tag"
  - "SOURCE_RANK audius:-1 (alongside jamendo) — non-mainstream recordings must lose ties to mainstream CN sources if dedupe ever merges them"
metrics:
  duration: ~20 min
  completed: 2026-06-16
---

# Quick 260616-0zn: Add the Audius music source — Summary

Added **Audius** as a new resolver adapter (Western/indie/electronic + UGC, fully public, no
key) wired into the default resolver. Search returns a flat best-match list; the file URL is
NOT in search JSON, so a dedicated edge proxy with a STREAMING `stream/[id]` route follows the
upstream 302 to the signed Google Cloud Storage mp3 and pipes the body — keeping the eventual
`<audio>.src` own-origin and Range-seekable. Footprint: two proxy routes, one adapter, one
union member, one registry line, plus tests (and one required exhaustive-record fix).

## What shipped

**Task 1 — dedicated edge proxy routes** (commit `c7942e4`)
- `src/routes/api/audius/search/+server.ts` — JSON passthrough; reads + trims `query`, appends
  `app_name=musicsquare` server-side, `caches.default` TTL 10min keyed on the own-origin
  Request, `fetchWithRetry` + `AbortSignal.timeout(8000)`, empty `{data:[]}` on error/blank,
  `OPTIONS` 204. Mirrors the fivesing/jamendo posture exactly.
- `src/routes/api/audius/stream/[id]/+server.ts` — the load-bearing route. `redirect:'follow'`
  + `AbortSignal.timeout(15000)` + retries=1; forwards the client `Range` header upstream;
  streams `res.body` with `content-type: audio/mpeg`; propagates `Accept-Ranges`,
  `Content-Range`, `Content-Length` only when present (so 206 + `<audio>` seeking work
  end-to-end). Never JSON-returns the signed/expiring GCS URL. 400 on missing id, 502 on
  upstream error, `OPTIONS` 204.

**Task 2 — adapter + wire-up + tests** (commit `e5c3d6f`, TDD)
- `src/lib/sources/audius.ts` — `SourceAdapter` (`id:'audius'`, `label:'Audius'`,
  `enabledByDefault:true`). `search` maps `data[]` rows to canonical Tracks (uid via
  `makeUid`, artist from `user.name`, cover `480x480 → 150x150 → null`, duration when numeric,
  `audioUrl:null`), SKIPS `is_streamable:false`/no-id rows, THROWS on contract-drift, returns
  `[]` for `page>1` (no pagination, research A3). `resolve` sets the own-origin
  `apiUrl('/api/audius/stream/<songid>')` path, tags quality via `inferQualityFromUrl`, marks
  `detailsLoaded`, throws on missing songid.
- `types.ts` — `'audius'` added to `SourceId`.
- `registry.ts` — `import { audius }` + `SOURCES` record entry.
- `audius.test.ts` — 8 cases covering all `<behavior>` items (mapping, cover fallback, skip
  rules, encoded `/api/audius/search` URL, contract-drift throw, no-pagination, resolve
  own-origin + quality + missing-songid throw). All pass.
- `registry.test.ts` — `EXPECTED_KEYS` appended with `'audius'`; updated the title string.

## TDD gate compliance

The adapter test was written first and run against the absent adapter (RED — import failed),
then the adapter implementation made it pass (GREEN). Because the test imports the adapter and
the `SourceId` union must include `'audius'` for the test types to compile, the RED test +
GREEN implementation + minimal wire-up are mutually dependent and were committed together as a
single `feat(...)` commit (`e5c3d6f`) rather than split RED/GREEN commits. No REFACTOR commit
was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exhaustive `Record<SourceId, number>` needed an `audius` entry**
- **Found during:** Task 2 (`npm run check`)
- **Issue:** Widening the `SourceId` union broke `src/lib/services/dedupe.ts`'s
  `SOURCE_RANK: Record<SourceId, number>` (TS2741 — `audius` missing). This is outside the
  plan's 5 listed Task-2 files but is a compile blocker directly caused by the union change.
- **Fix:** Added `audius: -1` to `SOURCE_RANK` (same rank as jamendo — non-mainstream
  recording, must lose ties to mainstream CN sources). `npm run check` then clean.
- **Files modified:** src/lib/services/dedupe.ts
- **Commit:** e5c3d6f

**2. [Rule 1 - Stale test] `registry.test.ts` prefs-override test passed an incomplete prefs map**
- **Found during:** Task 2 (`npm run test`)
- **Issue:** `getEnabledAdapters({ netease:true, qq:false, kuwo:false, joox:false })` expected
  `['netease']`, but with `jamendo` already `enabledByDefault:true` (and now `audius` too),
  un-prefs'd sources fall through to their defaults and appear. This test was already red
  before this task (jamendo alone broke it); adding audius extended the leaked set.
- **Fix:** Pass an explicit pref for EVERY source so none falls through to `enabledByDefault`.
  Preserves the test's intent (prefs override defaults) and is now green.
- **Files modified:** src/lib/sources/registry.test.ts
- **Commit:** e5c3d6f

## Settings accordion — picked up generically (no edit)

Per the success criteria: the per-source toggle UI (ii6 Playback Advanced — Sources accordion)
iterates `Object.values(SOURCES)` / `getEnabledAdapters()` generically, so Audius now appears
in settings with **zero UI/settings code edits**. No aggregation/dispatch/UI/settings file was
touched.

## Deferred / follow-up

- **GDStudio (kugou + migu)** is a possible FUTURE opt-in source but was intentionally skipped
  this task. Research flagged it RISKY: intermittent sub-source enum (the kugou/migu `source`
  values were rejected during the research session — assumption A1), unverified non-CN CDN edge
  reachability for kugou/migu audio URLs (assumption A2), and a shared 60-request/5-minute cap.
  If pursued later it should ship `enabledByDefault:false` (it overlaps existing netease/kuwo/
  joox) and re-probe the kugou/migu enum + CDN reachability before shipping. No code shipped.
- **Pre-existing test failures (out of scope, logged in `deferred-items.md`):** 6 failures in
  `home-layout.test.ts` (stale `SHELF_DEFAULT` 16-vs-18 constant) and `catalog.test.ts`
  (default-enabled-source-set drift + timer-based stagger tests) were red BEFORE this task —
  confirmed by reverting the Audius source edits and re-running. Not fixed per the SCOPE
  BOUNDARY rule; a separate cleanup task should refresh those expectations.

## Verification

- `npm run check` (svelte-check + tsc): **0 errors, 0 warnings** (clean).
- `npm run test` (vitest --run): the new `audius.test.ts` (8 cases) and updated
  `registry.test.ts` (6 cases) **PASS** (867 passed total). The only 6 remaining failures are
  the pre-existing, out-of-scope `home-layout.test.ts` + `catalog.test.ts` failures documented
  above (red before this task).
- Manual (optional, post-merge): default search returns Audius rows; tapping one plays via
  `/api/audius/stream/<id>`; scrubbing issues a Range request and resumes (206 path).

## Self-Check: PASSED

- FOUND: src/routes/api/audius/search/+server.ts
- FOUND: src/routes/api/audius/stream/[id]/+server.ts
- FOUND: src/lib/sources/audius.ts
- FOUND: src/lib/sources/audius.test.ts
- FOUND commit c7942e4 (Task 1 — proxy routes)
- FOUND commit e5c3d6f (Task 2 — adapter + wire-up + tests)
