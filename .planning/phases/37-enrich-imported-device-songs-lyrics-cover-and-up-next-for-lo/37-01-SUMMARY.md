---
phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo
plan: 01
subsystem: services
tags: [taglib-wasm, media-session, lyrics, cover-art, data-url, pure-services]

# Dependency graph
requires:
  - phase: 36-download-tagging
    provides: audio-tags.ts read/write codec, the never-throws 36-D-06 contract and the container fixtures
  - phase: 34-device-import
    provides: 34-D-01 device uid namespace with its 'kuwo' placeholder source
provides:
  - "readAudioTags() returns the embedded FrontCover as art { data, mimeType } from the same readTags() pass"
  - "catalog.ts exports lyricByName(artist, title, signal): Promise<string | null> — a name-only lyric walk that skips no source"
  - "url-safety.ts exports isRenderableCover (https OR data:image/*;base64), distinct from the cacheable hasHttpsScheme"
  - "buildArtwork() passes a data: cover to the OS media card as a single sizes:'any' entry"
affects: [37-02 player wiring, 37-03 tests, 37-04 device UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two predicates, one definition each: DISPLAYABLE (isRenderableCover) vs CACHEABLE (hasHttpsScheme)"
    - "Shared internal walk + thin named entry points (lyricWalk → crossSourceLyric / lyricByName)"

key-files:
  created:
    - src/lib/services/url-safety.test.ts
  modified:
    - src/lib/services/audio-tags.ts
    - src/lib/services/audio-tags.test.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/services/url-safety.ts
    - src/lib/services/media-session.ts
    - src/lib/services/media-session.test.ts

key-decisions:
  - "37-D-02: the embedded picture is read from the existing readTags() pass; the two taglib-wasm/simple cover helpers are banned by a whole-file grep test (a second open of a 40 MB-ceiling file, and one of them discards the MIME)"
  - "37-D-02: art is widened onto readAudioTags' RETURN type only, never onto AudioTagFields — that interface is the WRITE input and already takes a picture as its own argument"
  - "37-D-02: isRenderableCover is used at exactly TWO sites (its definition and buildArtwork). Every cache/heal/probe site keeps hasHttpsScheme, so a data: URL can never enter the localStorage cover cache"
  - "37-D-03: lyricByName is a second entry point on a shared walk rather than a call to crossSourceLyric with a device Track, because that would skip the 34-D-01 placeholder source 'kuwo'"
  - "37-D-03: the return is string | null by construction, so no caller can adopt an audioUrl for a device track"

patterns-established:
  - "Predicate-pair discipline: when a second, looser predicate is introduced, the doc comment names the exact call sites the strict one keeps"
  - "Grep-gate test: a ban on an API is asserted against the RAW source including comments, so prose cannot satisfy the check while the code violates it"

requirements-completed: [ENRICH-01, ENRICH-02, ENRICH-04]

# Metrics
duration: 9min
completed: 2026-09-15
---

# Phase 37 Plan 01: Pure seams for device-track enrichment Summary

**Embedded FrontCover now comes back from `readAudioTags` in the one wasm pass it already made, `catalog.ts` exports a name-only `lyricByName` walk that no longer skips the device placeholder source, and `buildArtwork` hands a `data:image` cover to the OS media card as a single entry instead of destroying it into `/favicon.svg`.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-09-15T02:42:00Z (approx — base commit 81c147a)
- **Completed:** 2026-09-15T02:50:00Z
- **Tasks:** 3 (all TDD, 6 commits)
- **Files modified:** 7 (1 created)

## Accomplishments

- `readAudioTags` returns `art: { data, mimeType }` read from `t.pictures` (FrontCover preferred, `pictures[0]` fallback) in the SAME `readTags()` call that already yields title/artist/lyrics — no second wasm open, never-throws contract intact, absent picture stays absent.
- `crossSourceLyric`'s body extracted verbatim into `lyricWalk(artist, title, skipSource, signal)`; `crossSourceLyric` is now a one-line wrapper so `ensureTrackDetails` behaviour is unchanged, and `lyricByName` passes `skipSource = null` so the kuwo rung IS walked.
- `isRenderableCover` added to `url-safety.ts` with an `image/` MIME allowlist (T-37-01), wired into `buildArtwork` only. Every cacheable/probe-able site still uses `hasHttpsScheme`.
- `url-safety.ts` has a test file for the first time.

## Task Commits

1. **Task 1: embedded picture read** — `5ebe758` (test, RED) → `541f9d0` (feat, GREEN)
2. **Task 2: name-only lyric walk** — `f71e49a` (test, RED) → `d014e5a` (feat, GREEN)
3. **Task 3: renderable-cover predicate + data: artwork** — `2a3e10e` (test, RED) → `cfd4b14` (feat, GREEN)

No REFACTOR commits were needed — each GREEN was already the minimal shape.

**Plan metadata:** left uncommitted for the orchestrator (this SUMMARY, STATE, ROADMAP).

## Files Created/Modified

- `src/lib/services/audio-tags.ts` — `readAudioTags` return type widened with `art?: { data, mimeType }`; picture picked from `t.pictures` with the 37-D-02 rationale comment.
- `src/lib/services/audio-tags.test.ts` — 7 new assertions: per-container mime + byte-exact round-trip, per-container "no picture written = art absent", and the whole-file grep gate (T-37-04).
- `src/lib/services/catalog.ts` — `lyricWalk` extracted; `crossSourceLyric` reduced to a wrapper; `lyricByName` exported with the 37-D-03 comment.
- `src/lib/services/catalog.test.ts` — new `lyricByName` describe: kuwo rung walked, bare-string return, empty query and pre-aborted signal each issue zero searches across every registry source.
- `src/lib/services/url-safety.ts` — `DATA_IMAGE_RE` + `isRenderableCover`, with the doc comment naming the four sites that deliberately keep `hasHttpsScheme`.
- `src/lib/services/url-safety.test.ts` — NEW. Pins both predicates, including that `hasHttpsScheme` rejects a `data:` image.
- `src/lib/services/media-session.ts` — `buildArtwork` data:image branch (one `sizes:'any'` entry, MIME parsed from the URL); doc comment extended.
- `src/lib/services/media-session.test.ts` — two new specs; all six pre-existing `buildArtwork` specs unchanged and green.

## Decisions Made

Beyond the plan's assigned refs (37-D-02, 37-D-03), two shaping choices:

- The plan's done-criterion `grep -c "readCoverArt\|readPictures" src/lib/services/audio-tags.ts` is 0 **including comments**, so the doc comment describes the two banned helpers without naming them, and the test asserts against the raw source rather than comment-stripped source. A comment-stripped check would let "do not call X" prose coexist with a call to X.
- `buildArtwork` captures `const raw = cover ?? ''` before the https guard. `hasHttpsScheme` is a `url is string` predicate, so on its FALSE branch TS narrows `cover` to `never` and no string method is callable — `raw` keeps the MIME parse typed without an `as any` or a change to the existing predicate's signature.

## Deviations from Plan

None affecting behaviour. Two small adjustments inside the plan's own instructions, both documented above under Decisions Made (the grep-gate comment wording, and the `raw` local needed to typecheck the MIME parse). No deviation rule was triggered: no bug found, no missing critical functionality, no blocker, no architectural change.

The plan's Task 1 behaviour note offered an escape hatch on the multi-picture case ("only if the write side cannot produce two — otherwise document that the fallback is covered by the single-picture case"). The write side emits exactly one picture, so the `?? pictures[0]` fallback is covered by the single-picture round-trip, and the test says so in a comment.

**Total deviations:** 0
**Impact on plan:** None. Scope held to the three pure seams; `player.svelte.ts`, `local-tags.ts` and everything in Waves 2-4 untouched.

## Verification Gates — real output

`pnpm test`:

```
 Test Files  127 passed (127)
      Tests  2444 passed (2444)
   Duration  9.05s
```

`pnpm check`:

```
1789462147672 START "/Users/laichan/code/tung/openmusic"
1789462147683 COMPLETED 4529 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Per-task verify commands, as run:

- Task 1 — `pnpm vitest --run src/lib/services/audio-tags.test.ts` → `Test Files 1 passed (1) / Tests 49 passed (49)`. RED beforehand was `Tests 3 failed | 46 passed (49)` with `expected undefined to be 'image/png'`.
- Task 1 gate — `grep -c "readCoverArt\|readPictures" src/lib/services/audio-tags.ts` → `0`.
- Task 2 — `pnpm vitest --run src/lib/services/catalog.test.ts` → `Test Files 1 passed (1) / Tests 69 passed (69)`. RED beforehand was `Tests 3 failed | 66 passed (69)` with `TypeError: lyricByName is not a function`. The pre-existing `ensureTrackDetails — crossSourceLyric is single-source (RESOLVE-02)` test is in that green count, unmodified.
- Task 2 gate — `grep -c "export async function lyricByName" src/lib/services/catalog.ts` → `1`.
- Task 3 — `pnpm vitest --run src/lib/services/url-safety.test.ts src/lib/services/media-session.test.ts && pnpm check` → `Test Files 2 passed (2) / Tests 28 passed (28)`, then `0 ERRORS`. RED beforehand was `Tests 6 failed | 22 passed (28)`.

Contract spot-check — `grep -rn "isRenderableCover" src | grep -v test` returns exactly the definition (`url-safety.ts:51`), its doc line, the `media-session.ts:14` import and the `media-session.ts:82` call. No cache write, `adoptCover`, `upgradeCoverAsync` or `healCover` site was touched, so a `data:` URL still cannot reach the localStorage cover cache.

Not verified here (out of scope, Wave 4's job): that a real device MediaStore file's embedded picture behaves like the synthetic fixtures (RESEARCH assumption A3), and that the plugin actually renders a `data:` artwork on a real lock screen (assumption A2 — read from plugin source, never executed).

## Issues Encountered

Two self-inflicted, both fixed inside the task:

1. The first draft of the Task 1 doc comment named `readCoverArt`/`readPictures` in prose, which failed the plan's own grep gate. Reworded rather than weakening the test.
2. `pnpm check` initially failed with `Property 'slice' does not exist on type 'never'` in `buildArtwork` — the `url is string` predicate's negative-branch narrowing. Fixed with the pre-guard `raw` local; zero errors after.

## Concurrent-session note

Another Claude session is working in this repo. At the end of this plan the tree carries changes I did NOT make and did NOT touch, stage or commit:

- modified: `src/lib/proxy/ytmusic.ts`, `src/routes/api/ytmusic/stream/[videoId]/+server.ts`
- untracked: `src/lib/proxy/ytmusic-innertube.ts`, `.planning/quick/260915-3ng-native-only-ytmusic-playback-resolve-the/`

All six of my commits used path-scoped `git add` on only the files listed above. Nothing was staged by the other session when I committed. Note that `pnpm test` (2444 passing) ran with those uncommitted ytmusic changes present in the tree.

## User Setup Required

None — no new dependency, no env var, no external service.

## Next Phase Readiness

Wave 2 (plan 37-02) has all three seams it depends on:

- `readAudioTags(bytes).art` for the embedded cover → builds the `data:` URL with the MIME allowlist and `MAX_ART_BYTES` cap (T-37-01/T-37-02 are plan 02's to mitigate).
- `lyricByName(artist, title, signal)` for the device branch of `backfillLyrics`.
- `isRenderableCover` for the player's full-chain skip gate at `player.svelte.ts:3442` — the one remaining site the plan's research assigns it. Pitfall 4 stands: `healCover` must stay https-only.

## Self-Check: PASSED

- `src/lib/services/url-safety.test.ts` — FOUND
- `src/lib/services/audio-tags.ts`, `audio-tags.test.ts`, `catalog.ts`, `catalog.test.ts`, `url-safety.ts`, `media-session.ts`, `media-session.test.ts` — FOUND
- Commits `5ebe758`, `541f9d0`, `f71e49a`, `d014e5a`, `2a3e10e`, `cfd4b14` — all FOUND in `git log`

---
*Phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo*
*Completed: 2026-09-15*
