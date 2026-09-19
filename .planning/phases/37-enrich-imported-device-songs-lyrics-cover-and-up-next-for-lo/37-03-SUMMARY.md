---
phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo
plan: 03
subsystem: player
tags: [tests, regression-pin, device-tracks, offline-blob, mutation-checked, mock-hygiene]

# Dependency graph
requires:
  - phase: 37-01
    provides: lyricByName, isRenderableCover, readAudioTags().art
  - phase: 37-02
    provides: localEnrichment, enrichFromLocalFile, postPlayCover/postPlayQueue, the un-gated blob-branch fall-through
  - phase: 34-device-import
    provides: deviceUid / isDeviceUid, the 34-D-01 no-network contract
provides:
  - "describe('player.play — offline-served enrichment (Phase 37, 37-D-01..07)') — 8 specs driving the REAL play() through the offline-blob branch against a fake <audio>"
  - "$lib/services/local-tags is now mockable from the player suite (localEnrichment + __resetLocalTagsMemo)"
  - "lyricByName added to the player suite's catalog mock factory — it was a REAL player import with no mock, so the device lyric branch called undefined"
affects: [37-04 device UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mutation-check a new regression suite before trusting it: re-introduce the exact defect the plan removed and confirm the suite goes red"
    - "A negative assertion ('the network fallback did NOT fire') is only meaningful once every sync read that could short-circuit the path is reset per test"

key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.test.ts

key-decisions:
  - "37-03-A: buildSimilarQueue is stubbed with a 3-track tail so primeNext's ensureAhead never grows. That makes `toHaveBeenCalledTimes(1)` mean 'regenerate ran' and nothing else — with the default [] the queue stays 1 long, ensureAhead fires a SECOND buildSimilarQueue call, and the count assertion would be about grow timing rather than about the fall-through"
  - "37-03-B: the three synchronous cover reads (getPinnedCover / getCachedCoverByUid / getCachedCover) are reset in the suite's own beforeEach. They are module-scope vi.fn()s that earlier suites in this 7000-line file leave pointing at a cover, and vi.restoreAllMocks() does not reset a vi.fn() created by a vi.mock factory — a leaked hit makes postPlayCover's renderable gate skip the chain, passing every 'the fallback did not fire' assertion for the wrong reason"
  - "37-03-C: the supersedence case drives a REAL second play() (isDownloaded scoped to the device uid so the superseder takes the network branch) rather than hand-incrementing playGen. The plan allowed either; the real play is what the must_have describes"
  - "37-03-D: no production fix was needed. Plan 02's wiring passed all eight assertions unmodified, and both mutation probes confirm the suite would have caught a regression"

patterns-established:
  - "A regression suite for a god-object store resets the shared mock surface it reads, not just the store fields it writes"

requirements-completed: [ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04]

# Metrics
duration: 11min
completed: 2026-09-19
---

# Phase 37 Plan 03: Offline-served enrichment test suite + repo gates Summary

**Eight specs now drive the REAL `play()` through the offline-blob branch against a fake `<audio>` and pin what enrichment may and may not touch — including the 34-D-01 regression (`ensureTrackDetails` never called, `audioUrl` stays `null`) — and both mutation probes confirm the suite goes red when plan 02's fix is undone.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-09-19T00:52Z (base commit `5e14d9b`)
- **Completed:** 2026-09-19T00:59Z
- **Tasks:** 2 (1 commit — Task 2 required no code change)
- **Files:** 1 modified

## Accomplishments

- **`describe('player.play — offline-served enrichment (Phase 37, 37-D-01..07)')`** — 8 specs, all green:
  1. **34-D-01 regression (the highest-value one):** a `device:` fresh play never calls `ensureTrackDetails`, `current.uid` is the device uid, `current.audioUrl` is `null`, and `el.src` is the blob URL.
  2. **37-D-01 up-next:** `buildSimilarQueue` called exactly once with a track whose uid is the device uid; `upNextAnchorUid === devUid`; the generated tail is actually installed in `player.queue`.
  3. **Embedded hit:** `current.lrc` is the file's LRC, `resolvedCover` starts with `data:image/png`, **neither** `resolveCoverForTrack` nor `lyricByName` fires, the raw `openmusic:cover-cache:v1` record contains no `data:` (T-37-05), and `el.src` is unchanged after enrichment lands (T-37-06).
  4. **Tag miss, device:** `lyricByName('Adele','Hello', AbortSignal)` exactly once, `resolveCoverForTrack` once, `ensureTrackDetails` still never, and the walked lyric patches `current.lrc`.
  5. **Tag miss, ordinary download (37-D-01):** `ensureTrackDetails` IS called with `{ uid, lrcUnresolved: true, detailsLoaded: false }` (the pre-existing backfill path), `buildSimilarQueue` is called with that uid, the cover chain fires, and `lyricByName` does NOT (not a device uid).
  6. **Supersedence:** a real second `play()` during a deferred tag read discards the stale `lrc` and the stale `data:` cover.
  7. **37-D-05 query-only:** a recovered `artist`/`title` drives both fallbacks (`lyricByName('Recovered','Name',…)`, `resolveCoverForTrack({artist:'Recovered'})`) while `player.current.artist`/`.title` stay the MediaStore values.
  8. **T-37-06 no gen churn:** `playGen` is identical before and after the tags land.
- **Mock-graph hole closed:** `lyricByName` is a real import in `player.svelte.ts` but was absent from the suite's `$lib/services/catalog` factory, so the 37-D-03 device branch was calling `undefined` in every test that reached it. Added.
- **`$lib/services/local-tags` mocked** with a controllable `localEnrichment` (hit / miss / deferred) defaulting to the "file carries nothing" miss, so no other suite in the file changes behaviour.

## Task Commits

1. **Task 1: the offline-served enrichment suite** — `7dc20d6`
2. **Task 2: whole-repo gates + static audit** — **no commit.** Both gates were green with no production change required; the audit is evidence, not an edit. (`<files>` named `player.svelte.ts` only as the place a fix would land if one were needed.)

**Plan metadata (this SUMMARY, STATE, ROADMAP) left uncommitted / untouched for the orchestrator**, per the execution brief.

## Files Created/Modified

- `src/lib/stores/player.svelte.test.ts` — +2 mock factories (one new, one extended), +4 imports, +2 `vi.mocked` handles, +1 describe block of 8 specs (~200 lines at the end of the file). No existing spec was modified.

## Decisions Made

Four, all recorded in the frontmatter `key-decisions`; the two that matter for reading the suite:

- **The similar-queue stub carries a 3-track tail (37-03-A).** With the module default (`[]`) the post-regenerate queue is still 1 entry long, so `primeNext() → ensureAhead()` immediately fires a SECOND `buildSimilarQueue` call and `toHaveBeenCalledTimes(1)` would be an assertion about auto-grow timing rather than about the plan-02 fall-through. A 3-track tail puts the queue more than 2 ahead of current, `ensureAhead` no-ops, and the count means exactly one thing.
- **The three sync cover reads are reset per test (37-03-B).** Found the hard way — see Issues Encountered.

## Deviations from Plan

### Auto-fixed Issues

**None.** No deviation rule fired. No bug was found in plan 02's wiring, no missing critical functionality, no blocker, no architectural change. Plan 02's implementation passed all eight assertions unmodified.

### Plan-instruction adjustments

1. **The plan's `<interfaces>` block named `resolveDeezerHQ` in the `cover-backfill` mock.** The file's actual export is `resolveHqCover`, already mocked and already bound to `mockHqCover`. Used the file as found.
2. **Test 2's exactly-once assertion required stubbing `buildSimilarQueue` non-empty** (37-03-A above). The plan's text implies `mockSimilar` is called once; with the module default it is called twice, for a reason that has nothing to do with this phase.
3. **Test 3's "src assigned exactly once" uses the plan's stated fallback** — `makeFakeAudio` has no assignment counter, so the suite records `el.src` after the play settles (the tag read held on a deferred) and asserts it is unchanged once enrichment lands. Adding a counter to the shared fake would have touched every suite in the file.
4. **The suite resets `mockGetPinned`/`mockUidCover`/`mockNameCover`**, which the plan's `afterEach` sketch did not list. Without it four of the eight specs fail when the whole file runs (they pass in isolation) — the exact false-green a negative assertion is prone to.

**Total deviations:** 0
**Impact on plan:** None. Scope held to the one test file.

## Assumption Drift (advisory)

One, non-blocking:

- **Planned:** the plan's Wave-3 brief treats the `-t "offline-served enrichment"` run as the task gate. **Actual:** a filtered run and a whole-file run disagree — all 8 passed filtered on the first attempt while 4 failed in the full file, because `vi.restoreAllMocks()` does not reset a `vi.fn()` created by a `vi.mock` factory and earlier suites leave the cover reads primed. **Why it matters:** in a 7000-line single-file suite the filtered run is not a sufficient gate for a new block; the full-file run is. Noted so plan 04 and any later player-suite work do not take a green `-t` run as proof.

## Concurrent / adjacent work reconciliation

The brief flagged `quick-260919-0mw`'s YouTube-Music-first cover chain in `cover-backfill.ts` as a possible collision. **There is none, and nothing was reverted.** This suite mocks `resolveCoverForTrack` at the module boundary and asserts only *whether* the chain was entered and *with which track* — never the tier order inside it. The quick task's reworked cover tests are untouched and green in the full run. Its other three changes (`shareOrigin()`, `albumTag()`, the `DownloadControl` in `NowPlaying.svelte`) do not intersect the offline-blob branch at all.

## Verification Gates — real output

`pnpm test` (whole repo):

```
 Test Files  129 passed (129)
      Tests  2549 passed (2549)
   Duration  9.11s
```

`pnpm check`:

```
1789801069639 START "/Users/laichan/code/tung/openmusic"
1789801069653 COMPLETED 4533 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Per-task verify commands, as run:

- **Task 1** — `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "offline-served enrichment"` → `Tests 8 passed | 278 skipped (286)`.
- **Task 1, full file** — `pnpm vitest --run src/lib/stores/player.svelte.test.ts` → `Test Files 1 passed (1) / Tests 286 passed (286)`. First attempt at this was `Tests 4 failed | 282 passed (286)` — see Issues Encountered.
- **Task 2** — `pnpm test && pnpm check`, output above.

Plan-02's player-suite baseline was 265; this file is now 286. The +21 is 8 from this plan and 13 from `quick-260919-0mw`'s cover-pin/download work — measured, not inferred (`8 passed | 278 skipped` on the filtered run gives the split directly).

### Mutation probes — the suite actually bites

Neither of these is speculation; both were applied to `player.svelte.ts`, run, and reverted (the file was restored from a scratchpad copy and `git diff --stat src/lib/stores/player.svelte.ts` confirmed empty before committing).

1. **`backfillLyrics`'s device branch disabled** (`if (false && isDeviceUid(uid))`, so a device uid falls through to `ensureTrackDetails`):
   ```
   Tests  3 failed | 5 passed | 278 skipped (286)
   ```
   Failing: the 34-D-01 regression, the device tag-miss case, and the 37-D-05 query-only case.

2. **Plan 02's fix undone** — the blob branch's `enrichFromLocalFile` + `postPlayQueue` replaced with the original `void this.primeNext();`:
   ```
   Tests  5 failed | 3 passed | 278 skipped (286)
   ```
   Failing: the up-next case, the embedded-hit case, the device tag-miss case, the ordinary-download case, and the 37-D-05 case.

## Static audit — raw grep output

**A. `grep -n "writeCoverBoth(\|setCachedCover(" src/lib/stores/player.svelte.ts`**

```
3227:			writeCoverBoth(track.uid, track.artist, track.title, this.resolvedCover);
3458:					writeCoverBoth(resolved.uid, resolved.artist, resolved.title, resolved.cover);
3835:			if (!pinned) writeCoverBoth(uid, cur.artist, cur.title, url);
```

Three hits, all pre-existing (Site A / Site B / `adoptCover`), each `hasHttpsScheme`-gated:

- `3227` ← `3226: if (hasHttpsScheme(this.resolvedCover) && !getPinnedCover(track.uid))` — 1 line above.
- `3458` ← `3457: if (hasHttpsScheme(resolved.cover))` — 1 line above.
- `3835` ← `3821: if (!hasHttpsScheme(url)) return;` — an early-return guard on `adoptCover` as a whole, 14 lines above rather than the plan's "within 3 lines". **Stronger than the plan's expectation, not weaker**: the whole function body is unreachable for a non-https url. Recording the exact shape because the plan's proximity heuristic does not describe this site.

**No hit inside `enrichFromLocalFile` (`783`–`823`)** — as required. `setCachedCover(` has zero hits in the store.

**B. `grep -n "isDeviceUid" src/lib/stores/player.svelte.ts`**

```
80:import { isDeviceUid } from '$lib/services/device-track';
737:		if (isDeviceUid(uid)) {
2211:					if (isDeviceUid(uid)) library.markUnavailable(uid); else library.removeDownload(uid);
2225:					if (!isDeviceUid(uid) && !this.redownloadQueued.has(uid)) {
3272:				if (!offlineBlob && isDeviceUid(track.uid)) {
3349:					// The fall-through is deliberately UNCONDITIONAL — no isDeviceUid gate. …
```

Matches the intent with one clarification the plan's wording omitted: `737` is `backfillLyrics` (37-D-03) and `3272` is the 34-D-06 missing-file branch, exactly as expected; `2211`/`2225` are the **pre-existing Phase-31/34 corrupt-blob branch** (a device uid is marked unavailable rather than having its download record removed / silently re-downloaded), which predates this phase and is not "around `postPlayQueue`/`postPlayCover`". `3349` is a comment asserting the absence of a gate. **There is no `isDeviceUid` condition anywhere in `postPlayQueue` or `postPlayCover`** — the 37-D-01 invariant holds.

**C. `grep -n "isRenderableCover" src/lib/stores/player.svelte.ts src/lib/services/media-session.ts`**

```
src/lib/services/media-session.ts:14:import { hasHttpsScheme, isRenderableCover } from '$lib/services/url-safety';
src/lib/services/media-session.ts:82:	if (isRenderableCover(raw)) {
src/lib/stores/player.svelte.ts:97:import { hasHttpsScheme, isRenderableCover } from '$lib/services/url-safety';
src/lib/stores/player.svelte.ts:3603:		// … isRenderableCover is the DISPLAYABLE predicate; (comment)
src/lib/stores/player.svelte.ts:3606:		if (!isRenderableCover(this.resolvedCover)) void this.resolveCoverAsync(resolved, myGen);
```

Exactly the two call sites the plan expects — `postPlayCover`'s first gate and `buildArtwork` — plus their two imports and one comment line.

**D. `grep -n "hasHttpsScheme(url)" src/lib/stores/player.svelte.ts`**

```
3757:		if (!hasHttpsScheme(url) || url === this.resolvedCover) return;   // upgradeCoverAsync
3821:		if (!hasHttpsScheme(url)) return;                                  // adoptCover
3872:		if (!hasHttpsScheme(url)) return;                                  // healCover (opens at 3865)
```

**Pitfall 4 holds:** `healCover` is still https-only. No `data:` URL can reach the probe/evict path or the localStorage cover cache.

## Known Stubs

None.

## Threat Flags

None. This plan added no product code — no new endpoint, auth path, file-access pattern or schema change. The registered threats it was assigned to pin are now asserted: **T-37-04** by spec 1 (and again by spec 4), **T-37-05** by spec 3's raw-`localStorage` check, **T-37-06** by spec 3's single-`src` check and spec 8's stable `playGen`.

## Issues Encountered

**One, and it is the finding worth carrying forward.** The suite passed 8/8 on the first filtered run and then failed 4/8 when the whole file ran. Cause: `play()` re-seeds `resolvedCover` on every entry from `getPinnedCover → attachedCoverFor → track.cover → getCachedCoverByUid → getCachedCover`. All three cache reads are module-scope `vi.fn()`s from `vi.mock` factories, and Vitest 4's `vi.restoreAllMocks()` does not reset those — earlier suites in this file (the `quick-260915-w4f` pin suite, the COVER-01 suite) leave them returning a cover. A leaked hit makes `postPlayCover`'s `isRenderableCover` gate skip the chain, so *every* "the fallback did NOT fire" assertion would have passed for entirely the wrong reason, and the embedded-art write is additionally suppressed by a leaked pin. Fixed by resetting the three reads in the suite's own `beforeEach`, with the reasoning in a comment. Clearing `player.resolvedCover` alone is NOT sufficient, which is the non-obvious part.

## Not verified here — handed to plan 04 (Wave 4, on-device UAT)

Both remain **`[UNVERIFIED-SANDBOX]`**. Neither is asserted by anything in this plan, and no test in this repo can assert them:

1. **A real MediaStore-imported file's FrontCover through `getPictures()` on Android.** Every picture in `local-tags.test.ts` and every `art` value in this suite is synthetic — written by `writeAudioTags` over the repo's `tiny.mp3` fixture, or a 4-byte `data:image/png;base64,AAAA` literal. RESEARCH assumption A3 is untested against a real device file.
2. **A `data:` artwork actually repainting the Android lock screen via `@jofr/capacitor-media-session`.** RESEARCH assumption A2 was read from plugin source and never executed. `buildArtwork`'s `data:` branch is unit-tested (37-01); what the OS does with the resulting single `sizes:'any'` entry is not. Note the standing repo memory that handing the native plugin a URL it must fetch has crashed the process — a `data:` URL is the mitigation, but the mitigation itself is what is unverified.

Also still unobserved (carried from 37-02, out of scope here): the live `enrich.local` Activity-log line on a real play. It is unit-reachable and its call site is exercised by this suite, but no dev server or device was involved.

## User Setup Required

None — no new dependency, no env var, no external service.

## Next Phase Readiness

Wave 4 (plan 37-04, on-device human UAT) is unblocked. Every behaviour plan 02's Task 2b deferred is now asserted, the repo is green on both gates, and the two device-only unknowns above are the entire remaining verification surface for this phase.

## Self-Check: PASSED

- `src/lib/stores/player.svelte.test.ts` — FOUND
- `describe('player.play — offline-served enrichment` — FOUND in that file (`grep -c` = 1)
- Commit `7dc20d6` — FOUND in `git log`
- `pnpm test` 2549/2549, `pnpm check` 0 ERRORS — both run in this session, output quoted above

---
*Phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo*
*Completed: 2026-09-19*
