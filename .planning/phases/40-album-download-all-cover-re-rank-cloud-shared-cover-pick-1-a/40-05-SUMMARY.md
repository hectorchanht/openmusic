---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 05
subsystem: cover
tags: [cover, player, hq-upgrade-removal]
requires: ["40-04"]
provides:
  - "postPlayCover with a single branch: coverless tracks run the chain, inline covers are kept (D-11a, D-09)"
  - "writeCoverBoth + library.adoptCover skip the name layer for YTM-host URLs (D-11b)"
affects: [40-08]
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/services/url-safety.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/stores/cover-version.svelte.ts
    - src/lib/stores/cover-version.svelte.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
decisions:
  - "adoptedCoverUid is kept and now read by resolveCoverAsync, so a late full-chain result cannot replace a cover a surface adopted (it would otherwise be write-only dead state)"
  - "library.adoptCover D-11b test lives in library.svelte.test.ts (the file exists), reading back through the real cover-cache"
metrics:
  duration: ~12min
  completed: 2026-09-30
  tasks: 2
  files: 9
---

# Phase 40 Plan 05: HQ upgrade removal + YTM uid-only writers Summary

The automatic HQ cover upgrade no longer exists. `resolveHqCover`, `upgradeCoverAsync` and the `else if` branch in `postPlayCover` are deleted, so an inline cover is never replaced automatically. That covers kuwo/qq/netease pics, ytmusic thumbnails and album art. The two remaining name-layer writers, `writeCoverBoth` and `library.adoptCover`, now write YTM-host art to the uid layer or the record only.

## What was built

- `cover-backfill.ts`: deleted `resolveHqCover` and its doc block. Reworded the three comment mentions to "removed in Phase 40 D-11a — inline covers are never replaced automatically".
- `player.svelte.ts`: the import is now `resolveCoverForTrack` only. `postPlayCover` keeps only the `resolveCoverAsync` miss branch and has a Phase 40 D-11a / D-09 comment. Deleted the `upgradeCoverAsync` method and its orphan doc. `attachedCoverFor` is kept. Reworded the comments at the `displayCover` doc, the `adoptedCoverUid` doc and the `adoptCover` doc.
- `resolveCoverAsync` now bails when `adoptedCoverUid === resolved.uid`. This makes the reworded `adoptedCoverUid` comment true. Without it the field would be write-only.
- `url-safety.ts`: removed `upgradeCoverAsync` from the `hasHttpsScheme` call-site list.
- `cover-version.svelte.ts`: `writeCoverBoth` writes the name layer only when `!isYtmCoverUrl(url)`. It always writes the uid layer and always bumps. The function doc and module header carry D-11b.
- `library.svelte.ts` `adoptCover`: `hasHttpsScheme(cover) && !isYtmCoverUrl(cover)` gates `setCachedCover`. The liked/download/playlist record is still filled.

## Tests

- player: removed `resolveHqCover`/`mockHqCover` from the mock, the import and the 3 beforeEach resets. The upgrade tests are replaced by:
  - an inline kuwo cover is kept with no cover call (D-09/D-11a)
  - a ytmusic track keeps its own `i.ytimg.com` cover (D-09)
  - a coverless joox track calls `resolveCoverForTrack` exactly once
  - a pinned uid keeps the pin with no cover call
  - an unpinned https inline cover is kept with no cover call
- cover-backfill: removed the import, the `resolveHqCover` describe block (9 tests) and the INLINE-COVER hot-path test. The COVERLESS miss-path test and the reworded header are kept.
- cover-version: two `writeCoverBoth` cases. A YTM URL is written to the uid layer only, the name layer reads null, and the version is bumped. A Deezer URL is written to both layers.
- library: a YTM cover fills the record but the name layer stays null. A Deezer cover is written to the name layer.

## Verification (observed)

- Task 1: `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts src/lib/services/cover-backfill.test.ts`: 2 files, 389 tests passed. `pnpm check`: 0 errors, 12 pre-existing warnings.
- Task 2 RED: 2 failed out of 45 (the YTM name-layer write expected null, in both files). GREEN: `pnpm exec vitest --run src/lib/stores/` passed 19 files / 663 tests. `pnpm check`: 0 errors.
- Full `pnpm test`: 169 files, 3769 tests passed.
- Greps:
  - `resolveHqCover|upgradeCoverAsync` in `src` has only 2 hits, both comment-only (`qq.ts:352`, `cover-cache.ts:417`), which the plan allows.
  - Both test files have 0 hits.
  - `D-11a` appears in player.svelte.ts and cover-backfill.ts.
  - `private attachedCoverFor` = 1.
  - `isYtmCoverUrl` = 2 in each store.
  - `D-11b` = 2 / 1.
- Not verified: live behaviour in a browser.

## Deviations from Plan

**1. [Rule 1 - Bug] adoptedCoverUid was about to become write-only**
- **Found during:** Task 1
- **Issue:** `upgradeCoverAsync` was its only reader. The plan asked for the comment to say the field now guards against a late `resolveCoverAsync`, but nothing read it there.
- **Fix:** Added a one-line `adoptedCoverUid` bail in `resolveCoverAsync` after the gen check.
- **Commit:** 0e30e38a

## TDD Gate Compliance

- Task 1 is a deletion, so there is no RED gate. Its new player tests pass on both the old and the new code, because the old upgrade mock returned null. They pin the absence of an upgrade call and the kept cover. It has a single feat commit.
- Task 2 has a test commit 6f619768 (RED observed) followed by feat commit e1114382.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND commits: 0e30e38a, 6f619768, e1114382
- FOUND: all 9 modified files
