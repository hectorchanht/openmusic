---
phase: 34-import-device-songs-as-native-downloads
plan: 02
subsystem: playback
tags: [device-import, guards, library-state, never-stop, truthfulness]

requires:
  - phase: 34
    plan: 01
    provides: "isDeviceUid / deviceUid — the `device:` identity namespace and the blobStore device seam"
  - phase: 34
    plan: 05
    provides: "toast.fileMissing across all 15 locales"
provides:
  - "ensureTrackDetails device short-circuit — a device uid can never dispatch to a source adapter"
  - "tryFallback device bar — a device uid can never be cross-source substituted"
  - "library.unavailable (persisted, reactive) + isUnavailable / markUnavailable / clearUnavailable"
  - "library.setDownloads — the import's single wholesale add/drop/refresh write"
  - "player: the two D-06 seams (offline miss → mark + explain + skip; corrupt blob → mark, never evict)"
affects: [34-07 import store, 34-08 RowBadges/DownloadControl UI]

tech-stack:
  added: []
  patterns:
    - "First-statement identity guard at a shared seam: one line in the service covers every caller route"
    - "Persisted-vs-transient split in one store: `unavailable` joins LibShape, `downloading` deliberately does not"

key-files:
  created: []
  modified:
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/services/fallback.ts
    - src/lib/services/fallback.test.ts
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/stores/player.svelte.ts

key-decisions:
  - "The D-06 guard lives at the player's SILENT eviction site, not inside library.removeDownload — explicit user removal of an imported entry must keep working (plan's own design note, deviating from 34-VALIDATION's D-06 row wording)"
  - "The fallback bar lives in tryFallback (the service), not player.runFallback, so play(), the audio `error` listener and handleDefinitiveFailure's retry are all covered by one line"
  - "The device guard sits ABOVE isTrackReady so a local file is never judged stale (Open Q5 — no refresh stamping)"
  - "setDownloads deliberately never calls blobStore.del: the import drop lane has no file it owns"

requirements-completed: [34-D-01, 34-D-06, 34-D-07, 34-D-08]

duration: 8min
completed: 2026-09-13
---

# Phase 34 Plan 02: Device guards, unavailable state, and the two player seams Summary

**A `device:` track can no longer be dispatched to a source adapter or silently swapped for a streamed recording, and a device file that goes missing is now marked, explained and skipped past — never removed.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 3 of 3
- **Files modified:** 7 (0 created)

## Accomplishments

### Task 1 — the two service guards (commit `94e1552`)

`ensureTrackDetails` now opens with `if (isDeviceUid(track.uid)) return track;` (catalog.ts:359), one line
**above** `isTrackReady` (:360). Two things ride on that ordering. First, `track.source` on a device entry is a
documented placeholder (`'kuwo'`, Plan 34-01), so an unguarded call would dispatch `SOURCES['kuwo'].resolve` on a
foreign songid and resolve a *different* song under the user's own file's identity — RESEARCH bite #1. Second,
a local file has no `resolvedAt`/TTL semantics, so sitting above the readiness check means it can never be judged
stale and re-resolved (Open Q5). The wrapper's "This wrapper owns the guard and the `resolvedAt` stamp" sentence
was extended in place to name the short-circuit rather than contradicted.

`tryFallback` opens with `if (isDeviceUid(failed.uid)) return null;` (fallback.ts:89), above the first
`fallbackOrder(` call (:92). Failover is silent by design, so substituting some other recording would tell the
user their file played when it did not. Returning null routes the caller into its existing total-failure path.
`fallbackOrder` is untouched.

Six new tests. `catalog.test.ts` `describe('34-D-01 device uid guard')` asserts the SAME object reference back,
`SOURCES.kuwo.resolve` / `SOURCES.kuwo.search` / `readResolveCache` all not-called, and `resolvedAt` still
undefined — then repeats it with `detailsLoaded: false` plus an expired `resolvedAt` (both of which would force a
network track to re-resolve). `fallback.test.ts` `describe('34-D-06 device uids never fall back')` asserts
`searchAll` not-called and that the `attempted` set is left untouched. Each describe carries a regression pin
proving the normal kuwo path is unchanged.

