---
phase: quick-260919-ejm
plan: 01
subsystem: offline-files
tags: [android, mediastore, retag, data-safety, capacitor]
status: complete
requires: [quick-260919-1eh, quick-260919-30x, quick-260919-3j1]
provides:
  - "MediaStoreSaver.writeInPlace — the one write capability against a user-owned file"
  - "blobStore.overwriteDeviceFile + the pending-write journal + replayPendingDeviceWrites"
  - "retagOne's device fork (same codec pass, different write sink)"
affects:
  - "Settings -> Downloads sweep now includes imported songs"
  - "Edit metadata now opens for an imported song"
key-files:
  created: []
  modified:
    - android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
    - src/lib/services/media-store.ts
    - src/lib/services/blob-store.ts
    - src/lib/services/blob-store.test.ts
    - src/lib/services/retag.ts
    - src/lib/services/retag.test.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/MetadataEditor.svelte
    - src/routes/(app)/settings/downloads/+page.svelte
    - src/lib/i18n/*.ts (15 dictionaries, one additive key)
metrics:
  tasks: 6
  commits: 8
  tests: 2788 passed / 135 files
  completed: 2026-09-19
---

# quick-260919-ejm: In-place tag rewrite for imported device files — Summary

Editing an imported song's metadata now rewrites **that** file, at its own path, under its own
name — via a Kotlin `openFileDescriptor(uri, "rwt")` stream fronted by a temp-then-verify-then-journal
ladder — from exactly two explicit gestures: Edit metadata → Save, and the confirmed
Settings → Downloads sweep.

## Commits

| Commit | What |
|---|---|
| `c0e9049` | Kotlin `writeInPlace` + the TS interface and its reject-code contract |
| `40ff3d0` | RED: 23 failing cases for the failure ladder |
| `de47cf1` | GREEN: `overwriteDeviceFile`, the journal, `replayPendingDeviceWrites` |
| `8fe3150` | RED: the device fork's contract in `retag.test.ts` |
| `afee2e8` | GREEN: `retagOne` forks at the write step |
| `afda691` | One additive i18n key across all 15 dictionaries |
| `9378bbd` | UI reachability: editor row, no rename field, sweep disclosure, replay on mount |
| `95327f3` | The discipline gate's regression tests |

## The implemented failure ladder, rung by rung

Rungs 1–2 live in `retagOne`, 3–5 in `overwriteDeviceFile`, 6–8 in the Kotlin, 9–10 in the journal.
"Covered" below means a node test asserts the behaviour; it never means the Kotlin ran.

| # | Failure | Caught where | User's file | Test? |
|---|---------|--------------|-------------|-------|
| 1 | Codec declines (`skipped-size` over 40 MB, `unknown-container`, `no-fields`, `error`) | `retagOne`, before the fork | **Untouched** | YES — `retag.test.ts` "rung 1" ×2, asserting `overwriteDeviceFile` was never called |
| 2 | Tagged bytes do not parse back | `retagOne`'s `readAudioTags` round trip | **Untouched** | YES — "rung 2", both the `null` and the wrong-title case |
| 3 | New bytes below `MIN_BLOB_BYTES` | `overwriteDeviceFile` precondition | **Untouched** | YES — no temp write, no bridge call |
| 4 | Temp write fails (disk full, `write_blob` rejects) | caught → temp cleaned → `'failed'` | **Untouched** | YES |
| 5 | Temp file INCOMPLETE (`stat().size !== blob.size`) | the completeness gate | **Untouched** | YES — plus a case where `stat` itself rejects, treated as incomplete |
| 6 | Row no longer matches (MediaStore `_ID` reassigned, 34-D-02) | Kotlin `SIZE`-column precondition → `precheck:` | **Untouched** | PARTIAL — the TS *routing* of a `precheck:` reject is tested; the Kotlin query that produces it is **not** (no device) |
| 7 | Android refuses access / user denies consent | `SecurityException` → IntentSender → `denied` | **Untouched** | PARTIAL — the TS routing of `denied` is tested; the dialog itself is **not** |
| 8 | Stream fails halfway (IO error) | `io:` → journal **and** temp **KEPT** | **Possibly truncated, recoverable** | YES — the single most important test in the set |
| 9 | Death between the temp write and the bridge call | journal entry survives | **Fully old** → replay makes it fully new | YES — a test asserts the entry exists *at the moment the bridge is called* |
| 10 | Death MID-STREAM | journal + temp both survive | **Truncated until replay** | YES for the replay mechanism; the death itself is untestable here |
| 11 | Bytes landed, column update failed | swallowed inside Kotlin | **Fully new bytes**, stale columns | NO — Kotlin-only (D-8) |

Rungs 1–5 and 8–10 are covered by real assertions. Rungs 6, 7 and 11 are covered only on the TS
side of the bridge; their Kotlin halves are unverified (see "needs a device").

**One addition beyond the plan's contract (Rule 2).** The plan named four reject prefixes. An
*unrecognised* message was undefined behaviour, and the convenient reading ("probably nothing was
written, clean up") is the one that turns a recoverable truncation into a permanent one. `rejectCode`
therefore falls through to `io:` — recovery state is kept for anything it does not recognise. Pinned
by a test.

## The one window that cannot be made atomic

**A process death while the stream-over is in flight.** Truncate-then-write is not atomic, and
MediaStore offers no rename-into-place for a file the app does not own, so there is no way to make
the swap instantaneous.

- **What the user would see:** the song plays for a shorter time than it should and then stops, or
  fails to decode entirely. A file manager shows the same file, same name, at a smaller size. Nothing
  is duplicated and nothing is missing from their library — the row is still listed (34-D-06).
- **How replay recovers it:** the complete new bytes are still in `Directory.Data/retag-tmp/<uid>`,
  and the uid is in the `openmusic:retag-pending:v1` journal (written *before* the bridge call, so a
  death anywhere from that point on is discoverable). The next `overwriteDeviceFile` — or the next
  visit to Settings → Downloads — re-streams the temp over the file and the song is whole again.
- **Replay carries no `expectedBytes`**, deliberately: after a partial write the row's SIZE cannot
  match the original, so the rung-6 precondition that protects a *fresh* write would block the
  repair. The check that replaces it is that the temp must still stat to exactly the size the journal
  recorded; anything else is not a recovery source and the entry is dropped.
- **Named ceiling:** replay is lazy — those two trigger points and nowhere else. A truncated file
  stays truncated until one of them happens. No app-boot hook, because a file write in the app
  shell's mount is exactly the class of automatic write the last three tasks worked to keep out.
  Upgrade path if device UAT shows the lag matters: call `replayPendingDeviceWrites()` from the
  `(app)` layout's existing mount.

## THE AUTHORISED EXCEPTION — the `quick-260919-30x` call-site gate

This task deliberately adds **one** write capability against a user-owned file and **no** delete,
rename or move capability. Recorded here so the next audit reads it as a decision, not a regression.

Baseline command, run at `d5315af` (the pre-task commit) and again on the finished tree:

```
grep -rn 'blobStore.del\|deleteFromMusic\|Filesystem.deleteFile\|saveToMusic\|writeInPlace\|MediaStoreSaver' src \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)'
```

Production delta (test files excluded, line numbers stripped so a shifted line is not a false hit):

```
> src/lib/services/blob-store.ts:				await MediaStoreSaver.writeInPlace({ uri: target, sourcePath });
> src/lib/services/blob-store.ts:		await Filesystem.deleteFile({ path: tempPath(uid), directory: NATIVE_DIR });
> src/lib/services/blob-store.ts:		await MediaStoreSaver.writeInPlace({
> src/lib/services/media-store.ts:	writeInPlace(opts: {
```

Nothing was removed (no `<` lines). The four additions are exactly the authorised three: the
interface declaration, its two call sites (the fresh write and the replay), and the temp-file delete
— which targets `Directory.Data/retag-tmp/*`, a file this app wrote milliseconds earlier, and can
never name a user file.

## An imported uid cannot reach `nativePut`, `saveToMusic`, `deleteFromMusic` or `Filesystem.deleteFile` — traced

Every production call site, followed to its guard:

| Sink | Call sites | Why a device uid cannot arrive |
|---|---|---|
| `blobStore.put` → `nativePut` | `retag.ts:205`, `download-track.ts:284` | `retag.ts:205` now sits inside the `else` of `if (device)` — reading the fork, there is no path from a device uid to it. `download-track.ts` is **byte-identical to the baseline** (verified: `git diff` over the task range is empty), so its reachability is unchanged; its UI row is behind `{#if !isDevice}` and a device Track has `audioUrl: null` with no resolvable source. |
| `saveToMusic` | `blob-store.ts:478` only | Inside `nativePut`, reachable only through `put`. Same conclusion as the row above. |
| `deleteFromMusic` | `blob-store.ts:469`, `:681` | `:469` is inside `nativePut`; `:681` is inside `nativeDel`, *after* its device early-return, which is still the function's first statement. Neither gained a call site. |
| `Filesystem.deleteFile` | `blob-store.ts:280`, `:673` | `:673` is `nativeDel`, after the device refusal (unchanged). `:280` is the NEW one — `deleteTemp`, on an app-private `retag-tmp/` path built from the same sanitiser `nativePath` uses. |

Pinned by tests, not only by reading:

- `nativeDel` on a `device:` uid calls neither `deleteFromMusic` nor `Filesystem.deleteFile`, clears
  the stray URI index entry, **and** never reaches `writeInPlace`.
- `put` on a `device:` uid never reaches `writeInPlace` — a characterisation test recording that the
  1eh hazard is avoided by **routing**, not by a new guard inside `put`. `nativePut` is unchanged.
- `retagOne` on a `device:` uid never calls `blobStore.put`, asserted directly.
- `overwriteDeviceFile` refuses a non-device uid as its **first statement**, so the two write sinks
  are disjoint from both directions.
- `replayPendingDeviceWrites` drops any journal entry whose uid does not yield a content URI, so a
  hand-edited localStorage key cannot aim the write at anything.

**D-6 preserved and re-pinned.** Pins and the automatic lyric embed still refuse imported files:

- `TrackMenu.writeTagsForGesture` keeps `|| isDevice`. Its comment now states this is a **deliberate
  boundary**, not an echo of a `retagOne` guard, so nobody "fixes" it later by symmetry with the
  Edit-metadata row.
- `player.embedLyricsIntoFile` keeps its device refusal. Its existing test's name said "retagOne
  refuses it too — this is the second guard", which is now factually wrong: that refusal was lifted,
  so this is the **only** guard. The test name and comment were corrected rather than left to rot.

## The Android consent question — UNKNOWN until device UAT, highest-value check

**Implemented:** the descriptor open is wrapped in a `SecurityException` catch. On the catch, an
IntentSender is obtained — `MediaStore.createWriteRequest(resolver, listOf(uri))` on API 30+, the
`RecoverableSecurityException`'s own `userAction.actionIntent` on API 29 — the `PluginCall` is saved
via `bridge.saveCall`, and the request is launched through an `ActivityResultLauncher` registered in
`load()`. On `RESULT_OK` the write is retried **exactly once** (an `allowConsent` parameter, not a
mutable flag, so a provider that keeps throwing rejects instead of looping the dialog). Anything else
rejects `denied`. A launcher that failed to register leaves the field null and the path rejects
`denied` — a degraded feature, never a crash.

**What is unknown:** whether ONE grant covers the whole sweep, or Android re-prompts per file.
`createWriteRequest` takes a `List<Uri>`, but this implementation asks for a single URI at the moment
each write fails, because the sweep does not know in advance which files will need consent. If
Android re-prompts per file, **a 40-song sweep is a 40-dialog storm** and needs a follow-up decision
(most likely: pre-collect the imported URIs and issue one batched `createWriteRequest` before the
loop starts). This is the single highest-value device check and everything else on the list below is
secondary to it.

## Everything else that cannot be verified without a physical device

No test in this sandbox proves the write is safe — every Kotlin path is mocked at the TS boundary and
`writeInPlace` never runs. The Kotlin **does compile** (`:app:compileDebugKotlin` BUILD SUCCESSFUL
under JDK 21, offline); that is a compile, not a behaviour.

1. **The consent flow** — see above. Highest value.
2. That `openFileDescriptor(uri, "rwt")` succeeds at all on a modern device for a file the app does
   not own.
3. **No duplicate:** a file manager must show exactly one file, same folder, same name, new size.
4. That the D-8 column update takes effect on a row the app does not own — i.e. the phone's own music
   app shows the new title/artist/album without waiting for a media rescan.
5. That `bridge.registerForActivityResult` in `load()` does not throw on this Capacitor version at
   that lifecycle point. The degraded fallback only runs if it does.
6. That the explicit `channel.truncate(0)` and `fileDescriptor.sync()` behave as intended against a
   real MediaStore provider — in particular that no tail of a longer original survives.
7. **Crash recovery end to end:** kill the app mid-stream on a large FLAC, confirm the file is short,
   then confirm the next Settings → Downloads visit repairs it.
8. That a FLAC over the 40 MB ceiling still declines cleanly on-device and leaves the file untouched.
9. That removing an imported song still never deletes the user's file (the `nativeDel` refusal is
   unit-tested; its native consequence is not).
10. The rung-6 `SIZE`-column precondition against a real provider — including whether `SIZE` is
    reliably populated for every imported row, since a null `SIZE` currently reads as
    `precheck:target changed` and refuses the write. **Safe-by-default, but it would mean some files
    silently cannot be edited** — worth watching during UAT.

APK debugging is available locally via the existing `Pixel_3a_API_34` AVD plus CDP; `pnpm apk` needs
`JAVA_HOME` at Homebrew `openjdk@21`.

## Deviations from Plan

### 1. [Rule 2 — data loss prevention] Replay ordering inverted relative to D-2

- **Found during:** Task 2.
- **Plan said:** call `replayPendingDeviceWrites()` at the top of `overwriteDeviceFile`, "first
  dropping the CURRENT uid's entry and temp: a fresh write supersedes a pending one, so never replay
  what you are about to overwrite."
- **Implemented:** replay runs first and does **not** skip the current uid; the current uid's entry
  is only rewritten once the new temp is verified complete.
- **Why:** the temp file is the *only* complete copy of the bytes for a song that may **already be
  truncated** from an interrupted write. Dropping it up front and then failing at the temp rung
  (disk full, incomplete write) would strand that file truncated forever — the exact outcome the
  ladder exists to prevent. Replaying first costs one extra stream on a rare path and closes the
  hole. This removes D-2's own named "narrow risk".
- **Files:** `src/lib/services/blob-store.ts`. **Commit:** `de47cf1`.

### 2. [Rule 2 — fail safe] An unrecognised reject message is treated as `io:`

- **Found during:** Task 2.
- **Why:** the plan's contract named four prefixes and left anything else undefined. Guessing
  "nothing was written" for an unknown message deletes the recovery source. `rejectCode` falls
  through to `io:`, so unknown failures keep the journal entry and the temp file.
- **Files:** `src/lib/services/blob-store.ts` (`rejectCode`), pinned by a test. **Commit:** `de47cf1`.

### 3. [Rule 3 — blocking] `vi.mock` hoisting in `retag.test.ts`

- **Found during:** Task 3 RED. A shared `const blobStoreMock` fed to two `vi.mock` factories threw
  `Cannot access 'blobStoreMock' before initialization` — `vi.mock` is hoisted above every top-level
  binding. Inlined the object into each factory, with a comment saying why. **Commit:** `8fe3150`.

### 4. [housekeeping] Stray RLM character removed from the Arabic string

- **Found during:** Task 4 self-check. The new `ar` value had a leading U+200F that no other string
  in `ar.ts` carries. Stripped for consistency with the file's existing convention.

### Replaced tests, named as required

- `retag.test.ts`: the two 1eh refusal cases — *"a device: uid is still refused with a filename set"*
  and *"a device: uid is refused BEFORE any blobStore call"* — were **replaced**, not deleted. A
  comment stands where they were explaining that their assertions are now false by design, pointing
  at the `device fork` describe block that replaces them. A third assertion inside the 3j1
  *"nothing is recorded on a non-'tagged' outcome"* test was updated: a device uid now succeeds and
  still records no name (D-7).
- `retag.test.ts`: *"the SHIPPED Settings sweep no longer touches an imported file"* became
  *"the Settings sweep now INCLUDES an imported file"* — same mixed-list arithmetic, opposite
  expectation.
- `player.svelte.test.ts`: the device lyric-embed test's name and comment were corrected — it is now
  the only guard, not the second one.

## Assumption Drift (advisory)

**The sweep's disclosure assumes a `confirm()` the user actually reads.** The plan's D-5 places the
imported-file count in the browser `confirm()`. On Android's WebView a `confirm()` is a small system
dialog with a scrollable body; the existing `retagConfirm` sentence plus the new one is now roughly
two paragraphs. Non-blocking and unchanged from plan — flagged because if UAT shows the second
paragraph is clipped or scrolled out of view, the disclosure the authorisation rests on is not
actually being read, and it would need to move into an in-app sheet.

## Known Stubs

None. Every path added in this task is wired end to end on the TS side; the unverified surface is the
Kotlin behaviour, which is documented above rather than stubbed.

## Threat Flags

None beyond the plan's own register. No new network endpoint, no new auth path, no schema change.
The one new trust boundary (`writeInPlace`) was already modelled as T-ejm-01 … T-ejm-07; all seven
mitigations are implemented:

| Threat | Implemented as |
|---|---|
| T-ejm-01 | `scheme == "content" && authority == "media"` in Kotlin, plus `deviceContentUri`'s `/^\d+$/` id check on the TS side |
| T-ejm-02 | The `SIZE`-column precondition (rung 6) |
| T-ejm-03 | Temp + stat completeness gate + journal + retained temp on `io:` |
| T-ejm-04 | `MediaStore.createWriteRequest` / `RecoverableSecurityException`; no `MANAGE_EXTERNAL_STORAGE` |
| T-ejm-05 | `DISPLAY_NAME` / `RELATIVE_PATH` / `DATA` absent from the one `ContentValues` |
| T-ejm-06 | `allowConsent` parameter — the retry runs exactly once |
| T-ejm-07 | Temp deleted on every terminal path except `io:`, journal bounded at 20 and cleared wholesale on overflow |
| T-ejm-SC | `git diff --stat HEAD -- package.json pnpm-lock.yaml` is **empty** — no dependency added |

## Verification

| Check | Result |
|---|---|
| `pnpm check` | **0 errors, 0 warnings**, 4549 files |
| `pnpm test` | **2788 passed / 135 files**, 0 failures |
| `pnpm vitest --run src/lib/i18n/i18n.test.ts` | 33 passed — key-set parity across all 15 dictionaries |
| Every dictionary reports exactly one `"settings.retagImported"` | YES, 15/15; one added line per file, no reflow, no single quotes introduced |
| `git diff --stat HEAD -- package.json pnpm-lock.yaml` | **empty** |
| Call-site gate delta | exactly the authorised additions, nothing removed |
| `:app:compileDebugKotlin` (JDK 21, `--offline`) | **BUILD SUCCESSFUL** |
| `blobPresent && !isDevice` in TrackMenu | **0 occurrences** |
| Pushed to origin | **NO** — 8 local commits on `main` |

## Self-Check: PASSED

All files listed under `key-files.modified` exist on disk and all 8 commit hashes resolve in
`git log`. The Kotlin compile and both green gates were observed, not inferred — outputs are quoted
above. Kotlin *runtime* behaviour was not observed and is listed as unverified, not as passing.
