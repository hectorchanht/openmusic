---
phase: 43-multi-platform-sources-mdl-style-soundcloud-bandcamp-as-real
plan: 01
subsystem: sources / fallback / freshness
tags: [source-adapter, fallback, freshness]
requires: []
provides:
  - Track.urlExpiresAt, Track.versionMismatch, SourceAdapter.noticeOnAutoPick (optional contracts)
  - isUrlFresh honours urlExpiresAt
  - SOUNDCLOUD_IMAGE_HOSTS, BANDCAMP_IMAGE_HOSTS
  - isNotableVersionMismatch (song-variant.ts)
  - walkSource versionMismatch stamp (fallback.ts)
affects: [43-02..43-08]
tech-stack:
  added: []
  patterns: [registry flag gate, pure predicate]
key-files:
  created: []
  modified:
    - src/lib/sources/types.ts
    - src/lib/services/track-ready.ts
    - src/lib/services/track-ready.test.ts
    - src/lib/proxy/safe-image-url.ts
    - src/lib/proxy/safe-image-url.test.ts
    - src/lib/services/song-variant.ts
    - src/lib/services/song-variant.test.ts
    - src/lib/services/fallback.ts
    - src/lib/services/fallback.test.ts
decisions:
  - "43-D-08: version-mismatch notice is gated by SourceAdapter.noticeOnAutoPick and stamped only in walkSource; threshold max(30 s, 15 % of target) (A5, tune in song-variant.ts)"
  - "43-D-09: adapter-stamped Track.urlExpiresAt is a second, tighter freshness bound; it can only make a track stale"
metrics:
  duration: ~6min
  completed: 2026-11-04
---

# Phase 43 Plan 01: Shared source contracts Summary

Optional `urlExpiresAt` / `versionMismatch` / `noticeOnAutoPick` contracts, url-expiry-aware freshness guard, SoundCloud + Bandcamp cover allowlists, and the D-08 `isNotableVersionMismatch` predicate stamped at the single `walkSource` seam behind a registry flag. No source is named in production logic.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Contract fields + urlExpiresAt freshness + cover allowlists | dae18cf8 |
| 2 | isNotableVersionMismatch (TDD) | 591d3624 (RED), a5ad008d (GREEN) |
| 3 | walkSource versionMismatch stamp (TDD) | 47268fa8 (RED), 337790c8 (GREEN) |

## Verification (observed)

- `vitest track-ready + safe-image-url`: 30/30 passed
- `vitest song-variant`: RED 6 failed → GREEN 55/55 passed
- `vitest fallback + fallback-ring`: RED 1 failed (the positive marker case) → GREEN 35/35 passed
- `pnpm check`: 0 errors, 18 warnings (pre-existing CSS warnings)
- Full `pnpm test`: 5269 passed, 5 failed in `settings-persist.svelte.test.ts` and `track-menu-order.test.ts` — pre-existing and unrelated to this plan; logged in `deferred-items.md`
- `SourceId` was not widened (no `'soundcloud'`/`'bandcamp'` in types.ts code)

## Deviations from Plan

- The fallback test registry mock had no `audius` entry (the plan assumed it did). I added a fake `audius: { noticeOnAutoPick: true }` to the mocked `SOURCES` only, and left it out of `getEnabledAdapters`, so the existing fallbackOrder assertions didn't change.

## TDD Gate Compliance

test → feat commits exist for Tasks 2 and 3. No refactor was needed.

## Self-Check: PASSED