### Task 2 — `library.unavailable` + `setDownloads` (commit `2e4f8e1`)

`unavailable = $state<Set<string>>(new Set())` sits next to `downloading` and is the deliberate opposite of it:
**persisted**, as `unavailable?: string[]` in `LibShape`. A file the OS lost is still lost after a relaunch, so a
transient mark would let the badge lie until the user tapped the song again. Optional in storage, so an existing
payload loads unchanged (`Array.isArray(v.unavailable) ? … : []`).

`isUnavailable` / `markUnavailable` / `clearUnavailable(uid?)` / `setDownloads(next)` follow the one-liner public
API style, each mutating method ending in `this.save()`, each reassigning a new Set (the `beginDownload`
copy-on-write idiom) so the runes graph re-renders.

`setDownloads` replaces `downloads` wholesale, persists, and prunes `unavailable` down to uids still present —
so a re-import that finds the file again starts clean. It never calls `blobStore.del`: the only lane that drops
here is the device import, whose files the app never owned.

`removeDownload` gained a prune of its own uid's mark and the comment explaining why it is *not* guarded for
device uids — it is the explicit-user path (`library/+page.svelte:162` edit-mode swipe), and the file itself is
protected by `blobStore.del`'s device refusal. `clearAll` resets the set.

Ten new tests (plan asked for ≥ 7), including a `blobStore` module mock so "setDownloads never deletes a file" is
a direct assertion rather than an inference.

### Task 3 — the two player seams (commit `545d3ee`)

Both are guarded branches at existing sites; nothing was refactored, `runFallback` / `handleTotalFailure` /
the restore-attach effect and the other four `blobStore.get` call sites were not touched.

**Offline miss** (inside `if (library.isDownloaded(track.uid))`, after the `myGen` check, before
`if (offlineBlob && this.audio)`): `!offlineBlob && isDeviceUid(track.uid)` →
`library.markUnavailable` + `logAction('device.missing')` + `loading = false` + `error = 'toast.fileMissing'` +
`clearMedia()` + `handleTotalFailure(track)` + return. Nine code lines. Without it, execution fell through to
`ensureTrackDetails` (now guarded, returns url-less) → `runFallback` (now barred) → a generic "couldn't play":
honest, but leaving no mark and no reason.

**Corrupt blob** (:~2100): `if (isDeviceUid(uid)) library.markUnavailable(uid); else library.removeDownload(uid);`
and the re-download block gated on `!isDeviceUid(uid) && !this.redownloadQueued.has(uid)`. Re-downloading a local
file is meaningless — `downloadTrack` would return `'failed'`. `blobStore.del` is left in place (it is already a
refusal for device uids) so the stored-uri index is still cleared. The `toast.downloadCorrupted` notice is
unchanged for both kinds.

## Verification Results

All commands were run; these are observed outputs.

| Check | Result |
|---|---|
| `pnpm vitest --run src/lib/services/catalog.test.ts src/lib/services/fallback.test.ts` | 86 passed (2 files) |
| `pnpm vitest --run src/lib/stores/library.svelte.test.ts` | 18 passed |
| `pnpm vitest --run src/lib/stores/player.svelte.test.ts` | 265 passed |
| `pnpm test` (full suite) | **123 files, 2318 tests passed** (baseline 123 / 2301 + 17 new) |
| `pnpm check` | 4521 files, 0 errors, 0 warnings |
| `git status --short` after task 3 | clean |

TDD gates observed for tasks 1 and 2: tests written and run failing first (task 1: 4 failed / 82 passed — the two
regression pins green from the start, which is what makes the 4 failures meaningful; task 2: 10 failed / 8
passed), then implemented to green.

Acceptance-criterion greps, observed:

- catalog guard line **359**, `isTrackReady` line **360** (guard is above) ✓
- fallback bar line **89**, first `fallbackOrder(` inside `tryFallback` line **92** ✓
- `device-track` imported in both services ✓
- `unavailable = $state<Set<string>>(new Set())` ×1; the four method signatures ×4; `unavailable: [...this.unavailable]` ×1 ✓
- the `awk` scan of `setDownloads` for `blobStore.del` prints nothing ✓
- `library.markUnavailable` ×2, `this.error = 'toast.fileMissing'` ×1, both compound-guard greps ×1, `library.removeDownload(` ×1 (the guarded one) ✓

