---
phase: 38
plan: 02
subsystem: player
tags: [player-store, queue, share-arrival, autoplay-policy, generation-guard]
requires:
  - "38-01: share-arrival.ts (stubFromUidParam produces the Track these methods take)"
provides:
  - "player.spliceAndPlay(t): boolean — warm arrival, splice after current + non-fresh play, false when already current"
  - "player.armTrack(t): Promise<Track|null> — cold arrival, seat resolved + armed + PAUSED, never plays"
  - "player.spliceAfterCurrent(t) — the one private queue-splice primitive playNext/spliceAndPlay/armTrack share"
affects:
  - "plan 04 composes arriveShared() over both methods"
  - "plan 05 re-points the legacy ?play= decoder at spliceAndPlay (D-12)"
  - "NpRelated.relatedTapPlay is now a one-line delegation"
tech-stack:
  added: []
  patterns:
    - "generation-guard with a dedicated plain-field counter (armGen), re-checked after every await"
    - "never-throw store method returning a null sentinel"
    - "decision-record comment RELOCATION (component → store) rather than deletion"
key-files:
  created: []
  modified:
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/NpRelated.svelte
decisions:
  - "38-D-29: armTrack splices via spliceAfterCurrent DIRECTLY, never through playNext — playNext autoplays on an empty queue, which is exactly the first-time-visitor case"
  - "armTrack gets its own armGen counter rather than sharing playStub's pendingGen, so an arrival cannot cancel an in-flight tap's overlay bookkeeping"
  - "armTrack supersedence tests BOTH armGen and the playGen snapshot — a user play() must win over an in-flight arm"
  - "restore() takes a zero diff: verified by md5 of its exact body before and after (07524286901ff9014a5cbaa9a5fc120f) and by the file diff being insertion-only"
  - "38-D-10 dead-carrier handling removes the stub row from the queue but KEEPS the seat, mirroring restore()'s 'user can tap play to retry' precedent"
metrics:
  duration: ~25m
  completed: 2026-09-20
---

# Phase 38 Plan 02: The two player entry points a share arrival needs Summary

The player now exposes one warm composition (`spliceAndPlay`) and one cold one (`armTrack`) over a
single shared queue-splice primitive, so a share link can seat a song without the empty-queue
autoplay trap that `playNext` carries.

## What Was Built

**Task 1 — `spliceAfterCurrent` + `spliceAndPlay`, and the NpRelated collapse**

- `private spliceAfterCurrent(t)` holds the three queue lines lifted verbatim out of `playNext`
  (de-dupe by uid, find current, splice after it or at index 0). `playNext` now calls it, so its
  behaviour is byte-identical and the pin/autoplay tail is untouched. Its JSDoc records why the
  de-dupe-BEFORE-lookup ordering is the reason every caller needs an already-current guard.
- `spliceAndPlay(t): boolean` is the warm arrival: already-current → `false` and nothing happens;
  otherwise `playNext(t, { pin: false })`, the double-play guard, `play(t, { fresh: false })`,
  `true`. The full `quick-260910-qjv` decision record moved onto it from the component — why
  `fresh: true` destroyed the queue, why `pin: false`, why both guards exist — plus a red-flagged
  paragraph stating it is NOT the cold path because of D-29.
- `NpRelated.relatedTapPlay` is now `player.spliceAndPlay(track);` with a four-line pointer comment
  keeping the `quick-260910-qjv` ref discoverable at the old site. Net deletion at the component.

**Task 2 — `armTrack`**

- `private armGen = 0;` (plain field, per the house convention for internal counters) sits next to
  `pendingGen` with a comment on why it is deliberately separate.
- `armTrack(track)` reuses restore()'s steps 6-14 + 18: the 4-rung cover seed chain
  (pinned → track → uid cache → name cache), `syncMetadata()`, `loading = true`, offline-blob-first
  resolve, queue-slot patch, `backfillLyrics`, the `cachedBlobUrl` revoke, the DIRECT `audio.src`
  assign carrying the 31-D-12 reasoning forward, and the never-throw `try/catch/finally`.
- It drops every persistence-specific step: no `parsePlayerState` read, no queue/shuffle/repeat
  install, no `upNextAnchorUid` re-anchor, no deferred seek slot.
