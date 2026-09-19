---
phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo
plan: 02
subsystem: player
tags: [taglib-wasm, embedded-tags, data-url, cover-chain, up-next, device-tracks, memoisation, god-object-extraction]

# Dependency graph
requires:
  - phase: 37-01
    provides: readAudioTags().art, catalog.lyricByName, url-safety.isRenderableCover, buildArtwork's data: branch
  - phase: 34-device-import
    provides: 34-D-01 device uid namespace and the isDeviceUid predicate
  - phase: 36-download-tagging
    provides: audio-tags.ts read codec, TAG_MAX_BYTES, the never-throws contract
provides:
  - "local-tags.ts: localEnrichment(uid, blob) — pure, memoised, never-rejects embedded LRC + front-cover read with a positive AND negative session memo"
  - "play()'s offline-blob branch falls through to the shared post-play queue tail for EVERY offline-served track (37-D-01)"
  - "Player.enrichFromLocalFile — embedded-first enrichment that GATES the name-based cover/lyric fallbacks on the tag read"
  - "Player.postPlayCover / Player.postPlayQueue — the post-src tails of play() extracted as callable methods"
  - "backfillLyrics routes a device uid to lyricByName instead of the guaranteed no-op ensureTrackDetails call (37-D-03)"
affects: [37-03 tests, 37-04 device UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zero-network decode as the GATE for network fallbacks: fire them only for what the local file did not supply, and only after the read settles"
    - "Negative memoisation as a first-class requirement — memoising 'this file has nothing' is what stops a replay re-running both the wasm decode and the network walk"
    - "Extract-then-change: a byte-identical move commit lands first so the behaviour diff is reviewable against a 4400-line store"

key-files:
  created:
    - src/lib/services/local-tags.ts
    - src/lib/services/local-tags.test.ts
  modified:
    - src/lib/stores/player.svelte.ts

key-decisions:
  - "37-D-01: the fall-through is unconditional — no isDeviceUid gate. An ordinary download hit the same return and lost the same features; a device-only gate would re-create the two-code-paths asymmetry behind four prior cover-surface bugs"
  - "37-D-04: enrichFromLocalFile fires the cover chain, not play()'s blob branch — the decision of WHETHER to run it can only be made after the tag read"
  - "37-D-02 applied at exactly one new site: postPlayCover's full-chain gate. The Deezer-upgrade gate beside it stays hasHttpsScheme, because its result is cacheable and an embedded cover is the file's own truth"
  - "postPlayQueue takes `opts?: { fresh?: boolean }` rather than restating play()'s three-field options type — `fresh` is the only field it reads and the call site typechecks structurally"
  - "The blob branch and restore() both hold the new current as a `localTrack` local; the enrichment and the queue tail are handed that, not `this.current`, which either of them may reassign"

patterns-established:
  - "A pure service's purity gate is a grep over RAW source, so the module header names its banned imports in prose rather than spelling them (the audio-tags.ts precedent)"
  - "Memo-cap tests assert the DECODE COUNT via an instance spy on blob.arrayBuffer, so the assertion is about work avoided, not about the returned value"

requirements-completed: [ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04]

# Metrics
duration: 8min
completed: 2026-09-15
---

# Phase 37 Plan 02: local-tags memo service + player wiring Summary

**The `return;` that sat 225 lines above the cover chain and the fresh-play up-next branch is gone: every offline-served track now falls through to the shared post-play tail, and a new memoised `local-tags.ts` reads the file's OWN LRC and front cover first, so the network fallbacks fire only for what the file could not supply.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-15T08:54:06Z (base commit `7417537`)
- **Completed:** 2026-09-15T09:02:27Z
- **Tasks:** 3 (Task 1 TDD; 4 commits)
- **Files:** 3 (2 created, 1 modified)

## Accomplishments

- **`src/lib/services/local-tags.ts`** — `localEnrichment(uid, blob)` returns `{ lrc, art, artist?, title?, cached? }`, never rejects. `blob.size > TAG_MAX_BYTES` is checked BEFORE `arrayBuffer()` (a 45 MB FLAC is never copied into memory just to be rejected). An embedded lyric is kept only when `parseLRC` yields lines; a picture only when its MIME is on an `image/(jpeg|png|webp|gif)` allowlist AND it fits `MAX_ART_BYTES`. A 6-entry FIFO memo holds the NEGATIVE result too.
- **`play()`'s offline-blob branch** ends in `enrichFromLocalFile(...)` + `postPlayQueue(...)` instead of `void this.primeNext(); return;`. Unconditional — an ordinary downloaded track gains the cover chain and the generated up-next along with an imported `device:` file.
- **`enrichFromLocalFile`** applies the embedded LRC and a `data:` cover (to `resolvedCover` + a fresh `MediaMetadata`, and to nothing else), then fires `postPlayCover` and/or `backfillLyrics` only for what was missing, asked with a query-only track carrying the file's recovered artist/title.
- **`backfillLyrics`** gained an `isDeviceUid` branch onto `lyricByName` with a 12 s `combinedSignal` deadline. The `ensureTrackDetails` call it replaces was a guaranteed no-op for a device uid.
- **`restore()`** gets the same embedded-first enrichment on a PWA reopen.
- **`postPlayCover` / `postPlayQueue`** extracted from `play()` in their own commit — the "extract cohesive slices" shape CLAUDE.md asks for on this god object.

## Task Commits

1. **Task 1: local-tags.ts** — `b821433` (test, RED) → `9436b24` (feat, GREEN)
2. **Task 2a: pure extraction** — `c545d06`
3. **Task 2b: the behaviour** — `90b1a05`

No REFACTOR commit was needed. **Plan metadata (this SUMMARY, STATE, ROADMAP) left uncommitted for the orchestrator**, per the execution brief.

## Files Created/Modified

- `src/lib/services/local-tags.ts` — NEW, 121 lines. Pure (no store / i18n / `$app` import). `IMAGE_MIME_RE` allowlist (T-37-01), `MAX_ART_BYTES` cap (T-37-02), `TAG_MAX_BYTES` pre-check (T-37-03), `MEMO_MAX = 6` FIFO, `__resetLocalTagsMemo` test hook.
- `src/lib/services/local-tags.test.ts` — NEW, 173 lines, 14 specs. Every blob is built through `writeAudioTags` over the repo's own `tiny.mp3` fixture, so the cases are real container bytes.
- `src/lib/stores/player.svelte.ts` — 4 imports added; `LYRIC_WALK_TIMEOUT_MS` tunable; `postPlayCover`/`postPlayQueue` extracted; `enrichFromLocalFile` added; blob branch, `restore()` blob branch and `backfillLyrics` rewired.

## Decisions Made

Beyond the plan's assigned refs, three shaping choices:

- **`postPlayQueue(resolved, opts?: { fresh?: boolean })`.** The plan said "the existing `play()` opts parameter type". `fresh` is the only field the block reads, and restating `{ fresh?; fromFallback?; context? }` in a second place — or introducing a `PlayOpts` alias and editing `play()`'s own signature — is a larger diff than the one-field type, which the call site satisfies structurally. Documented in the method's doc comment.
- **A `localTrack` local in both blob branches.** `this.current` is passed to two things that may reassign it (`enrichFromLocalFile`, `postPlayQueue` → `weaveFreshHistory`), and TS narrowing of `this.current` across the intervening `await this.audio.play()` is not something to lean on in a 4400-line store. One named local, used by both calls.
- **The module header names its banned imports in prose.** The plan's done-criterion is `grep -c "lib/stores\|lib/i18n\|\$app"` over the RAW file = 0, so a header saying "no `$lib/stores` import" fails its own gate. Same resolution as 37-01 Task 1, and the reason is stated in the comment so the next reader does not "fix" it back.

## Deviations from Plan

### Auto-fixed Issues

**None.** No bug was found, no missing critical functionality, no blocker, no architectural change. No deviation rule fired.

### Plan-instruction adjustments (all three documented above under Decisions Made)

1. `postPlayQueue`'s parameter type narrowed to `{ fresh?: boolean }`.
2. `localTrack` locals added in `play()`'s and `restore()`'s blob branches.
3. The purity-comment wording, to satisfy the plan's own raw-source grep gate.

The plan's Task 2a offered an escape hatch on the `isRenderableCover` import ("defer the import to 2b if `svelte-check` flags unused imports"). Taken: `tsconfig.json` does not set `noUnusedLocals`, but 37-01's `pnpm check` baseline is `0 WARNINGS` and an unused import is not worth risking that on a commit whose whole value is being provably behaviour-free. The import landed in 2b with its first use.

Task 2b carries `tdd="true"`, but the plan's own `<behavior>` block states the suite for it is written in plan 03 and that the gate for THIS task is the existing player suite staying green. Followed as written — no new player specs were added here. **Plan 03 still owns every behaviour assertion listed in 2b's `<behavior>`.**

**Total deviations:** 0
**Impact on plan:** None.

## Assumption Drift (advisory)

None material. The plan's line-exact anchors (`:3217` return, `:3432-3455` cover tail, `:3456-3494` queue tail, `:745` backfillLyrics, `:600` restore) all matched the file as found.

## Verification Gates — real output

`pnpm test`:

```
 Test Files  129 passed (129)
      Tests  2472 passed (2472)
   Duration  10.12s
```

(37-01's baseline was 127 files / 2444 tests. +2 files / +28 tests: 14 are this plan's `local-tags.test.ts`, 11 are the concurrent session's `ytmusic-native.test.ts` — both counts measured, not inferred — and the remaining 3 are that session's additions to existing files.)

`pnpm check`:

```
1789462941208 START "/Users/laichan/code/tung/openmusic"
1789462941219 COMPLETED 4533 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Per-task verify commands, as run:

- **Task 1 RED** — `pnpm vitest --run src/lib/services/local-tags.test.ts` → `Test Files 1 failed (1) / Tests no tests`, `Error: Cannot find module './local-tags'`.
- **Task 1 GREEN** — same command → `Test Files 1 passed (1) / Tests 14 passed (14)`.
- **Task 1 gate** — `grep -c "lib/stores\|lib/i18n\|\$app" src/lib/services/local-tags.ts` → `0`.
- **Task 2a** — `pnpm vitest --run src/lib/stores/player.svelte.test.ts` → `Test Files 1 passed (1) / Tests 265 passed (265)`, **with no test file changed** (the `git show --stat` for `c545d06` is `player.svelte.ts` alone). `pnpm check` → `0 ERRORS`. `grep -c "private postPlayCover\|private postPlayQueue"` → `2`.
- **Task 2a move-only proof** — `git diff -U0 | grep '^[-+]' | ... | sort | uniq -c` shows every code line exactly TWICE (one `-`, one `+`). The only count-1 lines are the two new call sites, the two method signatures and their doc comments. No predicate, no ordering, no call argument changed.
- **Task 2b** — `pnpm vitest --run src/lib/stores/player.svelte.test.ts` → `Tests 265 passed (265)`, unchanged from 2a. `pnpm check` → `0 ERRORS`. `grep -c "enrichFromLocalFile\|postPlayQueue\|postPlayCover\|lyricByName("` → `13` (gate wanted ≥ 6).
- **Task 2b blob-branch gate** — `grep -n "void this.primeNext();" | awk -F: '$1>3150 && $1<3260'` → empty. The only two remaining `void this.primeNext();` lines are `:3625` / `:3634`, both inside `postPlayQueue`.

### Non-negotiable contract spot-checks

- **34-D-01 / no device `audioUrl`** — every `ensureTrackDetails(` call site in `player.svelte.ts` listed (`:592, :664, :744, :2751, :2864, :3353`). `:744` is the one inside `backfillLyrics`, and it now sits BELOW the `if (isDeviceUid(uid)) { … return; }` branch. No new call site was added on any path this plan touches.
- **No `data:` in the cover cache (T-37-05)** — all three `writeCoverBoth(` sites in the store (`:3192`, `:3423`, `:3781`) read back and confirmed still `hasHttpsScheme`-gated; `git diff HEAD` for the 2b commit contains ZERO added `writeCoverBoth(` / `setCachedCover(` / `bumpCoverVersion(` lines. `resolvedCover` is not persisted (`player-persist.ts` never reads it).
- **Pitfall 4 / `healCover`** — `git diff | grep -c healCover` → `0`. Untouched, still https-only.
- **No `isDeviceUid` gate on the fall-through (37-D-01)** — the blob branch reads `void this.enrichFromLocalFile(localTrack, offlineBlob, myGen); this.postPlayQueue(localTrack, opts); return;` with no surrounding condition.
- **Loop safety (T-37-06)** — `enrichFromLocalFile` writes only `current.lrc` and `resolvedCover`; it sets no `detailsLoaded`, clears no `audioUrl`, touches no `audio.src`, and bumps no generation. Both async paths re-check `myGen !== this.playGen` AND `current.uid` after every await.

### Not verified here (out of scope — Wave 4's job)

- That a real MediaStore-imported file's embedded picture behaves like the synthetic fixtures (RESEARCH A3). Every case in `local-tags.test.ts` is a synthetic `tiny.mp3`.
- That a `data:` artwork actually repaints an Android lock screen through `@jofr/capacitor-media-session` (RESEARCH A2).
- The plan's manual sandbox smoke (download a kuwo track, play from Library → Downloads, watch for `enrich.local` in the Activity log) was **NOT run** — no dev server was started in this session. The `enrich.local` log line exists and is unit-reachable, but its live appearance is unobserved.
- That the generated up-next actually populates for a locally-served track end to end. The code path now reaches `regenerate`, and `player.svelte.test.ts` is green, but the assertion that `buildSimilarQueue` is called and `upNextAnchorUid` is set for an offline-served seed is plan 03's test #5, not written yet.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change beyond what the plan's `<threat_model>` already registers. `local-tags.ts` is the mitigation for T-37-01 / T-37-02 / T-37-03, and the player changes carry T-37-04 / T-37-05 / T-37-06 / T-37-07 as verified above.

## Issues Encountered

One, self-inflicted and fixed inside the task: the first draft of `local-tags.ts`'s purity header spelled out `lib/stores` / `lib/i18n` / `$app`, which failed the plan's own raw-source grep gate (`2`, expected `0`). Reworded rather than weakening the gate — the 37-01 precedent.

The memo-eviction loop initially read `memo.delete(memo.keys().next().value as string)`. Replaced with an `undefined` check, since one entry goes in per call so the map can only ever be one over the cap, and CLAUDE.md's type-safety posture is worth the extra two lines.

## Concurrent-session note

Another Claude session is committing to this repo. It committed `7417537` (before this plan started) and `6f05dc4` (between my `c545d06` and `90b1a05`). All four of my commits used path-scoped `git add` on only the files listed above — confirmed per commit with `git show --stat`, each showing exactly one file.

Files that session created which I did NOT touch, stage or commit: `src/lib/services/ytmusic-native.ts`, `src/lib/services/ytmusic-native.test.ts`, `src/lib/proxy/ytmusic-innertube.ts`, `.planning/quick/260915-3ng-.../`. They are all committed by that session now; the working tree at the end of this plan carries only the untracked `37-01-SUMMARY.md` (the orchestrator's). Note that the `pnpm test` / `pnpm check` figures above include their work — `ytmusic-native.test.ts` is one of the 129 files and contributes 14 of the 2472 tests. No failure in either gate belonged to their files — there were no failures at all.

## User Setup Required

None — no new dependency, no env var, no external service.

## Next Phase Readiness

Wave 3 (plan 37-03) has every seam its test list names:

- `localEnrichment` is mockable at `$lib/services/local-tags` (single named export plus the reset hook).
- `enrichFromLocalFile` is reached by `play()` on any `library.isDownloaded` uid with a blob, and by `restore()`.
- `postPlayQueue` is the observable join point for the up-next assertions (`buildSimilarQueue` called, `upNextAnchorUid === seed.uid`).
- `logAction('enrich.local', { uid, lrc, art, cached })` is the memo-hit assertion hook.

Wave 3 owns every behaviour in 2b's `<behavior>` block — none of it is asserted yet. The highest-value one remains the 34-D-01 regression: a `device:` play must never call `ensureTrackDetails` and `current.audioUrl` must stay `null`.

## Self-Check: PASSED

- `src/lib/services/local-tags.ts` — FOUND
- `src/lib/services/local-tags.test.ts` — FOUND
- `src/lib/stores/player.svelte.ts` — FOUND
- Commits `b821433`, `9436b24`, `c545d06`, `90b1a05` — all FOUND in `git log`

---
*Phase: 37-enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo*
*Completed: 2026-09-15*
