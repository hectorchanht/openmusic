---
phase: quick-260919-ejm
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [EJM-01, EJM-02, EJM-03, EJM-04]
files_modified:
  - android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
  - src/lib/services/media-store.ts
  - src/lib/services/blob-store.ts
  - src/lib/services/blob-store.test.ts
  - src/lib/services/retag.ts
  - src/lib/services/retag.test.ts
  - src/lib/i18n/*.ts (15 dictionaries — ONE additive key)
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/MetadataEditor.svelte
  - src/routes/(app)/settings/downloads/+page.svelte

must_haves:
  truths:
    - "Editing an imported song's metadata rewrites THAT file, at its own path, under its own name — no second copy, no `(1)` twin"
    - "The Settings -> Downloads sweep includes imported songs instead of skipping them, and its confirm says so before it runs"
    - "A failed tag encode, a failed temp write, an incomplete temp file or a refused consent all leave the user's song byte-identical"
    - "An interrupted stream-over is recovered from the temp file on the next retag or the next Settings -> Downloads visit"
    - "No imported uid can reach nativePut, saveToMusic or deleteFromMusic — removal still never deletes a user's music"
    - "The automatic lyric embed and the one-tap cover/lyric pins still refuse imported files"
  artifacts:
    - path: "android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt"
      provides: "writeInPlace: precondition check, consent flow, temp-to-fd truncating stream + fsync, best-effort column update"
      contains: "fun writeInPlace"
    - path: "src/lib/services/blob-store.ts"
      provides: "overwriteDeviceFile + the pending-write journal + replayPendingDeviceWrites"
      contains: "overwriteDeviceFile"
    - path: "src/lib/services/retag.ts"
      provides: "the device write fork — same codec pass, same verify-before-write, different write sink"
      contains: "overwriteDeviceFile"
  key_links:
    - from: "src/lib/services/retag.ts"
      to: "blobStore.overwriteDeviceFile"
      via: "the device fork at the write step (NOT blobStore.put)"
      pattern: "overwriteDeviceFile"
    - from: "src/lib/services/blob-store.ts"
      to: "MediaStoreSaver.writeInPlace"
      via: "temp file path + reconstructed content URI"
      pattern: "MediaStoreSaver\\.writeInPlace"
    - from: "src/routes/(app)/settings/downloads/+page.svelte"
      to: "settings.retagImported"
      via: "confirm() disclosure when the sweep includes imported files"
      pattern: "retagImported"
---

<objective>
Imported (`device:`) songs are currently refused by `retagOne` (`retag.ts:114` returns
`'device-skipped'`). The user has explicitly authorised lifting that refusal, on the condition that
the write is a genuine IN-PLACE rewrite of their own file — same file, same path, same MediaStore
row, no copy — with a temp-file-then-stream design so a crash mid-write cannot leave a truncated
song.

Purpose: an imported song gets retagged exactly like an app download, from both entry points the
user named — the per-song metadata editor AND the bulk Settings -> Downloads sweep.

Output: a Kotlin `writeInPlace` bridge method, a device-only `blobStore.overwriteDeviceFile` with a
crash-recovery journal, a device fork in `retagOne`, and the UI/i18n that makes it reachable and
honest.

THE AUTHORISED EXCEPTION, named once so no later audit reads it as a regression: this task adds ONE
new write capability against a user-owned file — `MediaStoreSaver.writeInPlace`, reached only via
`blobStore.overwriteDeviceFile`, reached only via `retagOne`'s device fork. It adds NO new delete,
rename or move capability against a user file. `nativeDel`'s device refusal, `linkPublicUri`'s
device refusal and the "don't import again" lane are all unchanged.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@src/lib/services/retag.ts
@src/lib/services/blob-store.ts
@src/lib/services/device-track.ts
@src/lib/services/media-store.ts
@android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
@src/lib/services/blob-store.test.ts
@src/lib/services/retag.test.ts

<interfaces>
Contracts the executor needs. Read from the codebase — do not go hunting.

From `src/lib/services/device-track.ts` (PURE; the only owner of the `device:` literal):
- `isDeviceUid(uid: string | null | undefined): boolean`
- `deviceContentUri(uid: string): string | null` — yields `content://media/external/audio/media/<id>`, `/^\d+$/` ids only

From `src/lib/services/blob-store.ts` (module-private, all reusable here):
- `const NATIVE_DIR = Directory.Data`
- `const MIN_BLOB_BYTES = 8192`
- `nativePath(uid)` -> `downloads/<sanitized uid>` (sanitiser: `replace(/[^a-zA-Z0-9._-]/g, '_')`)
- `getStoredName` / `setStoredName` / `clearStoredName` — the bounded localStorage-record idiom to copy
- `export const blobStore = { put, get, has, stat, del, linkPublicUri, getStoredName }`

From `src/lib/services/retag.ts`:
- `RetagEntry { uid; title; artist; album; cover; lyrics?; filename? }`
- `RetagItemResult = 'tagged' | 'missing' | 'device-skipped' | 'skipped-size' | 'unknown-container' | 'no-fields' | 'error' | 'verify-failed' | 'put-failed'`
- `retagOne(entry): Promise<RetagItemResult>`

From `src/lib/services/audio-tags.ts`:
- `TAG_MAX_BYTES = 40 * 1024 * 1024` — the size ceiling that MUST keep declining cleanly
- `tagAudioBlob(blob, fields, artDataUrl?)`, `readAudioTags(bytes)`

Capacitor Android (verified in `node_modules/@capacitor/android/.../Bridge.java:1002`, `Plugin.java:208`):
- `bridge.registerForActivityResult(contract, callback)` is public and generic
- `Plugin.getActivity()`, `Plugin.saveCall(PluginCall)`, `bridge.getSavedCall(callbackId)`
- `androidx.activity.result.{ActivityResultLauncher, IntentSenderRequest, contract.ActivityResultContracts}`
  are already on the classpath via `@capacitor/android` — NO new gradle or npm dependency.

Android SDK levels (`android/variables.gradle`): minSdk 24, compile/target 36.
</interfaces>
</context>

<scope_semantics>
Decisions made and recorded here, not asked (per the task brief):

**D-1 — NO backup copy of the original bytes.** Weighed honestly and declined. A backup of a 27 MB
FLAC doubles peak disk for every retag and the sweep would need an eviction policy nobody will
maintain. What temp-then-stream already gives is better and cheaper: at the moment of the risky
write, a COMPLETE, VERIFIED copy of the *new* bytes sits on disk, and the journal (D-2) turns it into
real recovery. A backup would only protect against "the new bytes are wrong", which the existing
verify-before-write step (`readAudioTags` round-trip, RESEARCH Pitfall 10) already catches BEFORE
anything is opened.

**D-2 — a pending-write journal, replayed lazily.** The one window temp-then-stream cannot close is
a death DURING the stream-over. The temp file is the recovery source, so the uid is recorded in a
bounded localStorage record before the bridge call and cleared after success. Replay runs at the top
of the next `overwriteDeviceFile` and on Settings -> Downloads mount. `ponytail:` a truncated file
stays truncated until one of those two happens — no app-boot hook, because a boot-time file write is
exactly the class of automatic write this codebase has spent three tasks keeping out of the app
shell. Upgrade path if device UAT shows it matters: call `replayPendingDeviceWrites()` from the
`(app)` layout's existing mount.

**D-3 — a failed write SPEAKS, with no new strings.** Per-song: the existing `toast.tagsFailed`
("Could not save metadata — the file is unchanged") already fires on any non-`'tagged'` result and
is accurate for a consent denial too. Sweep: `settings.retagDone` reports "Tagged N of M. Skipped K."
— truthful by construction. No new failure toast, no new result bucket. The ONE new string is the
sweep's up-front disclosure (D-5).

**D-4 — imported songs are in the sweep's default scope, not opt-in.** There is no per-row selection
UI to opt into, and the user asked for the bulk sweep by name. The disclosure is the confirm dialog:
it now names how many of the files about to be rewritten are the user's own imported files.

**D-5 — ONE new i18n key**, `settings.retagImported`, appended to the existing confirm when the
count is above zero. The concurrent agent is editing these files; keep it to one key, additive,
placed immediately after `settings.retagConfirm`.

**D-6 — the pins and the automatic lyric embed KEEP refusing imported files.** A user-file rewrite
now happens from exactly TWO explicit gestures: Edit metadata -> Save, and the confirmed sweep. A
one-tap cover pin rewriting a 27 MB user file as a side effect is not what was authorised, and
`player.embedLyricsIntoFile` is the only automatic writer in the app — it must never touch a file
the app does not own. Both guards stay, and Task 6 pins them with tests.

**D-7 — no rename, ever.** `RetagEntry.filename` is IGNORED on the device fork, the sticky-name
index is neither read nor written for a device uid, and Kotlin never touches `DISPLAY_NAME`,
`RELATIVE_PATH` or `DATA`. Renaming a user's file is a separate capability that was not authorised.

**D-8 — the MediaStore columns are updated in the same call.** The phone's music app renders the
TITLE/ARTIST/ALBUM *columns*, not the file's tags. Rewriting only the bytes would be an edit the
user cannot see until the next media scan. Best-effort and AFTER the byte write succeeds — a failed
column update must not fail a write whose bytes already landed.

**Concurrency constraint honoured:** the only settings route touched is `/settings/downloads`. No
other `settings/**` route, no `settings.svelte.ts`. The i18n touch is one additive key.
</scope_semantics>

<failure_ladder>
The mitigation the user was promised, stated as mechanism. Each rung names what is on disk.

| # | Failure | Where it is caught | The user's file |
|---|---------|--------------------|-----------------|
| 1 | Tag encode declines (over 40 MB `skipped-size`, `unknown-container`, `no-fields`, wasm `error`) | `tagAudioBlob` returns non-`'tagged'`; `retagOne` returns it before any write | **Untouched.** The size ceiling still declines cleanly — nothing opens the file. |
| 2 | Encoded bytes do not parse back | existing verify-before-write (`readAudioTags` round-trip) -> `'verify-failed'` | **Untouched.** Unparseable bytes never reach a file descriptor. |
| 3 | New bytes implausibly small (below `MIN_BLOB_BYTES`) | `overwriteDeviceFile` precondition -> `'failed'` | **Untouched.** A junk blob can never truncate a real song. |
| 4 | Temp write fails (disk full, `write_blob` rejects) | caught -> temp deleted -> `'failed'` | **Untouched.** Nothing has opened it. |
| 5 | Temp file INCOMPLETE (`Filesystem.stat().size !== blob.size`) | the completeness gate -> temp deleted -> `'failed'` | **Untouched.** This is the "verify that file is complete" step. |
| 6 | The row no longer matches (MediaStore `_ID` reassigned after a provider rebuild, 34-D-02) | Kotlin precondition: the current `SIZE` column must equal the size JS read -> `reject("precheck:...")` | **Untouched.** Guards against writing over a *different* song. |
| 7 | Android refuses write access / the user denies consent | `SecurityException` -> consent IntentSender -> `RESULT_CANCELED` -> `reject("denied")` -> `'failed'` | **Untouched.** The fd was never opened for write. |
| 8 | Stream-over fails halfway (IO error) | `reject("io:...")` -> `'failed'`, journal entry and temp file **KEPT** | **Possibly truncated**, and recoverable: the complete new bytes are still in the temp file. |
| 9 | Process dies between the temp write and the bridge call | journal entry survives in localStorage | **Fully old.** Replay re-streams; ends fully new. |
| 10 | Process dies MID-STREAM | journal entry + temp file both survive | **Truncated until replay.** Replay (next retag, or next Settings -> Downloads visit) re-streams the complete temp file over it. This is the one window the design cannot make instantaneous: truncate-then-write is not atomic, and MediaStore offers no rename-into-place for a file the app does not own. Named, not hidden. |
| 11 | Byte write succeeded, column update failed | caught inside Kotlin, after the bytes landed | **Fully new bytes**, stale columns until the next media scan. Deliberate (D-8). |

Reject-code contract between Kotlin and TS, because rung 8 must behave differently from rungs 6-7:

- `unsupported:...` / `precheck:...` / `denied` — nothing was written. TS clears the journal entry
  and deletes the temp file.
- `io:...` — the fd was open and bytes may be partial. TS **keeps** the journal entry and the temp
  file so replay can finish the job.
</failure_ladder>

<tasks>

<task type="auto">
  <name>Task 1: Kotlin writeInPlace — consent, precondition, temp-to-fd stream, column update</name>
  <files>android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt, src/lib/services/media-store.ts</files>
  <action>
Add a `writeInPlace` `@PluginMethod` to `MediaStoreSaverPlugin.kt` in the existing house style
(explicit comments carrying decision refs; a `quick-260919-ejm` tag on every non-obvious choice, and
one comment block stating why in-place is safe here plus the failure ladder). Do NOT modify
`saveToMusic`, `deleteFromMusic`, `requestReadAudio` or `scanAudio` — the app-download path must
stay byte-identical.

Params, all strings so no `PluginCall.getLong` API guess is needed: `uri` (the MediaStore content
URI), `sourcePath` (a `file://` temp path), `expectedBytes` (the original file's size as the JS side
read it; blank or absent means "skip the precondition" — that is the replay path), plus optional
`title` / `artist` / `album` for the column update.

Order of operations, each rung rejecting with its ladder-prefixed code:

1. Null/blank checks on `uri` and `sourcePath`. `Uri.parse(uri)` must have `scheme == "content"` and
   `authority == "media"`, else `reject("precheck:not a media uri")` — a bridge method that can
   write to an arbitrary URI is a capability nobody asked for.
2. `if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) reject("unsupported:api")`. The import itself
   is API 29+ only (`requestReadAudio` already says so), so nothing below Q can hold a device uid.
3. Precondition (rung 6): when `expectedBytes` parses to a Long, query the row for
   `MediaStore.Audio.Media.SIZE`; a missing row or a size mismatch rejects `"precheck:target changed"`.
   Comment it with the 34-D-02 `_ID`-reassignment rationale — this is the guard against silently
   rewriting a different song.
4. `openSource(sourcePath)` (the EXISTING helper) for the temp file; a null source rejects
   `"precheck:source missing"`. Read its length first — a zero-length source must reject before any
   descriptor is opened.
5. The write: `contentResolver.openFileDescriptor(uri, "rwt")`. Inside, `FileOutputStream(pfd.fileDescriptor)`,
   call `channel.truncate(0)` as belt-and-braces (a provider that ignores the `t` mode flag would
   otherwise leave a tail of the old file), pump the bytes, `flush()`, then `pfd.fileDescriptor.sync()`
   BEFORE anything closes. Add a NEW `private fun pumpBytes(input: InputStream, output: OutputStream): Long`
   that closes NEITHER stream — the existing `streamCopy` uses `use` on both, and sync-after-close is
   meaningless. Leave `streamCopy` untouched for its existing callers.
6. Consent (rung 7): catch `SecurityException` around the descriptor open. On API 30+ obtain the
   sender from `MediaStore.createWriteRequest(resolver, listOf(uri)).intentSender`; on API 29 use
   `(e as? RecoverableSecurityException)?.userAction?.actionIntent?.intentSender`. Save the call
   (`bridge.saveCall(call)` plus the remembered `call.callbackId`), launch it, return. In the
   launcher callback: `RESULT_OK` retries the write EXACTLY ONCE (a boolean flag on the saved state,
   so a provider that keeps throwing cannot loop a dialog); anything else rejects `"denied"`.
   Register the launcher in `override fun load()` via
   `bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { ... }`,
   wrapped in try/catch: registration must happen before the activity is STARTED, so if it throws,
   leave the launcher null and have the SecurityException path reject `"denied"` rather than crash.
   No consent launcher is a degraded feature, never a broken app.
7. Any other exception during the stream: `reject("io:" + message)`.
8. On success, best-effort column update (D-8): a `ContentValues` with TITLE / ARTIST / ALBUM (only
   for non-blank params) plus `SIZE` set to the byte count just written, then
   `resolver.update(uri, values, null, null)`, the whole thing in its own try/catch that swallows.
   **Never** put `DISPLAY_NAME`, `RELATIVE_PATH` or `DATA` (D-7 — no rename, no move). Then
   `call.resolve()`.

Then declare the method on the TS side in `src/lib/services/media-store.ts`'s `MediaStoreSaverPlugin`
interface, with a doc comment stating the reject-code contract from the failure ladder precisely
enough that a caller can route on it. That contract is load-bearing, not prose.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -3</automated>
    <automated>JAVA_HOME=$(brew --prefix openjdk@21 2>/dev/null) ./android/gradlew -p android :app:compileDebugKotlin --offline 2>&1 | tail -20</automated>
  </verify>
  <done>`pnpm check` reports 0 errors. The Kotlin compiles — OR, if gradle cannot run in this
environment (no JDK 21, no dependency cache, no network), the SUMMARY states plainly that the Kotlin
was NOT compiled and lists it under "not verified without a device". Never claim a compile that did
not happen.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: overwriteDeviceFile + the crash-recovery journal in blob-store.ts</name>
  <files>src/lib/services/blob-store.ts, src/lib/services/blob-store.test.ts</files>
  <behavior>
    - a NON-device uid returns `'failed'` without touching the bridge (the inverse of `linkPublicUri`'s guard)
    - `isNativePlatform() === false` returns `'unsupported'` — there is no MediaStore on web
    - a blob smaller than `MIN_BLOB_BYTES` returns `'failed'`: no temp write, no bridge call
    - `write_blob` rejecting returns `'failed'` and attempts the temp cleanup
    - `Filesystem.stat().size !== blob.size` returns `'failed'`, deletes the temp, never calls the bridge
    - the happy path calls `MediaStoreSaver.writeInPlace` with the uid's RECONSTRUCTED content URI
      (`content://media/external/audio/media/<id>`), the temp `sourcePath`, and `expectedBytes` as a
      string; then clears the journal entry, deletes the temp, and returns `'ok'`
    - a reject whose message starts `unsupported:` returns `'unsupported'`; `precheck:` and `denied`
      return `'failed'` — and ALL THREE clear the journal entry and delete the temp
    - a reject whose message starts `io:` returns `'failed'` and KEEPS both the journal entry and the temp file
    - `replayPendingDeviceWrites()` drives the bridge for a recorded uid with NO `expectedBytes`, and
      clears the entry on success
    - the journal is bounded (a cap, cleared wholesale on overflow — the `prewarm.ts` idiom) and every
      localStorage access is try/catch'd, like every other index in this module
  </behavior>
  <action>
Add to `blob-store.ts`, between `nativePut` and `nativeDel` so the ordering reads save /
write-in-place / delete:

`export type DeviceWriteResult = 'ok' | 'unsupported' | 'failed';`

`export async function overwriteDeviceFile(uid, blob, meta?): Promise<DeviceWriteResult>` where
`meta` is `{ title?, artist?, album?, expectedBytes?: number }`.

Implementation follows failure-ladder rungs 3-10 exactly:

- The device-only guard is the FIRST statement (`if (!isDeviceUid(uid)) return 'failed'`), with a
  comment mirroring `nativeDel`'s first-statement discipline: this is the ONE authorised user-file
  write and it must be impossible for an app-download uid to arrive here.
- `Capacitor.isNativePlatform()` false -> `'unsupported'`; `deviceContentUri(uid)` null -> `'unsupported'`.
- Temp path `retag-tmp/<sanitized uid>` in `NATIVE_DIR`, reusing the same
  `replace(/[^a-zA-Z0-9._-]/g, '_')` sanitiser `nativePath` uses. App-private, never a user path.
- `write_blob` the tagged blob to the temp path (streams, no base64 — the same WR-02 reasoning
  `nativePut` documents), then `Filesystem.stat` for the completeness gate.
- Journal: `openmusic:retag-pending:v1`, a `Record<uid, { bytes: number }>`, written BEFORE the
  bridge call and cleared after success. Bound at ~20 entries, cleared wholesale on overflow.
- `Filesystem.getUri` on the temp -> `MediaStoreSaver.writeInPlace({ ... })`.
- Route the reject message per the contract; run the cleanup ONLY on the non-`io:` paths.

Also export `replayPendingDeviceWrites(): Promise<void>`: for each recorded uid whose temp file still
stats to the recorded size, call the bridge WITHOUT `expectedBytes` (the original's size no longer
matches by definition after a partial write — see D-2's named narrow risk), then clear. Never throws.
Call it at the top of `overwriteDeviceFile`, first dropping the CURRENT uid's entry and temp: a fresh
write supersedes a pending one, so never replay what you are about to overwrite.

The temp-file `Filesystem.deleteFile` calls are a NEW delete call site. They target
`Directory.Data/retag-tmp/*` — files this app wrote milliseconds earlier — never a user file.
Comment them as such with the `quick-260919-ejm` tag so Task 6's gate can account for them.

Add `overwriteDeviceFile` (and only that) to the `blobStore` namespace export.
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/services/blob-store.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>All new cases pass, the existing suite still passes, and the namespace-shape test is updated
for the new export. The RED commit precedes the GREEN commit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: lift the device-skipped guard — retagOne forks at the write step only</name>
  <files>src/lib/services/retag.ts, src/lib/services/retag.test.ts</files>
  <behavior>
    - a `device:` uid now runs the codec: `blobStore.get`, `tagAudioBlob` and the `readAudioTags`
      verify all happen, exactly as for an app download
    - a `device:` uid NEVER calls `blobStore.put` — asserted directly; this is the 1eh bug's inverse
    - a `device:` uid calls `overwriteDeviceFile` with the tagged blob and the ORIGINAL blob's size
      as `expectedBytes`
    - `overwriteDeviceFile` returning `'ok'` yields `'tagged'` AND evicts the `local-tags` memo
      (`forgetLocalEnrichment`)
    - `'unsupported'` yields `'device-skipped'` (the bucket stays meaningful on web and API below 29);
      `'failed'` yields `'put-failed'`
    - `entry.filename` is IGNORED for a device uid: `getStoredName` / `setStoredName` are never called
      and no filename is threaded anywhere (D-7)
    - the size ceiling still declines FIRST: a `'skipped-size'` codec outcome returns before
      `overwriteDeviceFile` is reached, so a 50 MB FLAC is never opened for write
    - verify-before-write still gates the device path: unparseable tagged bytes give `'verify-failed'`
      with no `overwriteDeviceFile` call
    - an APP-DOWNLOAD uid's path is byte-identical: `blobStore.put` with the same derived/sticky name,
      `overwriteDeviceFile` never called
    - `retagDownloads` over a MIXED list still adds up (`tagged` plus the skipped buckets equals
      `total`), and the imported entry now lands in `tagged`
  </behavior>
  <action>
Replace the `if (isDeviceUid(entry.uid)) return 'device-skipped';` early return at `retag.ts:114`.
Do NOT delete the comment block above it — REWRITE it. It is the decision record for why the guard
existed, and the new text must say three things: the hazard it named (`nativePut` has no device
short-circuit) is still real and is still avoided, because the device path does not go through `put`
at all; the user explicitly authorised the in-place write; and the fork sits at the WRITE STEP so the
codec pass and the verify-before-write step are shared, not duplicated. Tag `quick-260919-ejm`.

Structure — one body, one fork:

- `const device = isDeviceUid(entry.uid);`
- unchanged: `get` / `resolveArtworkDataUrl` / `tagAudioBlob` / `readAudioTags` verify
- if `device`: call `blobStore.overwriteDeviceFile(entry.uid, out.blob, { title, artist, album: albumTag(entry.album, entry.title), expectedBytes: blob.size })`;
  `'unsupported'` returns `'device-skipped'`, anything other than `'ok'` returns `'put-failed'`
- else: unchanged sticky-name resolution, `buildDownloadFilename`, `blobStore.put`, `setStoredName`
- then, BELOW the fork: `forgetLocalEnrichment(entry.uid)` and `return 'tagged'`

`expectedBytes: blob.size` is the ORIGINAL blob read at the top — the precondition the Kotlin side
checks against the row's current SIZE column. `forgetLocalEnrichment` must be reachable from BOTH
branches (the brief calls this out: without it the app serves pre-edit tags for the rest of the
session), so lift it below the fork rather than duplicating it.

Update the `RetagItemResult` doc comment: `'device-skipped'` no longer means "refused on principle",
it means "this platform cannot write in place" (web, or API below 29).
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/services/retag.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>All new cases pass. The two 1eh refusal tests are REPLACED (not silently deleted) by their
new-contract equivalents, and the SUMMARY names that replacement. The RED commit precedes the GREEN
commit.</done>
</task>

<task type="auto">
  <name>Task 4: one additive i18n key across all 15 dictionaries</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts</files>
  <action>
Add EXACTLY ONE key, `settings.retagImported`, immediately after `settings.retagConfirm` in every
dictionary. DOUBLE QUOTES for key and value (the manual, formatter-less convention — nothing enforces
it but `i18n.test.ts` enforces key-set parity). `en` is the reference:

`"settings.retagImported": "{count} of these are songs imported from this phone. Their files will be rewritten where they are — same file, same name, no copy."`

Translate for the other 14. A concurrent agent is editing these same files: add the single line and
nothing else, do not reflow, reorder or reformat neighbouring entries, and re-read each file
immediately before editing it.
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/i18n/i18n.test.ts 2>&1 | tail -3</automated>
    <automated>for f in src/lib/i18n/*.ts; do printf '%s %s\n' "$f" "$(grep -c '"settings.retagImported"' "$f")"; done</automated>
  </verify>
  <done>Key-set parity passes and every one of the 15 dictionaries reports exactly 1. No
single-quoted key or value was introduced.</done>
</task>

<task type="auto">
  <name>Task 5: make it reachable — editor row, no rename field, sweep disclosure, replay on mount</name>
  <files>src/lib/components/TrackMenu.svelte, src/lib/components/MetadataEditor.svelte, src/routes/(app)/settings/downloads/+page.svelte</files>
  <action>
**TrackMenu.svelte (~line 905):** change the Edit-metadata row gate from `blobPresent && !isDevice`
to `blobPresent` alone. Rewrite the comment above it: the `!isDevice` half was the UI mirror of a
service refusal that no longer exists, and the service now routes an imported uid to the authorised
in-place write. Leave the "don't import again" row and every other `isDevice` gate in this file
exactly as they are.

**Do NOT touch `writeTagsForGesture`** (~line 313) — its `|| isDevice` stays (D-6). Add one line to
its existing comment explaining that the refusal is now a deliberate boundary rather than an echo of
`retagOne`, so nobody "fixes" it later by symmetry.

**MetadataEditor.svelte:** the File name field (currently `{#if native}`, ~line 188) must also
exclude device tracks (D-7 — the in-place write cannot rename, and a field that silently does
nothing is worse than no field). Derive `isDevice` from the existing track prop via `isDeviceUid`
imported from `$lib/services/device-track`, and gate on `native && !isDevice`. Update the
"WHY THERE IS NO isDevice GUARD HERE" comment block at ~line 70 — it is now factually wrong about
the sheet not opening for imported songs. State instead that the sheet DOES open for them, writes in
place, and only the rename affordance is withheld.

**settings/downloads/+page.svelte:**
- import `isDeviceUid` and `replayPendingDeviceWrites`
- in `onMount`, before the eligible loop: `void replayPendingDeviceWrites();` with a comment naming
  it as the D-2 recovery point. Fire-and-forget — a page mount must never await a file write.
- add `const importedCount = $derived(eligible.filter((e) => isDeviceUid(e.uid)).length);`
- in `retag()`, when `importedCount > 0`, append the disclosure to the confirm string:
  `t('settings.retagConfirm', { count: eligible.length })` plus a blank line plus
  `t('settings.retagImported', { count: importedCount })`. Comment it: this is the authorised-risk
  disclosure — the sweep rewrites the user's own files in place and they see the count before they
  agree.
- the eligible loop itself needs NO change: device rows already pass `blobStore.has` (that was
  precisely the 1eh finding), so they were always in the list and were always skipped. Add a one-line
  comment so the absence of a change here is not read as an oversight.

No other `settings/**` route is touched.
  </action>
  <verify>
    <automated>pnpm check 2>&1 | tail -3</automated>
    <automated>grep -c 'replayPendingDeviceWrites\|retagImported' "src/routes/(app)/settings/downloads/+page.svelte"</automated>
  </verify>
  <done>`pnpm check` is 0 errors. `blobPresent && !isDevice` no longer appears in TrackMenu, the File
name field is gated on `native && !isDevice`, and the downloads page references both new symbols.</done>
</task>

<task type="auto">
  <name>Task 6: the discipline gate — prove what did NOT change</name>
  <files>src/lib/services/retag.test.ts, src/lib/stores/player.svelte.test.ts, src/lib/services/blob-store.test.ts</files>
  <action>
This task produces the audit artifact. `quick-260919-30x` established a no-new-delete/move call-site
discipline; this plan deliberately adds ONE write. Make the exception legible and keep the gate
meaningful for everything else.

1. Regression tests pinning D-6 and the preserved refusals:
   - `nativeDel` still refuses a device uid: `Filesystem.deleteFile` and `MediaStoreSaver.deleteFromMusic`
     are never called, and the stray URI index entry is cleared (extend the existing `del` describe
     block if a case does not already assert exactly this).
   - `blobStore.put` still has NO device path: `put` with a `device:` uid must not reach
     `MediaStoreSaver.writeInPlace` either. `nativePut` is unchanged, so this is a characterisation
     test recording that the 1eh hazard is avoided by ROUTING, not by a new guard inside `put`.
   - `player.embedLyricsIntoFile` still refuses a device uid (the only automatic writer in the app).
     If the player suite has no reachable seam for it, assert the equivalent at the `syncFileTags`
     boundary and say so in the test name rather than inventing one.

2. Run the corrected 30x gate and diff it against the pre-task baseline commit, the way that task's
   SUMMARY does (the raw filter there is self-invalidating because `grep -rn` prefixes every line
   with `file:line:`):

   `grep -rn 'blobStore.del\|deleteFromMusic\|Filesystem.deleteFile\|saveToMusic\|writeInPlace\|MediaStoreSaver' src | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)'`

   Diff the result against the same command at the baseline commit. The expected delta is EXACTLY:
   the `writeInPlace` interface declaration in `media-store.ts`, its one call site in `blob-store.ts`,
   and the temp-file `Filesystem.deleteFile` calls in `overwriteDeviceFile`. Anything else in the
   delta is a bug — stop and investigate rather than explaining it away.

3. Paste both the delta and the baseline command into the SUMMARY under a heading that names the
   authorised exception, so the next audit reads it as a recorded decision and not a regression.
  </action>
  <verify>
    <automated>pnpm test 2>&1 | tail -6</automated>
    <automated>git diff --stat HEAD -- package.json pnpm-lock.yaml</automated>
  </verify>
  <done>The full suite is green, the dependency diff is empty (no new npm dependency), and the gate
delta contains only the three authorised additions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| JS -> Kotlin bridge (`writeInPlace`) | A WebView-supplied `uri` reaches `openFileDescriptor(..., "rwt")` — a destructive write |
| JS -> Kotlin bridge (`writeInPlace` columns) | WebView-supplied strings reach a `ContentValues` update on a user-owned MediaStore row |
| uid -> content URI reconstruction | A uid in library state becomes the path of a real file on the user's phone |
| App -> the user's own audio file | The first write capability this app has ever had against a file it does not own |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ejm-01 | Tampering | `writeInPlace` uri param | mitigate | Scheme must be `content` and authority `media`; the only caller passes `deviceContentUri(uid)`, which already rejects any id that is not `/^\d+$/` — no path fragment can be smuggled through a uid |
| T-ejm-02 | Tampering | wrong-file overwrite after an `_ID` reassignment (34-D-02) | mitigate | Kotlin precondition: the row's current `SIZE` column must equal the size the JS side read from the same uid moments earlier (ladder rung 6) |
| T-ejm-03 | Denial of Service / data loss | truncate-then-write is not atomic | mitigate | Temp file written and stat-verified complete BEFORE the descriptor opens; a journal entry plus the retained temp file make an interrupted write replayable (ladder rungs 8-10). Residual window named, not hidden |
| T-ejm-04 | Elevation of Privilege | writing a file the app does not own | transfer | Android's own consent flow (`MediaStore.createWriteRequest` / `RecoverableSecurityException`). A denial is a clean `'failed'`; the app never seeks `MANAGE_EXTERNAL_STORAGE` |
| T-ejm-05 | Tampering | column update reaching `DISPLAY_NAME` / `RELATIVE_PATH` / `DATA` | mitigate | Those three keys are never put into the `ContentValues` (D-7). No rename, no move — enforced in the one place the columns are written |
| T-ejm-06 | Denial of Service | a consent dialog loop on a provider that keeps throwing | mitigate | The post-consent retry runs EXACTLY ONCE, flagged on the saved call state |
| T-ejm-07 | Information disclosure | the temp file (a full copy of a user song) lingering in app-private storage | mitigate | Deleted on every terminal path except the `io:` rung, where it is the recovery source; the journal is bounded and replay deletes on success |
| T-ejm-SC | Tampering | npm/pip/cargo installs | mitigate | NONE — this plan adds no dependency. `git diff --stat package.json pnpm-lock.yaml` must stay empty (Task 6 gate) |
</threat_model>

<verification>
Automated, all must pass before the SUMMARY is written:

- `pnpm check` — 0 errors, 0 warnings
- `pnpm test` — full suite green, count at or above the pre-task baseline
- `pnpm vitest --run src/lib/i18n/i18n.test.ts` — key-set parity across all 15 dictionaries
- `git diff --stat HEAD -- package.json pnpm-lock.yaml` — empty
- the Task 6 call-site gate delta contains only the three authorised additions
- best-effort: `:app:compileDebugKotlin` under JDK 21

## Cannot be verified without a physical device — state this plainly in the SUMMARY

The entire point of this task is a write to a real user file, and **no test in this sandbox proves
that write is safe**. Every Kotlin path is mocked at the TS boundary; `writeInPlace` never runs.
Specifically unproven here:

1. That `openFileDescriptor(uri, "rwt")` succeeds at all on a modern device for a file the app does
   not own — including whether the consent dialog appears, what it says, and whether the grant
   persists for the sweep's subsequent files or is re-prompted per file. **If it is re-prompted per
   file, the bulk sweep is a dialog storm and needs a follow-up decision.** This is the single
   highest-value UAT item.
2. That the file is rewritten in place with NO duplicate: a file manager must show exactly one file,
   same folder, same name, new size.
3. That the phone's own music app shows the new title/artist/album — i.e. that the D-8 column update
   actually took effect on a row the app does not own.
4. That `bridge.registerForActivityResult` in `load()` does not throw on this Capacitor version at
   that lifecycle point (the degraded fallback is exercised only if it does).
5. Crash recovery: killing the app mid-stream and confirming the next Settings -> Downloads visit
   repairs the file. Realistically only reproducible on a large FLAC.
6. That a FLAC over the 40 MB ceiling still declines cleanly on-device and leaves the file untouched.
7. That removing an imported song still never deletes the user's file (the `nativeDel` refusal is
   unit-tested; its native consequence is not).

APK debugging is available locally via the existing `Pixel_3a_API_34` AVD plus CDP if the executor
wants to go further than unit tests; `pnpm apk` needs `JAVA_HOME` pointed at Homebrew `openjdk@21`.
</verification>

<success_criteria>
- `retag.ts` no longer contains an unconditional `device-skipped` early return; a device uid reaches
  `overwriteDeviceFile` and never `blobStore.put`
- `MediaStoreSaver.writeInPlace` exists on both sides of the bridge with the reject-code contract
  documented
- The temp-then-stream sequence, the completeness gate, the journal and the replay all exist and are
  covered by node tests
- The sweep includes imported songs and discloses the count before running
- Edit metadata opens for an imported song; the File name field does not appear for one
- `nativeDel`'s device refusal, the pin gate and the automatic lyric-embed gate are unchanged, and
  tests pin all three
- No new npm dependency; nothing pushed to origin
</success_criteria>

<output>
Create `.planning/quick/260919-ejm-in-place-tag-rewrite-for-imported-device/260919-ejm-SUMMARY.md` when done.
</output>
