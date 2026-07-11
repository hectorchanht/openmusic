---
phase: 26-minimal-api-click-to-play-redesign
plan: 03
subsystem: services/edge-proxy
tags: [track-getsimilar, up-next, name-stub, lazy-resolve, api-call-reduction, lastfm, minimal-api, svelte5, vitest, tdd]

# Dependency graph
requires:
  - "26-01: Track.resolveByName marker + resolveNameStub kuwo-first single-source resolver (ensureTrackDetails routes marked stubs)"
provides:
  - "src/routes/api/lastfm/similar-tracks/+server.ts — edge track.getSimilar proxy; LASTFM_KEY server-side; clean {tracks:[{artist,title,match}]} shape; GET + OPTIONS"
  - "src/lib/services/similar.ts buildSimilarQueue — 1-call track.getSimilar primary path emitting lazy resolveByName name-stubs; SINGLE-source dry fallback"
affects: [up-next-generation, api-call-reduction, click-to-play-cost]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New Last.fm edge route MIRRORS /api/similar's posture EXACTLY: optional LASTFM_KEY from platform.env, injected upstream only (never client/logged), absent-key/error/miss → 200 {tracks:[]}, corsHeaders own-origin (never *), fetchWithRetry + AbortSignal.timeout(8000), clampLimit (DEFAULT 8 / MAX 50)"
    - "track.getSimilar CANNOT reuse /api/similar (artist.getSimilar, artist-only) nor /api/lastfm/info (*.getinfo allow-list) — a distinct dedicated route (D-08 posture reused)"
    - "Up-Next = lazy name-only stubs (26-01 resolveByName): exact {artist,title}, no cover/audio/lrc, detailsLoaded:false, resolve kuwo-first on play — ZERO per-item searchAll at build time"
    - "STABLE synthetic uid = `${primaryId}:similar-${matchKey(artist,title)}` (colon-form D-10, similar- prefix never collides with a real numeric songid) so dedupe/exclude/queue identity all key on song identity"
    - "onlyPrimarySource() mirrors catalog.ts onlySource — the dry fallback + last-resort search restrict searchAll to ONE (kuwo-first) source; never an 8-source fan-out"

key-files:
  created:
    - src/routes/api/lastfm/similar-tracks/+server.ts
    - src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts
  modified:
    - src/lib/services/similar.ts
    - src/lib/services/similar.test.ts

key-decisions:
  - "Up-Next PRIMARY = track.getSimilar via a NEW /api/lastfm/similar-tracks route; buildSimilarQueue 56 calls → 1 (the highest-impact single change in the phase)"
  - "Seed (a REAL track) dropped by normalized identity (matchKey), NOT by uid — stubs carry synthetic uids; excludeUids + same-song dedupe key on the synthetic uid; player NOT edited (play() indexOf queue-swap already adopts the resolved real uid)"
  - "Dry fallback (thin-scrobble CN songs → 0 similar tracks) stays SINGLE-source: artist.getSimilar → one kuwo-first single-source searchAll per artist; last-resort same-artist search single-source too — never the 8-source fan-out"
  - "Documented, bounded dedup gap: a resolved real track already in the queue head (real uid) is not de-duplicated against a freshly generated stub (synthetic uid); accepted per plan (player intentionally untouched)"

requirements-completed: [UPNEXT-01]

# Metrics
duration: 12min
completed: 2026-07-11
---

# Phase 26 Plan 03: track.getSimilar Up-Next (56 → 1) Summary

**Kills the 56-call up-next flood — the single highest-impact change in the phase. A new `/api/lastfm/similar-tracks` edge route (Last.fm `track.getSimilar`, mirroring `/api/similar`'s key/CORS/absent-key posture exactly) returns exact `{artist,title,match}` pairs in ONE call, and `buildSimilarQueue` is rewritten to map them to lazy kuwo-first name-stubs (Plan 26-01's `resolveByName` marker) with ZERO per-item `searchAll` at build time. The old `artist.getSimilar → 8× searchAll` fan-out (8 artists × 7 sources = 56 `/api/*` calls, spike 003) is gone; a call-count spy proves the build path is exactly 1 `/api/*` call. Green typecheck + full suite (only the pre-existing deferred `searchHistory` SSR-guard failure remains).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-11T11:41:36Z
- **Completed:** 2026-07-11T11:53Z
- **Tasks:** 3 of 3 (Task 1 autonomous; Task 2 TDD RED→GREEN, no REFACTOR; Task 3 call-cost spy)
- **Files:** 2 created, 2 modified

## Accomplishments