- Supersedence re-checks `gen !== this.armGen || playGenAtStart !== this.playGen` after every await;
  on that path a `superseded` flag makes the `finally` skip `loading = false`, because the newer
  call owns it (playStub's discipline).
- A dead carrier (no blob, no `audioUrl`) or a rejected resolve filters the stub row back out of the
  recipient's queue, persists, and returns `null` so the caller can fall back by name (38-D-10).

## Verification (observed, not assumed)

| Check | Command | Observed |
|---|---|---|
| Task 1 RED | `pnpm test -- src/lib/stores/player.svelte.test.ts` | **3 failed** (`player.spliceAndPlay is not a function`), 311 passed |
| Task 1 GREEN | same | **314 passed (314)** |
| Task 2 RED | same | **7 failed**, 314 passed |
| Task 2 GREEN | same | **321 passed (321)** |
| Full suite | `pnpm test` | **145 files passed, 2955 tests passed**, 0 failed |
| Typecheck | `pnpm check` | `4574 FILES 0 ERRORS 0 WARNINGS` |
| restore() zero diff | `md5` of its exact body, before vs after | `07524286901ff9014a5cbaa9a5fc120f` **both times** |
| restore() zero diff (2) | `git diff --stat` before the final commit | `1 file changed, 130 insertions(+)` — **insertion-only, no deletions** |
| Splice primitive shared | `grep -c "this.spliceAfterCurrent("` | `2` (playNext + armTrack; spliceAndPlay reaches it via playNext) |
| `spliceAndPlay` signature | `grep -c "^\tspliceAndPlay(t: Track): boolean"` | `1` |
| `armTrack` signature | `grep -c "^\tasync armTrack(track: Track): Promise<Track \| null> {"` | `1` |
| `armGen` is a plain field | `grep -c "private armGen = 0"` / `grep -c 'armGen = \$state'` | `1` / `0` |
| NpRelated delegates | `grep -c "player.spliceAndPlay(track)"` / `grep -c "player.playNext(track, { pin: false })"` | `1` / `0` |
| Decision ref relocated not deleted | `grep -c "quick-260910-qjv"` in store / in NpRelated | `1` / `1` |
| armTrack body — required tokens | bounded to the real method extent (lines 688-784) | `audio.src = src` 1, `31-D-12` 1, `38-D-14` 1, `38-D-10` 2, `38-D-29` 1 |
| armTrack body — forbidden tokens | same window | `driveSrc(` 0, `.play(` 0, `audio.load()` 0, `pendingSeek` 0, `pendingGen` 0 |
| D-06/D-29 regression test | test name contains `cold + empty queue` | passes; asserts `fake.play` **and** `player.play` both never called |

**TDD gates:** both tasks ran RED first and each RED was committed before its GREEN
(`c6fdae3` → `fa8024c`, `fff2e67` → `b8cf030`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two acceptance criteria contradicted the comment text the action asked for**

- **Found during:** Task 2
- **Issue:** The `<action>` told me to write, inside `armTrack`, "NO `audio.load()`, NO `preload`, NO
  blob pre-buffer, NO `pendingSeek`" as the 38-D-14 record, while the acceptance criteria required
  the armTrack body to contain neither `audio.load()` nor `pendingSeek`. Writing the mandated
  comment with the literal identifiers made both greps return 1. This is the same contradiction
  class plan 01 hit with `endsWith`.
- **Fix:** Reworded the comment to state the identical decision without the literal tokens ("No
  forced element reload, no preload bump, no blob pre-buffer … and no deferred seek slot — a shared
  song always starts at 0, unlike a restored one"). The decision record and both greps now hold; the
  behaviour is enforced by the tests either way.
- **Files modified:** `src/lib/stores/player.svelte.ts`
- **Commit:** `b8cf030`

**2. [Rule 3 - Blocking] `38-D-29` sat in the JSDoc, outside the body window the criterion checks**

- **Found during:** Task 2
- **Issue:** The `<action>` placed the D-29 rationale in the method's JSDoc, which precedes the
  signature; the criterion greps from the signature line downward, so it read `0`.
- **Fix:** Added the load-bearing half of the record where the decision actually lives in code — a
  two-line `38-D-29` comment on the `this.spliceAfterCurrent(track)` call explaining why the splice
  is direct and not routed through `playNext`/`spliceAndPlay`. The JSDoc paragraph stays.
- **Files modified:** `src/lib/stores/player.svelte.ts`
- **Commit:** `b8cf030`

**3. [Rule 3 - Blocking] TypeScript narrowed `player.current` to `never` in the cold-start test**

- **Found during:** Task 1
- **Issue:** `player.current = null` followed by `expect(player.current?.uid)` made control-flow
  analysis narrow the field to `never`, failing `pnpm check` (the runtime test passed —
  `spliceAndPlay` mutates `current` synchronously, which is the point).
- **Fix:** Applied the idiom the neighbouring qjv suite already uses: read through a
  `const cur = () => player.current` getter, with the existing explanatory comment carried over.
- **Files modified:** `src/lib/stores/player.svelte.test.ts`
- **Commit:** `fa8024c`

No other deviations.

## Assumption Drift (advisory)

**`armTrack`'s offline branch needed one line the plan's step-by-step did not list.**

- **Planned:** step (d)'s offline branch was described as "the `localTrack` + `enrichFromLocalFile`
  lines as restore()".
- **Actual:** `restore()` keeps a separate `resolved` variable that its offline branch never
  reassigns, because it only ever reads `resolved.audioUrl` in the non-blob case. `armTrack`
  RETURNS the resolved track, so its offline branch also assigns `resolved = localTrack` — otherwise
  a downloaded-song arrival would return the unresolved input.
- **Why:** a return value the analog does not have. Not a behaviour change to anything existing.

## Known Stubs

None. Both methods are fully implemented. They currently have exactly one production caller between
them (`NpRelated` → `spliceAndPlay`); `armTrack` has no production caller until plan 04 composes
`arriveShared()` over it, which is planned scope rather than a stub.

## Threat Flags

None. No new network surface, no new parse, no new trust boundary — `armTrack` resolves through the
existing `ensureTrackDetails` → adapter → `apiFetch` governor path (T-38-04's stated mitigation) and
both methods take an already-validated `Track`.

## Commits

| Task | Gate | Commit | Files |
|---|---|---|---|
| 1 | RED | `c6fdae3` | `player.svelte.test.ts` |
| 1 | GREEN | `fa8024c` | `player.svelte.ts`, `NpRelated.svelte`, `player.svelte.test.ts` |
| 2 | RED | `fff2e67` | `player.svelte.test.ts` |
| 2 | GREEN | `b8cf030` | `player.svelte.ts` |

## Self-Check: PASSED

- `src/lib/stores/player.svelte.ts` — FOUND (modified; `spliceAfterCurrent`, `spliceAndPlay`,
  `armTrack`, `armGen` all present)
- `src/lib/components/NpRelated.svelte` — FOUND (modified; delegates)
- `src/lib/stores/player.svelte.test.ts` — FOUND (modified; +12 tests)
- Commits `c6fdae3`, `fa8024c`, `fff2e67`, `b8cf030` — all FOUND in `git log`
