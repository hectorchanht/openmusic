---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 07
subsystem: cover-pick-client
tags: [cover-pick, client, cover-cache]
requires: ["40-05", "40-06"]
provides:
  - "src/lib/services/cover-pick-shared.ts: coverPickKeys, fetchCoverPick, submitCoverPick, CoverPickKeys type"
  - "cover-cache.ts crowd: family: get/set/removeCrowdCoverByUid, get/set/removeCrowdCoverByName, getCrowdCover"
  - "cover-version.svelte.ts: readChosenCover, writeCrowdCover, removeCrowdCover; readCoverByUidOrName rung 0 = readChosenCover"
affects: [40-08, 40-09]
tech-stack:
  added: []
  patterns: ["clone of lyric-offset-shared (never-throw over apiFetch)", "new key family in the one flat cover-cache record via readKey/writeKey/removeKey"]
key-files:
  created:
    - src/lib/services/cover-pick-shared.ts
    - src/lib/services/cover-pick-shared.test.ts
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/stores/cover-version.svelte.ts
    - src/lib/stores/cover-version.svelte.test.ts
decisions:
  - "Crowd picks are a CACHE (shared TTL / LRU cap / clearCoverCache), unlike pins; the server is the source of truth"
  - "writeCrowdCover bumps coverVersion only when something was actually written"
  - "fetchCoverPick screens each response url with safeImageUrl(COVER_PICK_IMAGE_HOSTS); non-string values become null"
metrics:
  duration: ~5min
  completed: 2026-09-30
  tasks: 3
  files: 6
---

# Phase 40 Plan 07: Shared cover pick client half Summary

The client half of the shared cover pick is in place. It computes domain-separated SHA-256 keys (`u\n`+uid, `n\n`+matchKey; device uids and `'|'` names are skipped), never throws, fetches and submits through apiFetch with the server's own `pickQuery`, and re-screens every returned URL. Crowd picks are cached in a disjoint `crowd:` cache family. `readChosenCover` gives pin > crowd uid > crowd name and is now rung 0 of `readCoverByUidOrName`. No caller fills the crowd layer yet (Plan 08), so the change does not alter behaviour.

## What was built

- **cover-pick-shared.ts** (D-13 / D-16): `coverPickKeys(uid, artist, title)` returns `{u, n}` (32-hex each) or null. It returns null when `crypto.subtle` is missing or when both keys are skipped. `fetchCoverPick(keys, signal?)` GETs `/api/cover-pick?${pickQuery(keys)}` and returns `{u, n}` screened through `safeImageUrl`, or null on non-ok, throw or abort. `submitCoverPick(keys, url)` POSTs `{u?, n?, url}` with `content-type: application/json` and swallows every failure.
- **cover-cache.ts** (D-14 / D-19): adds the `crowd:uid:<uid>` and `crowd:name:<matchKey>` keys, reusing the private `readKey`/`writeKey`/`removeKey`. TTL, LRU and clear therefore apply, with no new direct localStorage access (11 before, 11 after). It has the empty-uid guard and an https gate. The header now lists four families.
- **cover-version.svelte.ts**: `readChosenCover` is reactive (it calls `coverVersion()` first). `writeCrowdCover` writes only the crowd family and gates on https. `removeCrowdCover` evicts locally and bumps the version. The module has no network import.

## Verification (observed)

- `pnpm exec vitest --run src/lib/services/cover-pick-shared.test.ts`: 16/16 passed
- `pnpm exec vitest --run src/lib/services/cover-cache.test.ts`: 73/73 passed (8 new crowd tests)
- `pnpm exec vitest --run src/lib/stores/cover-version.svelte.test.ts`: 11/11 passed (6 new crowd-layer tests)
- `pnpm check`: 0 errors, 12 warnings. All the warnings were already there (unused CSS selectors).
- `pnpm test`: 171 files, 3818 tests passed
- Acceptance greps:
  - 3 cover-pick-shared exports, 2 `apiFetch(`, 1 content-type header, 1 `pickQuery(`, 2 `COVER_PICK_IMAGE_HOSTS`
  - cover-cache.ts: 2 crowd key literals, 7 crowd exports
  - cover-version.svelte.ts: 3 new exports, 1 `readChosenCover(uid, artist, title) ??`, 0 `apiFetch|cover-pick-shared`

## TDD Gate Compliance

Each task has a RED `test(...)` commit followed by a GREEN `feat(...)` commit. No refactor commits were needed.

## Deviations from Plan

None in behaviour. One acceptance grep (`grep -c "fetch(" ... = 2`) reads 0. grep is case-sensitive and `apiFetch(` has a capital F. The check exists to confirm there is no raw fetch, and 0 confirms exactly that.

## Commits

- 18063031 test(40-07): add failing tests for the shared cover pick client
- 62d76aed feat(40-07): shared cover pick client keys, fetch and submit
- 2a5b037d test(40-07): add failing tests for the crowd cover cache family
- f64b78f6 feat(40-07): crowd cover pick family in the cover cache
- 1e3cb9c9 test(40-07): add failing tests for the reactive crowd cover layer
- baaea377 feat(40-07): reactive chosen-cover read with pin over crowd pick

## Self-Check: PASSED