**Not verified (cannot be, here):** the on-device behaviour — that a real missing file produces the alert glyph
and the inline message on an Android handset. That is device UAT, and no claim is made about it.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blockers were encountered.

### Acceptance-criterion note (not a code change)

`git diff --numstat src/lib/stores/player.svelte.ts` shows **27 added / 2 deleted**, against a stated ceiling of
≤ 20 added. The gap is entirely the comment text the plan's own `<action>` block mandated: 15 of the 27 added
lines are the two required comment blocks (the "ONE player seam D-05 could not cover" rationale and the
Pitfall-10 evict-vs-mark rationale). **Code** added is 12 lines, inside the `<action>`'s own "net addition ≤ 15
lines" bound. Recorded here rather than trimming load-bearing decision comments to satisfy a line count — the
same call 34-01 made on its comment-blind `awk` criterion.

## Assumption Drift (advisory)

**`this.error = 'toast.fileMissing'` is not durable across an auto-advance**
- **Found during:** Task 3
- **Planned:** the `<action>` states "handleTotalFailure … does NOT overwrite `this.error`, so the file-missing reason stays visible".
- **Actual:** `handleTotalFailure` itself indeed never touches `this.error` — but it ends in `next()`, and `play()` clears `this.error = null` (player.svelte.ts:3051) in its synchronous prefix. So when a next track exists, the inline message is replaced almost immediately; it only persists when nothing follows in the queue (the single-tap-on-a-missing-song case, which is the common one).
- **Why it matters:** the *durable* "user sees why it won't play" signal is the persisted `unavailable` mark that Plan 34-08's `RowBadges`/`DownloadControl` render, plus the batched skip notice — not `player.error`. Shipped as planned (setting the error after `handleTotalFailure` would instead leave a stale "File missing" toast hanging over a track that is playing fine, which is worse). Flagged so 34-08 does not lean on the Nowbar line as the primary affordance.

## Known Stubs

None. Every export added here is fully implemented and exercised by a test. `setDownloads` and
`clearUnavailable()` have no in-app caller yet — that is by construction: Plan 34-07's import store is their
sole intended caller, and both are contract surface this plan was asked to create.

## Threat Flags

None. No network endpoint, auth path or schema at a trust boundary was introduced. Both trust boundaries named in
the plan's threat register are narrowed: T-34-11 (wrong-song resolve) and T-34-13 (substituted recording) are
closed by first-statement guards with not-called assertions; T-34-12 (silent removal of a user's entry) is closed
by guarding the player's only silent `removeDownload` caller — `grep -c "library.removeDownload("` on
player.svelte.ts returns 1, so no unguarded caller was added.

## Notes for Future Phases

- **34-07** (import store) owns `setDownloads` and `clearUnavailable()`. The drop lane is D-08's "confirmed gone at an explicit import" — a transient read failure must not reach it.
- **34-08** (UI) reads `library.isUnavailable(uid)`. Prefer it over `player.error` as the file-missing affordance (see Assumption Drift).
- The `unavailable` set is currently only ever *pruned* by `setDownloads`, never cleared on a successful play. If a user restores a file without re-importing, the mark survives until the next import. That is D-08-consistent, but if it reads as stale in UAT the one-line fix is a `clearUnavailable(uid)` on the offline-blob success path.

## Self-Check: PASSED

- `src/lib/services/catalog.ts` — FOUND (modified)
- `src/lib/services/fallback.ts` — FOUND (modified)
- `src/lib/stores/library.svelte.ts` — FOUND (modified)
- `src/lib/stores/player.svelte.ts` — FOUND (modified)
- `.planning/phases/34-import-device-songs-as-native-downloads/34-02-SUMMARY.md` — FOUND
- Commit `94e1552` — FOUND
- Commit `2e4f8e1` — FOUND
- Commit `545d3ee` — FOUND
