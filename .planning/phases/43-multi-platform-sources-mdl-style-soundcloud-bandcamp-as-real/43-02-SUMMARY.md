---
phase: 43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
plan: 02
subsystem: edge-proxy
tags: [edge-proxy, bandcamp]
requires: [43-01 BANDCAMP_IMAGE_HOSTS]
provides: [/api/bandcamp/search, /api/bandcamp/resolve, /api/bandcamp/stream, $lib/proxy/bandcamp]
affects: [43-05 Bandcamp client adapter]
tech-stack:
  added: []
  patterns: [ccmixter-style id-only byte-pipe, shared resolve helper owning SSRF checks]
key-files:
  created:
    - src/lib/proxy/bandcamp.ts
    - src/lib/proxy/bandcamp.test.ts
    - src/lib/sources/__fixtures__/bandcamp.autocomplete.json
    - src/lib/sources/__fixtures__/bandcamp.tralbum.json
    - src/routes/api/bandcamp/search/+server.ts
    - src/routes/api/bandcamp/resolve/+server.ts
    - src/routes/api/bandcamp/stream/+server.ts
  modified: []
decisions:
  - "Bandcamp songid = `${band_id}-${id}`; all routes accept only /^\\d{1,12}-\\d{1,12}$/"
  - "resolveBandcampStream is the single seam for tralbum_details -> stream_redirect -> bcbits host check; stream route re-checks isBcbitsMediaUrl before the media fetch"
metrics:
  duration: ~10min
  completed: 2026-11-04
---

# Phase 43 Plan 02: Bandcamp edge layer Summary

Bandcamp edge layer: pure helper module (id validator, autocomplete parser, tralbum stream extractor, bcbits host guard, shared resolve) plus id-only search / resolve / Range byte-pipe routes, all verified live.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 RED: fixtures + tests | b069a27e | vitest failed (module missing) |
| 1 GREEN: `$lib/proxy/bandcamp.ts` | b0fec8b3 | `vitest --run src/lib/proxy/bandcamp.test.ts` 11/11 passed |
| 2 search + resolve routes | 4f60ddb1 | `pnpm check` 0 errors; live curls OK |
| 3 stream byte-pipe | b5d94d0f | `pnpm check` 0 errors; live curls OK |

## Verification (observed)

- `pnpm check`: 0 errors, 18 pre-existing warnings (none in new files).
- Live against dev server: search `q=lofi` → `{"rows":[{"id":"2636669871-2834446269",…,"cover":"https://f4.bcbits.com/img/a2734277808_16.jpg"},…]}`; resolve → 200, `cache-control: no-store`, `url` on `https://t4.bcbits.com/stream/…`, duration 206.875; resolve `id=https://evil` → 400; resolve `id=1-1` → 503 `{"error":"unstreamable"}`; stream with `Range: bytes=0-99` → 206 `audio/mpeg`, `content-range: bytes 0-99/3311071`; stream `id=evil` → 400.
- Acceptance greps: each route exports exactly 2 (`GET`, `OPTIONS`); helper has 5 exported functions; no `502` outside comments; no `searchParams.get('url')`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Smoke run on :5173 instead of :4321**
- The uncommitted `package.json` from another session changes `pnpm dev` (now `BUILD_TARGET=native vite dev`, port 5173). Ran the same curl checks against :5173. The dev server was started for the smoke check and stopped afterwards. `package.json` was not touched.

**2. TDD split:** Task 1 committed as separate RED (test + fixtures) and GREEN (impl) commits.

Fixture note: autocomplete fixture trimmed to 6 live track rows (one with `album_name`) plus one hand-added `type:'a'` row to exercise the type filter.

## TDD Gate Compliance

RED `test(43-02)` b069a27e → GREEN `feat(43-02)` b0fec8b3. No refactor commit needed.

## Known Stubs

None.

## Self-Check: PASSED

All 7 created files exist; commits b069a27e, b0fec8b3, 4f60ddb1, b5d94d0f are in `git log`.
