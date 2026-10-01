---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
fixed_at: 2026-10-01T03:34:16Z
review_path: .planning/phases/40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a/40-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 40: Code Review Fix Report

**Fixed at:** 2026-10-01T03:34:16Z
**Source review:** .planning/phases/40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a/40-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (1 critical, 6 warnings; Info and Convention findings out of scope)
- Fixed: 7
- Skipped: 0

**Verification after all fixes:** `pnpm test` passed (171 files, 3846 tests). `pnpm check` reported 0 errors and 12 warnings; all 12 are unused CSS selectors in files this run did not touch. `JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm apk` built (BUILD SUCCESSFUL).

## Fixed Issues

### CR-01: Vote allowlist admits attacker-controlled hosts

**Files modified:** `src/lib/proxy/safe-image-url.ts`, `src/lib/proxy/safe-image-url.test.ts`, `src/lib/proxy/cover-pick.ts`, `src/lib/proxy/cover-pick.test.ts`, `src/routes/api/cover-pick/+server.ts`, `src/routes/api/cover-pick/cover-pick-endpoint.test.ts`
**Commit:** 2c24c9cc
**Applied fix:**
- `COVER_PICK_IMAGE_HOSTS` is now its own list. It is no longer built from the per-source response allowlists.
  - Exact hosts: `cdn-images`/`e-cdns-images.dzcdn.net`, `y.gtimg.cn`, `img1`-`img4.kuwo.cn`, `yt3`/`lh3.googleusercontent.com`, `i.ytimg.com`, `lastfm.freetls.fastly.net`.
  - Suffixes, only for first-party image zones: `.mzstatic.com`, `.music.126.net`.
  - The list has no `.fastly.net`, no `.googleusercontent.com` suffix, no `api.qijieya.cn` and no `i.kfs.io`.
- The dead `CN_IMAGE_HOSTS` was removed.
- The per-source upstream allowlists are unchanged.
- Netease covers reach the picker as `api.qijieya.cn` redirector URLs. The vote parser now accepts that URL only in its exact shape (`/meting/?server=netease&type=pic&id=<digits>`, no other parameters).
- The POST route then follows the redirect one hop (`redirect: 'manual'`, 4s timeout). It screens the `Location` target against the allowlist and stores only that `*.music.126.net` URL. This runs after the throttle, so the route cannot be used to flood the redirector.
- I checked the redirect live: qijieya returns 302 to `p3.music.126.net`.
- Residual risk: `lh3.googleusercontent.com` can also serve user-uploaded Google content. It is a Google-run origin, so it cannot act as an IP beacon, and the WR-01 quorum still applies. The comment in `safe-image-url.ts` records this.

### WR-01: No quorum, enumerable keys and a per-IP throttle

**Files modified:** `src/lib/proxy/cover-pick.ts`, `src/lib/proxy/cover-pick.test.ts`, `src/routes/api/cover-pick/+server.ts`, `src/routes/api/cover-pick/cover-pick-endpoint.test.ts`
**Commit:** 4d8ef793
**Applied fix:**
- Added `PICK_AGREE_MIN = 2`. `consensus()` returns null until the winning URL has at least 2 votes. Voter ids are one per voter, so these are 2 distinct voters.
- A single vote is still stored but not published. Ties still go to the most recent vote.
- Added `voterAddress()`. It collapses an IPv6 address to its /64 for both `voterId` and `throttleVoterId`. Without this, one host could rotate addresses to reach the quorum alone.
- The voter's own local pin still applies to them at once (TrackMenu `pinCover`).
- Tests updated: a single vote is unpublished, a second distinct voter publishes, and two addresses in the same /64 count as one voter and one throttle bucket.

### WR-02: A superseded or failed crowd lookup is never retried this session

**Files modified:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
**Commit:** 72cbbb24
**Applied fix:**
- `crowdCoverAsync` now runs `writeCrowdCover` before the generation check. That write is keyed by identity, so it is safe whatever is playing. Only the adoption is gated on the generation.
- A null result removes the uid from `crowdRequested`, so a later play retries.
- The L8425 test was flipped: on supersede it now expects the cache write and no adoption.
- Added a test that a failed lookup is retried. The "no refetch on replay" test now uses an answered `{u:null,n:null}`.
**Status:** fixed: requires human verification. This changes state-handling logic.

### WR-03: `backfillCovers` writes YTM winners to the shared name layer

**Files modified:** `src/lib/services/cover-backfill.ts`, `src/lib/services/cover-backfill.test.ts`, `src/lib/services/upnext-covers.ts`, `src/lib/components/NpUpNext.svelte` (comment only)
**Commit:** 9d700ea7
**Applied fix:**
- `CoverNeed` gained an optional `uid`. `upNextCoverNeeds`, which both NpUpNext and NpRelated use, now carries it.
- `resolveOne` follows the `resolveCoverForTrack` rule: write the uid layer whenever there is a uid, and write the name layer only when there is no uid or the cover is not YTM.
- A row with a uid-only hit is now skipped, so it is not re-resolved.
- Home stubs without a uid keep the name-layer write (Pitfall 10).

### WR-04: Device tracks consume crowd name picks

**Files modified:** `src/lib/services/cover-cache.ts`, `src/lib/services/cover-cache.test.ts`
**Commit:** fcbeb9e8
**Applied fix:**
- `getCrowdCover()`, the one shared read, now returns null for `device:` uids. It uses `isDeviceUid`; `device-track.ts` is a leaf module, so this adds no circular import.
- Every caller inherits the guard: the play/restore seeds, `displayCover`, `readChosenCover` and the downloads retag sweep.

### WR-05: Kotlin `performMove` renames any path and silently overwrites

**Files modified:** `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt`
**Commit:** efc44701
**Applied fix:**
- In the file branch, both the source path and the target are resolved to canonical paths.
- Each of these rejects with `io:move` ("saved, not moved"):
  - the source is not a regular file under `Music/OpenMusic/`
  - the target already exists
  - the target resolves outside that root, for example through a symlinked album folder
- `mkdirs()` now runs only after those checks.
- One addition the review did not cover: a source already at the target path resolves as a no-op success. Without this, the new exists-check would reject it.
- Verified with `pnpm apk` on JDK 21. There is no unit test for this branch; it needs an API ≤28 device to exercise.
**Status:** fixed: requires human verification (on an API ≤28 device).

### WR-06: The QQ cover tier is ungated and costs up to three governed requests per iTunes miss

**Files modified:** `src/lib/services/cover-backfill.ts`, `src/lib/services/cover-backfill.test.ts`
**Commit:** ddd8a492
**Applied fix:**
- `qqSongCover` is now behind its own `createHealthGate()`, so failing art lookups never gate QQ playback. The gate trips after 3 consecutive failures and holds for 60s.
- Each attempt has a 4s deadline, via `combinedSignal`.
- These count as failures: a search source that does not come back `ok`, a timeout, or a detail throw.
- A caller abort is a supersede and never counts as a failure.
- A healthy empty search, or a detail that has no art, counts as ok.
- Added the `__resetQqCoverGate` test hook. New tests cover the gate tripping and aborts not tripping it.
- Fixed the "ONE detail / 2 edge requests" comments in the module header, the cost note and the tier comment to say a miss costs up to 3 governed requests.

---

_Fixed: 2026-10-01T03:34:16Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