- **Task 1 (edge route) — `d1e96cf`:** Created `src/routes/api/lastfm/similar-tracks/+server.ts` mirroring `/api/similar` line-for-line: OPTIONAL `LASTFM_KEY` from `platform.env` (injected upstream only, never client/logged, T-26-03-01), `artist`+`track` encodeURIComponent passthrough, `clampLimit` (DEFAULT 8 / MAX 50), `fetchWithRetry(..., { signal: AbortSignal.timeout(8000) }, 2)`, fixed `method=track.getsimilar&autocorrect=1`. Reshapes upstream `{ similartracks: { track: [...] } }` → clean `{ tracks: [{ artist, title, match }] }` — handles Last.fm's array-or-single quirk, coerces `match` to a number, trims + drops incomplete pairs, PRESERVES upstream match-descending order (capped to `limit`). Absent key / missing artist+track / Last.fm `error` / upstream throw / malformed JSON → `200 { tracks: [] }` (never throws, never fetches `api_key=undefined`). `corsHeaders` own-origin (never `*`), `GET` + `OPTIONS` 204. Route test (7 cases) covers the no-leak, order preservation, array-or-single, absent-key/no-fetch, missing-param, error-6, malformed-JSON, and OPTIONS-CORS paths.
- **Task 2 (buildSimilarQueue rewrite), TDD:**
  - **RED (`1cd6b71`):** rewrote the `buildSimilarQueue` describes to assert the new contract (1 similar-tracks fetch + 0 searchAll, resolveByName stubs, match order, stable synthetic uid, seed/exclude/dedupe, single-source dry fallback) — 6 tests failing against the old artist-hop, 2 unchanged `getSimilarArtists` tests passing.
  - **GREEN (`e7c7348`):** PRIMARY path calls `apiFetch('/api/lastfm/similar-tracks?...')` (wrapped in the existing `cached()` TTL, keyed on artist+title+limit; excludeUids/seed filtering happens per-call OUTSIDE the cache), maps each pair to a lazy `nameStub` (real artist/title/keyword, `resolveByName:true`, `detailsLoaded:false`, no cover/audio/lrc, stable synthetic uid), drops the seed by identity, excludes + dedupes by synthetic uid, preserves match order — no `searchAll`. FALLBACK (route dry) falls through to `getSimilarArtists` then resolves each candidate SINGLE-source via `onlyPrimarySource()` prefs (one kuwo-first source), with a single-source last-resort same-artist search. Signature + never-throw contract unchanged; player untouched.
  - **REFACTOR:** none needed.
- **Task 3 (call-cost proof) — `28f473e`:** added a spike-003-style call-count spy asserting the build path is exactly 1 `/api/*` call (the track.getSimilar call) with 0 all-enabled `searchAll` fan-outs, and documenting the end-to-end ≤~5 budget (build 1 + seed resolve 1 + lazy Deezer HQ cover ≤1 + prefetch ≤1) vs the ~59 baseline.

## Verification

- `pnpm test -- src/routes/api` — 7 files, 80 passed (includes the new route's 7 cases).
- `pnpm test -- src/lib/services/similar.test.ts` — 9 passed (5 primary/identity + 2 dry-fallback + cost proof + 2 getSimilarArtists, minus... all green).
- `pnpm check` — 0 errors, 0 warnings (4319 files).
- Full `pnpm test` — 1152 passed, 1 failed (the pre-existing, deferred `searchHistory.svelte.test.ts` SSR-guard failure only; see Deviations → Out of Scope).
- Manual trace of the player queue-swap (`play()` ~2571: `const i = this.indexOf(track); this.queue[i] = resolved`) confirms a synthetic→real uid change survives: `indexOf(track)` locates the slot by the STUB's synthetic uid, then overwrites with the resolved real-uid Track. No player edit required (per plan).

## TDD Gate Compliance

- RED gate: `1cd6b71` `test(26-03): failing tests …` (6 behavioral tests failing as expected; 2 unchanged tests intact).
- GREEN gate: `e7c7348` `feat(26-03): rewrite buildSimilarQueue …` (all 8 tests green).
- Fail-fast honored: RED failed genuinely (old impl calls `/api/similar` + all-source `searchAll`, so the "1 similar-tracks fetch + 0 searchAll" and single-source-prefs assertions all failed before implementation).
- Task 3 note: Task 3 is `tdd="true"` but its behavior (build-path call cost) is delivered by Task 2's implementation, so its spy test passed on introduction — it is a characterization/regression proof (spike-003 audit), committed as a `test(...)` commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Env` type requires `JOOX_TOKEN` in route test env objects**
- **Found during:** Task 1 (`pnpm check`)
- **Issue:** `proxy-types.ts` `Env` makes `JOOX_TOKEN` required; my route-test `platform.env` fixtures passed only `{ LASTFM_KEY }`, failing the typecheck (5 errors).
- **Fix:** Added `JOOX_TOKEN: 'x'` alongside `LASTFM_KEY` in every fixture (mirrors the shipped `similar-endpoint.test.ts` pattern).
- **Files modified:** src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts
- **Commit:** d1e96cf

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails in isolation with zero Phase-26 code involved (Node 22+ exposes `globalThis.localStorage`, so `typeof globalThis.localStorage === 'undefined'` no longer holds). Already documented in Phase-25 `deferred-items.md` and the 26-01 SUMMARY. Unrelated to this plan — not fixed per the scope boundary.

## Known Stubs

None. `buildSimilarQueue`'s stubs are lazy name-only Tracks by DESIGN (the `resolveByName` up-next shape from Plan 26-01), fully resolved on play via `resolveNameStub` — not placeholder/dead data. The synthetic uid is stable and consumed by dedupe/exclude/queue identity.

## Notes for Next Plan

- The ~59 → ~3/≤~5 single-song-play target is now structurally in place across 26-01 (kuwo-first resolve), 26-02 (inline cover + lazy HQ), and 26-03 (this plan — 56→1 up-next). A live in-app `window.fetch` audit (spike-003 method) on a real generated-Up-Next play would confirm the end-to-end number on device.
- Documented, bounded dedup gap: a resolved real track already in the queue head (real uid) is not matched against a freshly generated same-song stub (synthetic uid), so a rare visible duplicate is possible. Resolving it cleanly would require passing song identities (not uids) into `buildSimilarQueue` or editing the player queue-swap — deliberately deferred (plan said not to edit the player).

## Self-Check: PASSED

- All 4 touched files present on disk (2 created, 2 modified).
- All 4 task commits present in git history: d1e96cf (Task 1), 1cd6b71 (Task 2 RED), e7c7348 (Task 2 GREEN), 28f473e (Task 3).
