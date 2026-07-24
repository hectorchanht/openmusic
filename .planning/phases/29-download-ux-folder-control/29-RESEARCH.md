# Phase 29: Download UX & Folder Control - Research

**Researched:** 2026-07-23
**Domain:** Android MediaStore / scoped storage (Capacitor 8 native bridge) + Svelte 5 runes download UX + i18n
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Platform targeting**
- **D-01:** Native app owns folder placement + migration. Web PWA still receives filename control, the bug fix, and per-song loading state (degraded: saves into the browser Downloads root, no folder choice).
- **D-02:** No location prompt on any platform. On web desktop this means **stop using `showSaveFilePicker`** (it prompts every time) — go straight to the anchor auto-save into Downloads. On native the folder is fixed to `Download/openmusic/`.

**Native download folder (#1)**
- **D-03:** Public download target moves from `Music/OpenMusic/` → `Download/openmusic/`. Change `MediaStoreSaverPlugin.kt`: API 29+ `relativePath = "${Environment.DIRECTORY_DOWNLOADS}/openmusic/"` (line 51); Legacy API ≤28 `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)` + `File(dir, "openmusic")` (lines 178–179).
- **D-04:** The **app-private** offline copy (`Directory.Data/downloads/<sanitized-uid>`, the `get()` read source in `blob-store.ts`) stays uid-keyed and stays where it is. Only the **public** MediaStore copy gets the new folder + the human filename.

**Controlled filename (#2)**
- **D-05:** Filename format `{artist} - {song}.{ext}`, sourced through display-name translation: `names.dnArtist(track.artist)` / `names.dnTitle(track.title)` instead of raw. Same sanitize (`.replace(/[/\\?%*:|"<>]/g, '_')`).
- **D-06:** Extension from resolved audio (`audioUrl` regex → `mp3|flac|m4a|aac|ogg|wav`, default `mp3`). The **public native filename** (`nativeFileName`) changes from `<uid>.mp3` to the same `{artist} - {song}.{ext}` — the Kotlin bridge already takes `fileName`.
- **D-07:** Translation fallback: if `names.dn*` returns the original, use the raw name — never block on a translation. (Planner: consider awaiting `ensureTranslated` when the user's name-lang differs — flagged, not required.)
- **D-08 (Claude's discretion):** Extract the filename builder into ONE shared pure helper (e.g. `download-filename.ts`) and call it from all three save sites (TrackMenu, album, native `blob-store`).

**Media-page bug (#3)**
- **D-09:** Remove `window.open(r.audioUrl, '_blank')` from the `catch` in `TrackMenu.doDownload` (line 230) and the equivalent in `album.downloadAlbum`. On save failure: show a toast (song stays in Library Downloads, re-streams on tap) — never navigate to the stream. Reuse/adjust `toast.openedAudio` or add `toast.downloadFailedKeptInLibrary`.

**Per-song loading + "Downloaded" state (#4)**
- **D-10:** Add a reactive per-uid set to the **library store**: `downloading = $state(new Set<string>())` with `beginDownload(uid)` / `endDownload(uid)` (reassign `new Set(...)`). Single source of truth every surface reads.
- **D-11:** Rollout = **every track row that renders a download affordance**: `CompactRow.svelte` (home + search), library page rows (all tabs), album page rows, TrackMenu Download row. A small shared stateful control/snippet renders idle (Download icon) → `downloading.has(uid)` (spinner) → `library.isDownloaded(uid)` (greyed, "Downloaded").
- **D-12:** The `TrackMenu` Download row must no longer `onclose()` immediately then run blind — per-uid state gives feedback whether or not the menu is open. `toast.preparingDownload` may stay.
- **D-13:** Add i18n key `menu.downloaded` / shared "Downloaded" label (all locales, double quotes). `en` defines `TranslationKey`.

**Migration button (#5, native)**
- **D-14:** New button in **Settings → Data**. Native-only (`Capacitor.isNativePlatform()` guard).
- **D-15:** Behavior = **move existing + switch**: relocate every already-downloaded public file from `Music/OpenMusic/` → `Download/openmusic/`, rewrite each `openmusic-blob-uri:<uid>` entry to the new content URI, future downloads already write to the new folder. Needs a NEW Kotlin method (e.g. `relocateToDownloads`), mirroring never-throws (per-uid graceful failure).
- **D-16:** Progress + result via toast/inline count ("Moved N of M"). One-shot, idempotent (already-moved skipped). App-private copies untouched (D-04).

**Never-throw / isolation contracts (MUST hold)**
- **D-17:** All new native filesystem/MediaStore paths keep the **never-throws** posture (resolve `false`/`null`/`void`, never reject).
- **D-18:** The **DOWNLOAD ISOLATION CONTRACT** stays intact — download work must not touch `player.current`, `playGen`, the shared `<audio>`, or lyrics. Per-song state lives in the library store, not the player.

### Claude's Discretion
- **D-08:** shape of the shared filename helper.
- **D-07 nuance:** whether to await `ensureTranslated` for a guaranteed zh-Hant filename (see Filename section — recommendation: NOT needed for the primary case).

### Deferred Ideas (OUT OF SCOPE)
- Reliable zh-Hant filenames via awaited translation (follow-up).
- iOS native download folder (Android-only this phase).
- Byte-level download progress bars (spinner → Downloaded only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DL-FILE-01 | Controlled, translated filename `{artist} - {song}.{ext}` | Filename section — `names.dn*` is SYNCHRONOUS (cached-or-raw); zh-Hant covered by offline s2t sync path; shared pure `download-filename.ts` helper; thread filename into `blobStore.put` (only 1 caller) |
| DL-BUG-01 | Failed save must never open the audio stream in a new tab | Bug-fix section — remove `window.open` at TrackMenu L230 + album L399; anchor `a.download` on a `blob:` URL is same-origin and saves without navigation |
| DL-STATE-01 | Per-song spinner + greyed "Downloaded" on every row | State section — `library.downloading` reactive `Set<uid>` (same idiom as `inFlight`); shared control; NOTE no inline per-row download button exists today (new affordance) |
| DL-FOLDER-01 | Native downloads land in `Download/openmusic/` | **Primary finding** — `Download/` is NOT allowed for `MediaStore.Audio`; MUST switch the collection to `MediaStore.Downloads`, not just the path string |
| DL-MIGRATE-01 | Settings button moves existing files + remaps index | **Primary finding** — cross-collection (Audio→Downloads) move is NOT possible via in-place RELATIVE_PATH update; MUST copy-to-Downloads + delete-old, per-uid, idempotent |
| DL-RESILIENCE-01 | Never-throw; partial migration never crashes | Never-throw section — per-uid try/catch → sentinel; orphaned-entry (uninstall/reinstall) edge case skipped gracefully |
</phase_requirements>

## Summary

This phase is **90% brownfield wiring + one genuinely-new Android capability**. Four of the six requirements (filename, bug-fix, per-song state, resilience) are refactors of code that already exists and is already node-testable; the shapes (`{artist} - {title}.${ext}`, the `inFlight` Set idiom, the never-throws blob-store) are all present and just need consolidating and re-pointing. The one hard requirement is the Android folder change + migration, and research surfaced a **critical, non-obvious constraint** that reframes both.

**The critical finding:** `Download/` is **not an allowed top-level directory for the `MediaStore.Audio` collection** (allowed: `Alarms/`, `Audiobooks/`, `Music/`, `Notifications/`, `Podcasts/`, `Ringtones/`, `Recordings/`). D-03 as literally written — "change `relativePath` to `Download/openmusic/`" while still inserting into `MediaStore.Audio.Media` — will throw `IllegalArgumentException: Primary directory Download not allowed…` at runtime. The correct implementation inserts into the **`MediaStore.Downloads`** collection (`MediaStore.Downloads.getContentUri(VOLUME_EXTERNAL_PRIMARY)`), which is the only collection that allows the `Download/` primary directory. This is a collection change, not a string change. `[VERIFIED: developer.android.com/training/data-storage/shared/media]`

**The second critical finding (migration):** you cannot move an existing `Music/OpenMusic/` audio row into `Download/openmusic/` by updating its `RELATIVE_PATH` in place. In-place `RELATIVE_PATH` update works only *within a collection's allowed directories*; moving an Audio-collection row to `Download/` fails the same allowed-directory validation. The migration MUST therefore **copy the file into the Downloads collection (re-inserting from the untouched app-private copy) and delete the old Audio-collection entry**, then rewrite the `openmusic-blob-uri:<uid>` index. This is the CONTEXT's flagged fallback — and here it is the *only* option, not a choice. Because OpenMusic owns every entry it created, no `RecoverableSecurityException` / user-consent dialog is needed (its own files). `[VERIFIED: developer.android.com/training/data-storage/shared/media]`

**Primary recommendation:** Treat DL-FOLDER-01 as "switch `saveToMusic` from `MediaStore.Audio.Media` to `MediaStore.Downloads`," and DL-MIGRATE-01 as "TS-orchestrated copy-into-Downloads + delete-old-Audio per uid, reusing the existing app-private copy as the byte source, idempotent by URI inspection, never-throw per uid." Everything else is consolidation of existing patterns.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Translated filename build | Pure service (`download-filename.ts`) | Component (passes `names.dn*` result) | Format+sanitize is pure/node-testable; translation is a store read the caller supplies |
| Per-song download state | Store (`library.svelte.ts`) | Components (read `downloading`/`isDownloaded`) | Single reactive source of truth; matches store-driven runes architecture; keeps state OUT of player (D-18) |
| Web file save (bug-fix) | Component (`TrackMenu`, album page) | — | DOM `<a download>` + `blob:` URL is a browser-tier concern |
| Public folder placement | Native (Kotlin `MediaStoreSaverPlugin`) | TS wrapper (`media-store.ts`) → blob-store | Only native can write the public MediaStore; TS bridges via Capacitor plugin |
| File relocation / migration | Native (Kotlin) + TS orchestration | Store/Settings page (triggers, surfaces progress) | MediaStore ops are native; iteration/idempotency/index-rewrite live in TS never-throw services |
| i18n labels | UI (`t()` + locale dicts) | — | Stores emit keys, UI localizes (existing boundary) |

## Standard Stack

No new packages. This phase uses only what the repo already ships.

### Core (already installed — verified in `package.json` / `blob-store.ts` / plugin)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor/core` | 8.4.0 | `registerPlugin`, `isNativePlatform`, `convertFileSrc` | Native bridge; already used by `media-store.ts` `[VERIFIED: package.json]` |
| `@capacitor/filesystem` | (installed) | `Filesystem.getUri` (app-private source path) | Already used by `blob-store.ts` `[VERIFIED: package.json]` |
| `capacitor-blob-writer` | (installed) | streams Blob → disk, no base64 | Already the app-private write path `[VERIFIED: package.json]` |
| `@lucide/svelte` | (installed) | `Download`, `Check`, spinner glyphs | Per-icon imports already in TrackMenu/library `[VERIFIED: package.json]` |
| Android `MediaStore` / `ContentResolver` | API 29+ (target/compile **36**, min **24**) | public folder writes | Platform API; no dependency `[VERIFIED: android/variables.gradle]` |

**Android build config (verified):** `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36` (`android/variables.gradle`). targetSdk 36 (Android 16) = **full scoped-storage enforcement** — the allowed-directory rule below is strictly enforced; there is no `requestLegacyExternalStorage` escape hatch on API 29+.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Copy-into-Downloads + delete-old (migration) | In-place `RELATIVE_PATH` update | **Not viable** — cross-collection Audio→Downloads is rejected by allowed-directory validation. Only intra-collection moves work in place. |
| TS-orchestrated relocate (reuse `saveToDownloads` + `deleteFromMusic`) | One atomic Kotlin `relocateToDownloads(oldUri, fileName, sourcePath)` | Kotlin-atomic avoids a half-migrated window, but that window is harmless (both copies readable, idempotent). TS orchestration reuses two already-tested never-throw primitives with less new native surface. **Recommend TS orchestration.** |
| App-private copy as migration byte-source | Read old public URI via `ContentResolver.openInputStream` | App-private copy (D-04) is always present, uid-keyed, and already the get() source — simplest + most robust. Reading the old public URI adds a failure mode. **Recommend app-private source.** |

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All dependencies (`@capacitor/*`, `capacitor-blob-writer`, `@lucide/svelte`) are already present in `package.json` and in active use. No `npm install` / `pip install` / `cargo add` step. slopcheck gate skipped (nothing to check).

## Architecture Patterns

### System Architecture Diagram (download + migration data flow)

```text
                    ┌─────────────────────────────────────────────────────┐
   user taps        │  Download control (shared snippet/component)         │
   Download  ──────▶│  reads: library.downloading.has(uid)                 │
   (row / menu)     │         library.isDownloaded(uid)                    │
                    └───────────────┬─────────────────────────────────────┘
                                    │ onclick
                                    ▼
              library.beginDownload(uid)   ── reactive Set reassign ──▶ every surface repaints (spinner)
                                    │
                                    ▼
        TrackMenu.doDownload(resolved)  [DOWNLOAD ISOLATION — no player.* touch]
                                    │
              ┌─────────────────────┼──────────────────────────────┐
              ▼                     ▼                              ▼
   ensureTrackDetails         fetch(audioUrl)              buildDownloadFilename(
   (@ downloadQuality)         → Blob                        names.dnArtist(artist),
   (or reuse current)                                        names.dnTitle(title), ext)  ← PURE
                                    │                              │  {artist} - {song}.{ext} + sanitize
                                    ▼                              │
                          blobStore.put(uid, blob, filename) ◀─────┘  (NEW 3rd arg)
                                    │
              ┌─────────────────────┴───────────────┐
      web branch                              native branch (Capacitor.isNativePlatform())
      (IndexedDB)                                    │
              │                        ┌─────────────┴──────────────┐
              │                        ▼                            ▼
     UI: <a download=filename>   write_blob → Directory.Data   MediaStoreSaver.saveToMusic(
     href=blob: → a.click()      /downloads/<uid> (D-04,       {fileName: filename, sourcePath})
     (NO window.open on fail;    app-private, UNTOUCHED)              │  Kotlin:
      toast instead — DL-BUG-01)  = get() read source            insert into ★MediaStore.Downloads★
              │                                                   RELATIVE_PATH=Download/openmusic/
              ▼                                                   IS_PENDING 1→0 → content URI
      library.endDownload(uid) ── finally ──▶ isDownloaded=true, spinner→greyed "Downloaded"
                                                                        │
                                                          setStoredUri(uid, contentUri)  (localStorage index)

  ── MIGRATION (Settings → Data, native only) ─────────────────────────────────────────────
   for each uid with a stored Music/OpenMusic/ URI (skip if URI already Download/ — idempotent):
     try {
        sourcePath = Filesystem.getUri(Directory.Data/downloads/<uid>)   ← app-private copy
        newUri = saveToDownloads(fileName=human, sourcePath)             ← copy into Downloads collection
        deleteFromMusic(oldAudioUri)                                     ← delete old Audio entry
        setStoredUri(uid, newUri)                                        ← remap index
     } catch { skip this uid — never throw (DL-RESILIENCE-01) }
     progress: "Moved N of M"
```

The `★MediaStore.Downloads★` box is the load-bearing change — the current code inserts into `MediaStore.Audio.Media`, which cannot hold a `Download/` file.

### Recommended file touch-map
```
src/lib/services/
├── download-filename.ts          # NEW — pure: buildDownloadFilename(artist, title, ext) → sanitized string
├── download-filename.test.ts     # NEW — translated/raw/sanitize/extension cases
├── blob-store.ts                 # EDIT — put(uid, blob, filename?); nativePut uses filename for MediaStore + saveToDownloads; add relocate orchestration OR a migrateDownloads()
├── media-store.ts                # EDIT — add saveToDownloads (or rename saveToMusic) + relocate method to the TS interface
├── blob-store.test.ts            # EDIT — assert new collection/filename plumbing + migration idempotency + per-uid never-throw
src/lib/stores/
├── library.svelte.ts             # EDIT — downloading Set + beginDownload/endDownload (D-10)
src/lib/components/
├── DownloadControl.svelte        # NEW (or a shared snippet) — idle/spinner/downloaded tri-state
├── TrackMenu.svelte              # EDIT — remove window.open (L230) + showSaveFilePicker (D-02); begin/endDownload; pass filename to put()
├── CompactRow.svelte             # EDIT — optional download affordance (D-11 — see Open Question)
android/app/src/main/java/com/openmusic/app/
├── MediaStoreSaverPlugin.kt      # EDIT — MediaStore.Downloads collection + Download/openmusic/ path; legacy DIRECTORY_DOWNLOADS; NEW relocate/saveToDownloads method
src/routes/(app)/
├── album/[name]/+page.svelte     # EDIT — remove window.open (L399); shared filename helper; per-row state
├── library/+page.svelte          # EDIT — per-row download state (D-11)
├── settings/data/+page.svelte    # EDIT — migration button (native-guarded)
src/lib/i18n/*.ts (15 files)      # EDIT — menu.downloaded + migration strings (double quotes, key parity)
```

### Pattern 1: MediaStore.Downloads insert (replaces the Audio insert)
**What:** Insert audio into the `Download/` folder via the Downloads collection.
**When to use:** The API 29+ branch of `saveToMusic` (rename to `saveToDownloads` recommended).
```kotlin
// Source: developer.android.com/training/data-storage/shared/media (verified 2026-07-23)
private val relativePath = "${Environment.DIRECTORY_DOWNLOADS}/openmusic/"   // "Download/openmusic/"

// API 29+ branch — CHANGE THE COLLECTION, not just the path:
val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)  // ★ was MediaStore.Audio.Media
val values = ContentValues().apply {
    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)   // MediaColumns = shared superinterface, works for Downloads
    put(MediaStore.MediaColumns.MIME_TYPE, mime)
    put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
    put(MediaStore.MediaColumns.IS_PENDING, 1)
}
val uri = resolver.insert(collection, values) ?: run { /* reject → never-throw sentinel */ }
resolver.openOutputStream(uri).use { streamCopy(input, it) }   // WR-02 chunked, unchanged
values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
resolver.update(uri, values, null, null)                        // publish
// returns content://media/external/downloads/<id>  (was …/audio/media/<id>)
```
Legacy ≤28 branch: `Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)` + `File(dir, "openmusic")` + `MediaScannerConnection.scanFile(...)` — structurally identical to today, only the directory constant changes.

### Pattern 2: Per-uid migration (copy + delete), TS-orchestrated
**What:** Relocate one already-downloaded file, idempotently, never throwing.
```typescript
// Reuses two already-tested never-throw primitives. Runs on native only.
async function migrateOne(uid: string): Promise<'moved' | 'skipped' | 'failed'> {
  const oldUri = getStoredUri(uid);
  if (!oldUri) return 'skipped';
  if (isDownloadsUri(oldUri)) return 'skipped';            // idempotent: already in Download/ (content://…/downloads/… or path under /Download/)
  try {
    const { uri: sourcePath } = await Filesystem.getUri({ path: nativePath(uid), directory: NATIVE_DIR }); // D-04 app-private copy
    const fileName = /* buildDownloadFilename from the library.downloads Track for this uid */;
    const { uri: newUri } = await MediaStoreSaver.saveToDownloads({ fileName, sourcePath });
    if (!newUri) return 'failed';
    await MediaStoreSaver.deleteFromMusic({ uri: oldUri }); // own entry → no consent needed
    setStoredUri(uid, newUri);                              // remap index
    return 'moved';
  } catch {
    return 'failed';                                        // DL-RESILIENCE-01 — leave uid on old folder, continue
  }
}
```
Idempotency signal `isDownloadsUri`: old Audio URIs are `content://media/external/audio/media/…`; new Downloads URIs are `content://media/external/downloads/…`. Legacy file URIs contain `/Music/OpenMusic/` (old) vs `/Download/openmusic/` (new). Inspect the string — robust to a partial prior run.

### Pattern 3: Reactive per-uid Set in the library store (D-10)
```typescript
// Source: mirrors TrackMenu inFlight (TrackMenu.svelte:59) + library.svelte.ts idiom
downloading = $state(new Set<string>());
beginDownload(uid: string) { this.downloading = new Set(this.downloading).add(uid); }
endDownload(uid: string)   { const n = new Set(this.downloading); n.delete(uid); this.downloading = n; }
```
Every surface reads `library.downloading.has(uid)` and `library.isDownloaded(uid)` — the tri-state derives from these two.

### Anti-Patterns to Avoid
- **Changing only the `relativePath` string while keeping `MediaStore.Audio.Media`** — throws `IllegalArgumentException` at runtime; unit tests (which mock the plugin) will NOT catch it — device-only failure. This is the single highest-risk mistake in the phase.
- **Attempting an in-place `RELATIVE_PATH` update to migrate Audio→Downloads** — same allowed-directory rejection; silently wastes the migration.
- **Building the filename inside the pure helper by importing `names`** — couples the pure/node-testable helper to a runes store. Pass the *already-translated* strings in; keep the helper pure (repo convention).
- **Putting `downloading` state on the player** — violates D-18 (download isolation). It lives on `library`.
- **`await`-ing a translation before the download** — D-07 says never block; the zh-Hant case is already synchronous (see Filename section).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Writing to the public `Download/` folder | Raw `File`/`java.io` to `/sdcard/Download` | `MediaStore.Downloads` insert (API 29+) | Scoped storage forbids direct public-path writes on API 29+; MediaStore is the only sanctioned path and needs no runtime permission for own entries |
| Moving a file between MediaStore folders | Manual byte-copy + custom bookkeeping from scratch | `insert` (Downloads) + `delete` (Audio) via `ContentResolver` (reuse existing `saveToMusic`/`deleteFromMusic` primitives) | The bridge already streams + never-throws; migration is just orchestration |
| Sanitizing a filename | New regex per call site | ONE `download-filename.ts` `sanitize` (D-08) | Format already drifted across TrackMenu (L202) + album (L393); consolidate |
| Simplified→Traditional filename | Manual char map or awaited API | `names.dnTitle`/`dnArtist` (offline s2t sync fast-path already warmed at boot) | Deterministic, synchronous, already in `names.svelte.ts` |
| Reactive per-song flags | Custom event bus / player coupling | `$state(new Set())` reassign idiom | Already the house pattern (`inFlight`, `busyAction`) |

**Key insight:** Every "hard" piece already exists in the repo as a tested primitive. The phase's real work is (a) the one-line-conceptually-but-load-bearing collection swap in Kotlin, and (b) wiring existing primitives together with correct idempotency + never-throw discipline.

## Runtime State Inventory

> This IS a migration phase — a file-move + index-rewrite that a grep audit cannot see. All five categories answered.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) `openmusic-blob-uri:<uid>` localStorage entries — one per natively-downloaded track, currently pointing at `content://media/external/audio/media/<id>` (Music/OpenMusic). (2) `library.downloads` Track list in `openmusic:library:v1` — uid-keyed, **unaffected** (uids don't change). (3) App-private copies `Directory.Data/downloads/<uid>` — **unaffected** (D-04). | **Data migration** (rewrite the URI index per uid) + **code edit** (write new URIs to the index going forward). The Track list and app-private copies need NO change. |
| **Live service config** | The public MediaStore rows themselves are OS-managed state living in the Android MediaProvider database, NOT in git or app storage. Existing rows are in the Audio collection under `Music/OpenMusic/`. | **Data migration** — copy each into the Downloads collection + delete the old Audio row (per-uid, native). |
| **OS-registered state** | MediaStore entries are registered with Android's MediaProvider (visible to file managers / other audio apps). Deleting the old Audio row un-registers it; inserting the new Downloads row re-registers under `Download/openmusic/`. No Task Scheduler / launchd / systemd analog. | Handled by the copy+delete migration. |
| **Secrets/env vars** | None. No secret or env var references the folder or filename. `JOOX_TOKEN`/`LASTFM_*` are unrelated. | None. |
| **Build artifacts / installed packages** | The Kotlin change requires an APK rebuild (`pnpm apk` → `cap sync` → `assembleDebug`) to take effect — the plugin change is compiled native code, not hot-reloadable web. No egg-info/npm-global analog. | **Rebuild the APK** to ship the folder change; the web bundle change ships via the normal build. |

**The canonical question — after every file in the repo is updated, what runtime systems still have the old string cached/stored/registered?** Two: (a) the `openmusic-blob-uri:<uid>` localStorage index on each user's device (rewritten by the migration button), and (b) the physical MediaStore rows under `Music/OpenMusic/` on each device (relocated by the migration button). Both are per-device runtime state that ships to zero and must be handled by the in-app migration, not by the code change alone. Users who never tap the migration button keep old files in `Music/OpenMusic/` (they still play — app-private copy is the read source) while new downloads land in `Download/openmusic/`; the migration is the reconciliation, and it is idempotent.

## Common Pitfalls

### Pitfall 1: `Download/` rejected by the Audio collection (THE big one)
**What goes wrong:** Changing `relativePath` to `Download/openmusic/` but leaving `resolver.insert(MediaStore.Audio.Media.getContentUri(...), …)` → `IllegalArgumentException: Primary directory Download not allowed for content://media/external/audio/media; allowed directories are [Alarms, Audiobooks, Music, Notifications, Podcasts, Ringtones, Recordings]`.
**Why it happens:** Each MediaStore collection whitelists top-level directories; `Download/` belongs only to `MediaStore.Downloads`.
**How to avoid:** Switch the collection to `MediaStore.Downloads.getContentUri(VOLUME_EXTERNAL_PRIMARY)`. Use `MediaStore.MediaColumns.*` for the ContentValues keys (they're the shared superinterface).
**Warning signs:** Reject reaches the TS never-throw sentinel → `put()` returns true (app-private landed) but the public copy silently never appears; only device UAT (open a file manager, check `Download/openmusic/`) catches it. Unit tests mock the plugin and pass regardless. `[VERIFIED: developer.android.com/training/data-storage/shared/media]`

### Pitfall 2: Assuming in-place `RELATIVE_PATH` update can migrate
**What goes wrong:** `resolver.update(oldAudioUri, {RELATIVE_PATH: "Download/openmusic/"})` → rejected (Download not allowed for an Audio row) OR silently ignored.
**Why it happens:** In-place moves are constrained to the row's own collection's allowed dirs.
**How to avoid:** Copy into Downloads + delete old Audio (Pattern 2).
**Warning signs:** Migration reports "moved" but files stay in `Music/OpenMusic/`, or throws.

### Pitfall 3: Filename thread-through misses the native path
**What goes wrong:** Building the human filename only in the UI anchor (web) but leaving `nativeFileName(uid)` returning `<uid>.mp3` → the public Android file is named `netease-123.mp3` even though the web download is human-named.
**Why it happens:** `blobStore.put(uid, blob)` today has no filename argument; `nativePut` derives `<uid>.mp3` internally.
**How to avoid:** Add a `filename` argument to `put()` (only **one** caller — `TrackMenu.svelte:202`) and pass it to `saveToDownloads`. Fall back to `nativeFileName(uid)` when absent (album path, which doesn't call `put()` today).
**Warning signs:** Web filename correct, on-device filename is the uid.

### Pitfall 4: Orphaned entries after uninstall/reinstall
**What goes wrong:** After a reinstall, previously-created MediaStore rows are owned by "another app" (the prior install); `delete`/`update` throws `RecoverableSecurityException`.
**Why it happens:** Ownership is per-install package identity.
**How to avoid:** Per-uid try/catch → skip (never-throw). Do NOT build the `createDeleteRequest`/consent-dialog flow — out of scope; graceful skip is the correct degrade.
**Warning signs:** "Moved N of M" with M < total after a reinstall — acceptable.

### Pitfall 5: i18n key-set parity break
**What goes wrong:** Adding `menu.downloaded` + migration keys to `en.ts` only → `i18n.test.ts` fails ("every locale exposes a key set IDENTICAL to en") across all locales.
**Why it happens:** The parity test iterates `Object.keys(dicts)` for every locale.
**How to avoid:** Add every new key to **all 15 locale files** (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`) with **double quotes** for key AND value.
**Warning signs:** `pnpm test` red on `i18n.test.ts`. `[VERIFIED: src/lib/i18n/i18n.test.ts]`

### Pitfall 6: iOS Safari + `a.download`
**What goes wrong:** Historically iOS Safari ignored `download` and navigated/opened inline.
**Why it happens:** Old WebKit behavior for cross-origin/non-blob hrefs.
**How to avoid:** The href is a **same-origin `blob:` URL** (created from the fetched Blob) — modern iOS Safari (14.5+) honors `a.download` for blob URLs and saves without navigation. The bug was never the anchor; it was the `catch → window.open(rawStreamUrl)`. Removing `window.open` is the fix. `[ASSUMED — device UAT recommended for older iOS]`

## Code Examples

### Filename builder (pure helper, D-08)
```typescript
// download-filename.ts — PURE (no store imports), node-testable
// Source: consolidates TrackMenu.svelte:201-202 + album/+page.svelte:390-393
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|wav)$/i;

export function extFromAudioUrl(audioUrl: string | null): string {
  return (audioUrl?.split('?')[0].match(AUDIO_EXT)?.[1] ?? 'mp3').toLowerCase();
}

/** artist/title should already be run through names.dn* by the caller (D-05/D-07 raw-fallback). */
export function buildDownloadFilename(artist: string, title: string, ext: string): string {
  return `${artist} - ${title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
}
```
Caller (TrackMenu.doDownload, replacing L201-202):
```typescript
const ext = extFromAudioUrl(r.audioUrl);
const filename = buildDownloadFilename(names.dnArtist(r.artist), names.dnTitle(r.title), ext);
await blobStore.put(r.uid, blob, filename);   // filename threaded to native MediaStore
```

### Bug-fix (TrackMenu.doDownload catch, replacing L229-232)
```typescript
} catch {
  // DL-BUG-01 (D-09): NEVER window.open the stream. The song is already in library.downloads
  // (addDownload ran above) and re-streams on tap; just tell the user.
  toast.show(t('toast.downloadFailedKeptInLibrary'));  // or reuse toast.openedAudio reworded
}
```
Also remove the `showSaveFilePicker` block (L207-222) per D-02 — go straight to the anchor.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `WRITE_EXTERNAL_STORAGE` + raw public path | Scoped storage; MediaStore collections with allowed dirs | Android 10 (API 29), enforced Android 11 (30) | Public writes MUST go through MediaStore; `Download/` only via `MediaStore.Downloads` |
| Audio anywhere on `/sdcard` | Audio confined to Music/Podcasts/…; `Download/` = Downloads collection | Android 10+ | Drives the collection-switch requirement |
| `showSaveFilePicker` prompt (web desktop) | Direct anchor auto-save (D-02) | This phase | No prompt; matches native no-prompt behavior |
| `Recordings/` unavailable | `Recordings/` allowed for Audio | Android 12 (API 31) | Not used here; noted for completeness of the allowed-dir list |

**Deprecated/outdated:**
- `Environment.getExternalStoragePublicDirectory(...)`: deprecated on API 29+, retained ONLY on the ≤28 legacy branch (already `@Suppress("DEPRECATION")` in the plugin). Keep as-is with `DIRECTORY_DOWNLOADS`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Modern iOS Safari (14.5+) honors `a.download` on same-origin `blob:` URLs without navigating | Pitfall 6 / DL-BUG-01 | Low — worst case a rare older-iOS user sees an inline open; device UAT confirms. The removal of `window.open` is correct regardless. |
| A2 | An MP3 inserted into `MediaStore.Downloads` is NOT auto-dual-indexed into the Audio collection in a way that breaks delete-by-stored-URI | Pattern 1 | Low — app deletes by the exact URI it stored from insert(); even if dual-indexed, that URI resolves. |
| A3 | The app-private copy (`Directory.Data/downloads/<uid>`) is present for every uid that has an old public URI (so migration has a byte source) | Pattern 2 | Medium — if a user cleared app data but kept public files, the source is missing → that uid's migration fails gracefully (skip, never-throw). Acceptable per DL-RESILIENCE-01; note it. |
| A4 | Renaming `saveToMusic`→`saveToDownloads` is safe (only `blob-store.ts` + `media-store.ts` + the Kotlin `@PluginMethod` name reference it) | file touch-map | Low — grep-verified single TS caller chain; the plugin method name is matched by string on both sides. Keeping the old name also works. |

## Open Questions

1. **D-11 inline affordance placement on CompactRow / library / album rows.**
   - What we know: today **no track row renders an inline download button** — downloads are triggered from `TrackMenu` (⋮) and the album bulk button only (verified: library rows are play+longpress-menu+swipe; CompactRow is play+⋮). The "greyed Downloaded state on every row" is therefore a **new visible affordance**, not a restyle.
   - What's unclear: whether home/search `CompactRow` should gain a persistent inline download icon (adds visual density to discovery lists) or whether the tri-state control appears only where a download action already lives (TrackMenu row, album rows) plus a passive "downloaded" badge elsewhere.
   - Recommendation: Planner to decide per-surface. Safe default — inline tri-state control on **library rows + album rows + TrackMenu row** (surfaces where downloading is a primary action), and a passive greyed indicator (no new tap target) on `CompactRow`. Keep the shared control a single component so the decision is one prop, not a fork.

2. **Album downloads and the public folder on native.**
   - What we know: `album.downloadAlbum` does NOT call `blobStore.put` — it only `library.addDownload` + a browser anchor save. So on native, **album downloads never land in the public folder today** (no MediaStore write per album track).
   - What's unclear: whether this phase should bring album downloads to parity (route them through `blobStore.put` so they also land in `Download/openmusic/` on native) or leave the asymmetry.
   - Recommendation: Out of scope unless the user wants it — the phase is per-song focused. Flag it; if in scope it's a small addition (call `put` in the album loop). Note the filename helper + bug-fix DO apply to the album path regardless.

3. **Migration byte-source when the library Track lacks a resolved `audioUrl`/ext.**
   - What we know: the human filename needs an extension; for migration we rebuild it from the stored `library.downloads` Track. Some stored Tracks may have `audioUrl: null` (stub) if added oddly.
   - Recommendation: Fall back to `.mp3` (the existing default) or infer from the app-private file — deterministic default is fine; don't block a migration on a missing ext.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Android SDK / Gradle toolchain | Kotlin plugin build (`pnpm apk`) | ✓ (CI: `android-main.yml`) | compile/target **36**, min **24** | — (native change cannot ship without it) |
| Capacitor CLI (`cap sync`) | native rebuild | ✓ | 8.4.0 | — |
| Android device / emulator (API 29+ and one API ≤28) | **device-only UAT** of folder + migration | ✗ in this sandbox | — | Human UAT on device (consistent with the repo's device-UAT posture for native + CN-network features) |
| Vitest (node) | pure helper + store + orchestration tests | ✓ | ^4.1.3 | — |
| `pnpm check` (svelte-check) | typecheck gate | ✓ | — | — |

**Missing dependencies with no fallback:** none for the code change. **Device verification of the MediaStore folder + migration is device-only** (no JVM/instrumented test infra in the repo; the sandbox cannot run an Android device). This is expected and mirrors the project's established "native = device UAT" reality (project memory: sandbox can't reach CN upstreams; native background-audio is device-only).

## Validation Architecture

> `nyquist_validation` treated as enabled (no `.planning/config.json` opt-out found). Test framework confirmed below.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.3` (single node/server project, no jsdom) `[VERIFIED: package.json / CLAUDE.md]` |
| Config file | Vitest config in `vite.config.ts`; tests co-located `*.test.ts` / `*.svelte.test.ts` |
| Quick run command | `pnpm test` (`vitest --run`) — or scope: `pnpm test -- download-filename` |
| Full suite command | `pnpm test && pnpm check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DL-FILE-01 | `buildDownloadFilename` — translated names, raw fallback, sanitize (`/\?%*:|"<>`), each extension, default mp3 | unit (pure) | `pnpm test -- download-filename` | ❌ Wave 0 — `download-filename.test.ts` |
| DL-FILE-01 | `extFromAudioUrl` — query-stripped, case-insensitive, unknown→mp3 | unit (pure) | `pnpm test -- download-filename` | ❌ Wave 0 (same file) |
| DL-FILE-01 | native `put(uid, blob, filename)` passes filename to `saveToDownloads` (mocked) | unit | `pnpm test -- blob-store` | ✅ extend `blob-store.test.ts` |
| DL-STATE-01 | `library.downloading` begin→has→end transitions; reassign keeps reactive; isolation from player | unit | `pnpm test -- library` | ❌ Wave 0 — `library.svelte.test.ts` (or extend existing) |
| DL-BUG-01 | doDownload catch path calls `toast.show`, does NOT call `window.open` | unit (spy) | `pnpm test -- TrackMenu` (mock fetch reject; assert `window.open` un-called) | ❌ Wave 0 — component/logic test or extract catch to a testable fn |
| DL-MIGRATE-01 | migrate orchestration: idempotent skip when URI already Downloads; copy+delete+remap on Audio URI; "Moved N of M" count | unit | `pnpm test -- blob-store` (mock `saveToDownloads`/`deleteFromMusic`/localStorage) | ✅ extend `blob-store.test.ts` |
| DL-RESILIENCE-01 | per-uid failure → sentinel, loop continues, other uids still migrate; never rejects | unit | `pnpm test -- blob-store` (make one `saveToDownloads` reject) | ✅ extend `blob-store.test.ts` |
| DL-FOLDER-01 | **Kotlin collection = MediaStore.Downloads, path = Download/openmusic/** | **device-only UAT** | manual: build APK, download a song, open file manager → `Download/openmusic/{artist} - {song}.ext` | N/A — no JVM test infra |
| DL-MIGRATE-01 | migration relocates real files on device; old `Music/OpenMusic/` emptied; files still play | **device-only UAT** | manual: pre-migration downloads, tap button, verify move + playback | N/A |
| i18n | `menu.downloaded` + migration keys present in all 15 locales; double quotes | unit | `pnpm test -- i18n` | ✅ `i18n.test.ts` self-enforces parity |

### Sampling Rate
- **Per task commit:** `pnpm test -- <scope>` for the touched service/store (< 5s).
- **Per wave merge:** `pnpm test && pnpm check` (full node suite + typecheck).
- **Phase gate:** full suite green + **device UAT sign-off** for DL-FOLDER-01 / DL-MIGRATE-01 before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/services/download-filename.ts` + `download-filename.test.ts` — DL-FILE-01 (translated/raw/sanitize/ext/default cases)
- [ ] `library.svelte.test.ts` (or extend) — `downloading` Set transitions (DL-STATE-01)
- [ ] Extend `blob-store.test.ts` — filename plumbing to `saveToDownloads`; migration idempotency; per-uid never-throw (DL-MIGRATE-01/RESILIENCE-01)
- [ ] Testable seam for the doDownload catch (DL-BUG-01) — extract the catch/save-fallback decision to a pure/spy-able unit OR a component test asserting `window.open` is not called on fetch-reject
- [ ] Add `menu.downloaded` + migration keys to all 15 locale files (i18n.test.ts will fail until done — this is the self-enforcing gate)
- [ ] **Device UAT checklist** (cannot be automated): (a) new download lands in `Download/openmusic/` with human filename on API 29+ AND on an API ≤28 device/emulator; (b) migration moves old files, empties `Music/OpenMusic/`, files still play; (c) migration is idempotent on a second tap; (d) partial failure (revoke a permission / delete an app-private source) does not crash and reports N<M.

**Note:** The highest-severity requirement (DL-FOLDER-01 collection swap) is exactly the one that unit tests CANNOT catch, because `blob-store.test.ts` mocks `MediaStoreSaver` — the mock returns a fake URI regardless of the real collection. The `IllegalArgumentException` only occurs against the real Android MediaProvider. **Device UAT is mandatory, not optional, for this phase.**

## Sources

### Primary (HIGH confidence)
- `developer.android.com/training/data-storage/shared/media` — allowed directories per collection (Audio: Alarms/Audiobooks/Music/Notifications/Podcasts/Ringtones/Recordings; Downloads: Download); MediaStore.Downloads insert with RELATIVE_PATH + IS_PENDING; own-entry update/delete without consent vs RecoverableSecurityException for other apps; in-place RELATIVE_PATH move is intra-collection.
- Codebase (read in full this session): `MediaStoreSaverPlugin.kt`, `blob-store.ts`, `media-store.ts`, `TrackMenu.svelte`, `library.svelte.ts`, `names.svelte.ts`, `settings.svelte.ts`, `CompactRow.svelte`, `album/[name]/+page.svelte`, `library/+page.svelte`, `settings/data/+page.svelte`, `blob-store.test.ts`, `i18n/en.ts`, `i18n.test.ts`, `AndroidManifest.xml`, `android/variables.gradle`.

### Secondary (MEDIUM confidence)
- CommonsWare "Scoped Storage Stories" (commonsware.com/blog/2019/12/21/scoped-storage-stories-storing-mediastore.html) + "How to Create Media" — RELATIVE_PATH is a hint; disallowed top-level → IllegalArgumentException. Cross-verified with the Android developer doc above.

### Tertiary (LOW confidence — flagged in Assumptions Log)
- iOS Safari `a.download` + `blob:` behavior on 14.5+ (A1) — general web knowledge; device UAT recommended.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives read directly from source.
- Android MediaStore mechanics (folder + migration): HIGH — verified against official Android developer docs + a second source; the collection constraint is documented and unambiguous.
- Filename sync/async behavior: HIGH — read `names.svelte.ts`; `dn*` is synchronous with an offline s2t sync fast-path for zh-Hant.
- Web bug-fix: HIGH (logic) / MEDIUM (iOS anchor behavior — A1).
- UI rollout (D-11 placement): MEDIUM — no inline download affordance exists today; a genuine design decision surfaced as Open Question 1.

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (stable domain; Android scoped-storage rules are multi-year-stable. Re-verify only if targetSdk changes.)
