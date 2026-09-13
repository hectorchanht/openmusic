# Phase 34: Import device songs as native downloads - Research

**Researched:** 2026-09-13
**Domain:** Android MediaStore audio query from a hand-written Capacitor plugin; WebView playback of device files; filename parsing; library/blob-store identity widening
**Confidence:** MEDIUM-HIGH (codebase findings HIGH/verified; Android runtime behaviour MEDIUM, several items device-verify-only)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Identity**
- **D-01:** Imported files get a `device:` pseudo-source uid — `device:<stable-key>` via the existing `makeUid()` contract. The client source registry (`src/lib/sources/registry.ts`) is NOT extended; `device:` is an identity namespace, not a searchable/resolvable source. Rationale: it can never collide with a real source id, and an imported file genuinely IS a different thing from a streamed track.
- **D-02:** The stable key is the Android **MediaStore `_ID`**, so a file the user moves or renames stays ONE library entry across re-imports. Accepted cost: `_ID` is not stable across a factory reset or SD-card reinsert — those re-import as new entries.
- **D-03:** No tag-matching to catalog uids in this phase. An imported song and the same song streamed from a source remain two separate library entries. Linking them is explicitly deferred, and is the reason D-01 chose the honest-namespace option over adopting a catalog uid.

**Playback**
- **D-04:** Imported files play **in place** — no copy is made into app-private storage. Importing a large library costs zero extra disk and is near-instant.
- **D-05:** The in-place read is implemented INSIDE the native branch of `blobStore.get()` (`src/lib/services/blob-store.ts`), which returns the device file's bytes/URL for a `device:` uid. This is deliberate: `player.svelte.ts` gates offline playback on `library.isDownloaded(uid)` → `blobStore.get(uid)` at **5 call sites** (lines ~581, ~666, ~3122, ~3335, plus the prebuffer guard at ~2864). Fixing the shared function covers all of them; patching call sites does not, and would leave the next one written broken.
- **D-06:** A missing file (deleted, SD card pulled) marks the entry **unavailable but keeps it listed** — the user sees why it won't play and can re-import. It must NOT silently vanish. This is a deliberate departure from the existing broken-blob path at `player.svelte.ts:~2100`, which does `blobStore.del()` + `library.removeDownload()`; that self-healing behaviour is correct for an evictable downloaded blob and wrong for a user's own file.

**Re-import and the app's own downloads**
- **D-07:** Import is a **full re-sync against the device**: new files are added, and entries whose files are confirmed gone are dropped.
- **D-08:** D-06 and D-07 are reconciled as: **unavailable between imports, dropped at the next import.** Removal only ever happens inside an explicit user-initiated import — never silently in the background. A transient read failure must not be treated as "confirmed gone".
- **D-09:** `Music/OpenMusic/` (files the app itself wrote, per 999.1 D-11) is scanned, and a found file is **merged onto the existing library entry's real source uid** rather than added as a second `device:` entry. Purpose of the merge is to restore playability for a public file whose app-private copy was evicted. The first import must NOT make every existing download appear twice.
- **D-10:** Merge conflict rule (stored Track vs file on disk) is **Claude's discretion** — settle it against the actual `Track` shape during planning. Strong prior from the discussion: the app's stored entry is enriched (real cover, proper album) and the file's tags usually are not, so metadata churn from a merge is a downgrade risk.

**Scan scope and import rules**
- **D-11:** Scan covers **Music + Download** only. Not every directory MediaStore indexes — that sweeps in ringtones, notification sounds, voice memos, messaging-app audio and podcast caches.
- **D-12:** Import is governed by a **user-editable rules panel** in the Settings download page, alongside the import button:
  - **Filename parsing** — checkbox presets for common layouts (`{artist} - {title}`, `{title} - {artist}`, `{track}. {title}`, strip leading track numbers, strip bracketed tags like `[Official MV]`), PLUS one advanced raw-regex field with named groups as an escape hatch.
  - **Minimum duration** — a range filter so short clips (ringtones, notification blips) are skipped without judging content.
  - **File extensions** — checkboxes for which audio extensions count.
  - **Skip rules** — user-defined exclusions.
- **D-13:** `{artist} - {title}` is the **default** parsing preset.
- **D-14:** The import button **works with zero configuration.** Defaults ship working (D-13 parsing, a sane minimum duration, common audio extensions on). The rules panel exists to adjust behaviour, never as a prerequisite — the user's ask was a button, not a setup form.
- **D-15:** **Embedded tags win over filename parsing.** Filename parsing is the fallback for files whose tags are missing or empty, not an override.
- **D-16:** An untagged file is **imported with its parsed filename as the title**, not skipped. A song the user can plainly see on their phone silently not importing reads as the feature being broken.

### Claude's Discretion
- Merge conflict resolution between a stored Track and a found file (D-10).
- Exact minimum-duration default value.
- Which audio extensions are on by default.
- Runtime permission flow shape (`READ_MEDIA_AUDIO` on modern Android) — follow the existing `publicMusicPermsCallback` pattern in the Kotlin plugin.
- Whether `device:` entries carry cover art in this phase, and where it comes from (embedded art vs the existing cover chain).
- Progress/reporting UI during a scan.

### Deferred Ideas (OUT OF SCOPE)
- **Linking a `device:` entry to a catalog uid** (tag-matching so an imported song and its streamed twin become one entry) — deliberately out of scope per D-03. Needs the fuzzy-matching work that `scoreMatch` has a CJK history with; belongs in its own phase.
- **User-selected scan folders / folder picker** — rejected for this phase in favour of Music + Download (D-11). Revisit if SD-card or unusual-layout reports come in.
- **Copy-on-demand pinning** of an imported file into app-private storage — considered and set aside; adds a second storage concept to explain.
- **Reviewed todos (not folded):** `todo.match-phase 34` returned 4 matches, all unrelated to device import. Not folded.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

ROADMAP.md line 343 declares `**Requirements**: TBD` and `.planning/REQUIREMENTS.md` **does not exist** in this repo. No requirement IDs are in play for this phase. The planner should derive its own `T-34-*` task IDs and treat the CONTEXT D-01..D-16 decisions as the requirement set, as prior phases in this repo have done (29-CONTEXT D-01..D-18 → `DL-FILE-01` / `DL-STATE-01` / `DL-BUG-01` style tags).

`[VERIFIED: .planning/ROADMAP.md:343, .planning/ dir listing]`
</phase_requirements>

---

## Summary

The phase is **almost entirely a Kotlin + service-layer job**, and the web-side integration is smaller than it looks — because the existing native download path already does 90% of what device playback needs. `blobStore.nativeGet()` today resolves an app-private file URI, runs it through `Capacitor.convertFileSrc()`, `fetch()`es the resulting `https://localhost/_capacitor_file_/…` URL and returns a `Blob`. Capacitor's Android bridge handles `content://` URIs through the **exact same mechanism** (`/_capacitor_content_` → `ContentResolver.openInputStream`), so a device file becomes playable by feeding `nativeGet` a content URI instead of a file URI. That is a ~15-line change to one function and it satisfies D-05 with no player edits at all. `[VERIFIED: node_modules/@capacitor/android/…/WebViewLocalServer.java:654-659, AndroidProtocolHandler.java:72-87, native-bridge.js:176-178]`

The big surprises are on the other side. **(1)** Capacitor's HTTP-Range implementation is broken — it returns a `206` with a correct-looking `Content-Range` header but a stream that always starts at byte 0, so streaming a `_capacitor_content_` URL directly into `<audio src>` would give you unseekable, corrupt-on-seek playback. The existing fetch→Blob→`createObjectURL` shape dodges this entirely and must be preserved. **(2)** The bulk scan needs **no per-file metadata extraction at all** — MediaStore's columns *are* the embedded tags, already extracted by the system scanner; running `MediaMetadataRetriever` per file would be the slow, wrong answer. **(3)** `MediaStore.getVersion()` is the documented, purpose-built API for exactly D-02's problem ("has MediaStore been rebuilt under me, invalidating my cached `_ID`s?") and should be stored alongside the import index.

The single most dangerous finding is a **data-loss path that is one line away from existing today**: `library.removeDownload(uid)` → `blobStore.del(uid)` → `nativeDel` reads `openmusic-blob-uri:<uid>` from localStorage and calls `MediaStoreSaver.deleteFromMusic({ uri })`. If the import writes a device file's content URI into that index (the natural way to implement D-05/D-09), then a user removing an imported song from their library **deletes their own music file off the phone**. D-06 says the opposite must happen. This must be an explicit, tested guard.

**Primary recommendation:** Add one paged `scanAudio` `@PluginMethod` to the existing `MediaStoreSaverPlugin.kt` that returns rows straight out of a MediaStore cursor (no MediaMetadataRetriever, no bitmaps); add a `device:` branch to `blobStore` `get`/`has`/`del` that reads a content URI through the existing `convertFileSrc` + fetch path and **refuses to delete**; add one early-return guard in `catalog.ts ensureTrackDetails`; keep filename parsing and scan-row→Track mapping as a pure `.ts` module; put the button in a **new `/settings/downloads` route** (the "Settings download page" the CONTEXT references does not exist yet).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MediaStore audio cursor query + folder filter | Android native (Kotlin plugin) | — | Only Kotlin can touch `ContentResolver`; SQL-side filtering keeps the bridge payload small |
| Runtime permission request (`READ_MEDIA_AUDIO`) | Android native (Kotlin plugin) | TS bridge (surfaces denial) | Capacitor's `@CapacitorPlugin(permissions=…)` + `requestPermissionForAlias` is the only route |
| Content-URI byte read for playback | Android native (Capacitor `WebViewLocalServer`, already built) | `blob-store.ts` native branch | Zero new native code — `convertFileSrc` + the local server already stream `content://` |
| Scan-row → `Track` mapping | Pure TS service (`.ts`) | — | Node-testable; keeps Kotlin dumb (rows in, rows out) |
| Filename parsing / preset + regex rules | Pure TS service (`.ts`) | — | Node-testable; the inverse of the existing `download-filename.ts` |
| Import rules persistence | Runes store (`*.svelte.ts`) or `settings.svelte.ts` | localStorage `openmusic:<domain>:v<N>` | Reactive read by the rules panel |
| Import orchestration (scan → filter → map → merge → index) | Pure TS service + a thin runes wrapper for progress | `library.svelte.ts` | Keep the loop pure; only progress `$state` needs runes |
| "Downloaded"/"unavailable" rendering | Existing components (`DownloadControl`, `RowBadges`) | `library.svelte.ts` | The surface already exists; do not build a parallel one |
| Web (PWA) behaviour | No-op | — | `Capacitor.isNativePlatform()` false → route/button hidden |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the planner must not violate:

| Directive | Consequence for this phase |
|-----------|---------------------------|
| Svelte 5 runes FORCED project-wide; no `export let`, no `$:` | Rules panel + progress UI use `$state`/`$derived`/`$props` |
| Runes only in `*.svelte.ts` / `*.svelte`; pure logic in `.ts` | `device-import.ts`, `filename-parse.ts`, `scan-row.ts` are `.ts`; only a progress/rules store may be `.svelte.ts` |
| Tabs for indentation; single quotes in TS/JS | — |
| `src/lib/i18n/*.ts` use **double quotes**, all 16 locales must have an identical key set (`en` is the reference; `i18n.test.ts` guards parity) | Every new UI string = 16 locale edits. 18 locale files exist (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant` + `detect.ts`/`index.ts`). Budget for this. |
| Zero third-party runtime npm deps in the web app | **No** `music-metadata`, no `jsmediatags`, no regex-safety lib. See "Don't Hand-Roll" for what this forbids and what it permits. |
| Never-throw services returning a sentinel | A failed scan returns `[]`; a failed permission returns a typed sentinel, never a rejection into the render tree |
| `browser` + `isNativePlatform()` guards; SSR disabled app-wide | Import route/button must not render as a dead control on web |
| High comment density; decision refs (`D-09`, `PLAY-08`) are load-bearing and must not be removed | Every new file carries the `34-D-NN` refs |
| No `as any` in production source (all existing ones are in tests); prefer `satisfies`/`as const` | The `SourceId` widening decision below must be type-honest, not cast away |
| `player.svelte.ts` (4343 lines) and `NowPlaying.svelte` (2025 lines) are named anti-patterns — do not add to them | Ideally **zero** net lines added to `player.svelte.ts` |
| No Web Workers (`service-worker.ts` is PWA caching only) | Rules out a worker-based regex timeout. See ReDoS section. |
| GSD workflow enforcement: no direct edits outside a GSD command | — |

`[VERIFIED: ./CLAUDE.md, src/lib/i18n/ listing, wc -l on player/NowPlaying]`

---

## Standard Stack

### Core — all already installed, nothing new to add

| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| `@capacitor/core` | 8.4.0 | `registerPlugin`, `isNativePlatform`, `convertFileSrc` | Already the bridge for `MediaStoreSaver`; `convertFileSrc` already handles `content://` |
| `@capacitor/android` | 8.4.0 | `WebViewLocalServer` `_capacitor_content_` handler; `Plugin` permission APIs | Ships the content-URI streaming path for free |
| `@capacitor/filesystem` | installed | `stat`/`getUri`/`deleteFile` for the app-private copy | Already used by `blob-store.ts` |
| Android `android.provider.MediaStore` | platform (compileSdk 36) | The audio cursor + `getVersion`/`getGeneration` | Platform API — the only way to enumerate other apps' audio |
| Vitest | ^4.1.3 | Node-only test project | Existing single `server` project (`vite.config.ts:8-21`) |

### Deliberately NOT added

| Tempting dependency | Why not |
|---------------------|---------|
| `music-metadata` / `jsmediatags` (embedded-tag parsing in JS) | **Unnecessary.** MediaStore has already run the platform scanner over every indexed file; `TITLE`/`ARTIST`/`ALBUM`/`ALBUM_ARTIST`/`DURATION`/`TRACK`/`YEAR` columns **are** the embedded tags. Parsing them again in JS means reading every file's bytes across the bridge for data you already have. Also violates the zero-runtime-dep house rule. Phase 36 (tag *writing*) may need a codec — that is a different problem. |
| `safe-regex` / `recheck` (ReDoS static analysis) | Violates zero-runtime-dep. A timed probe at save time + a budget-abort during the scan is ~20 lines and catches the realistic case. See "Common Pitfalls / ReDoS". |
| `FFmpegMediaMetadataRetriever` (native, for cover art) | A multi-MB native dependency for a Claude's-discretion nice-to-have. `ContentResolver.loadThumbnail()` on the album URI is free and built in. `[CITED: github.com/iammert/FFmpegMediaMetadataRetriever — noted as the community alternative, rejected here on size]` |
| `@capacitor/file-transfer` | Capacitor's own recommended workaround for large bridge payloads — but it is for HTTP up/download, not for local content URIs. Paging the cursor solves our problem with no new package. `[CITED: capacitorjs.com — "Support for downloading and uploading files has been added to the @capacitor/file-transfer plugin"]` |

**Installation:** none required. `[VERIFIED: package.json — the web app's `dependencies` are Capacitor plugins + `@lucide/svelte` only]`

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.**

Every capability is served by an already-installed dependency (`@capacitor/core`, `@capacitor/android`, `@capacitor/filesystem`) or a platform API (`android.provider.MediaStore`, `android.content.ContentResolver`). The slopcheck gate is therefore vacuous here. If the planner concludes a new package is needed (it should not — see "Deliberately NOT added"), run the Package Legitimacy Gate protocol before adding it, and expect to justify it against the CLAUDE.md zero-runtime-dep rule.

`[VERIFIED: package.json inspected; no install step in any recommendation above]`

---

## Architecture Patterns

### System Architecture Diagram

```text
 [ Settings → Downloads page ]  (NEW route: src/routes/(app)/settings/downloads/+page.svelte)
   │  "Import songs from device" button        Rules panel (presets + min-duration + exts + regex)
   │  (hidden unless Capacitor.isNativePlatform())      │
   ▼                                                    ▼
 import service  (services/device-import.ts, PURE + a thin progress store)
   │
   ├─1─► MediaStoreSaver.requestScanPermission()   ──► Kotlin: READ_MEDIA_AUDIO (33+) / READ_EXTERNAL_STORAGE (≤32)
   │         │ denied → sentinel {status:'denied'}      │ @CapacitorPlugin(permissions=[…]) + requestPermissionForAlias
   │         ▼                                          ▼
   ├─2─► MediaStoreSaver.scanAudio({offset,limit})  ──► Kotlin: ContentResolver.query(
   │         │  loop until offset >= total              │   Audio.Media.EXTERNAL_CONTENT_URI,
   │         │  (progress = offset/total)               │   projection, RELATIVE_PATH LIKE 'Music/%' OR 'Download/%',
   │         ▼                                          │   sortOrder _ID ASC, LIMIT/OFFSET)
   │     ScanRow[]  { id, uri, volumeName, displayName, relativePath,
   │                  title, artist, album, albumArtist, albumId,
   │                  durationMs, mimeType, size, track, year, isMusic }
   │
   ├─3─► rules filter  (filename-parse.ts + rules)   ── min duration · extension allowlist · skip rules
   │                                                     D-15: MediaStore tags win; parse filename only on empty
   │                                                     D-16: untagged → parsed filename becomes the title
   ├─4─► partition by relativePath
   │       ├── 'Music/OpenMusic/'  ──► D-09 MERGE lane: matchKey(artist,title) against library.downloads
   │       │                            → write openmusic-blob-uri:<real-uid> = row.uri   (restores playability)
   │       │                            → do NOT create a device: entry, do NOT churn metadata (D-10)
   │       └── everything else     ──► D-01 IMPORT lane: uid = device:<volumeName>-<_ID>
   │                                     → scan-row → Track mapping (detailsLoaded true, audioUrl = row.uri)
   ▼
 ─5─► D-07 re-sync diff against library.downloads (device: entries only)
   │     present-on-device → keep/refresh    absent-from-scan → DROP (only inside an explicit import, D-08)
   ▼
 library.addDownload / removeDownload  ──► openmusic:library:v1  ──► every "downloaded" surface repaints
                                                                     (DownloadControl, RowBadges, library page)

 ══════════════════════ PLAYBACK (unchanged player code) ══════════════════════
 player.play(track)  ──► library.isDownloaded(uid) ──► blobStore.get(uid)
                                                          │
                          web: IndexedDB ◄────────────────┤
                          native: ─────────────────────────┴─► NEW device: branch
                                                                 content://media/<vol>/audio/media/<id>
                                                                   → Capacitor.convertFileSrc()
                                                                   → https://localhost/_capacitor_content_/…
                                                                   → WebViewLocalServer → ContentResolver.openInputStream
                                                                   → fetch() → Blob  (re-typed from row.mimeType)
                                                          ▼
                                                 URL.createObjectURL(blob) → audio.src   (unchanged, 5 call sites)
                                                 null (file gone) → D-06 unavailable, entry KEPT
```

The diagram's point: steps 1-5 are new; **the entire right-hand playback lane already exists** and only gains a branch inside one function.

### Recommended project structure

```
android/app/src/main/java/com/openmusic/app/
└── MediaStoreSaverPlugin.kt      # EXTEND (scanAudio, permission alias) — do NOT add a 2nd plugin

src/lib/services/
├── media-store.ts                # EXTEND: scanAudio + permission method typings
├── blob-store.ts                 # EXTEND: device: branch in get/has/del  (D-05 — the single seam)
├── device-import.ts              # NEW, PURE: orchestration, re-sync diff, merge lane  (node-testable)
├── device-filename.ts            # NEW, PURE: presets + regex parsing  (inverse of download-filename.ts)
└── device-track.ts               # NEW, PURE: ScanRow → Track mapping + uid helpers (isDeviceUid/deviceUid)

src/lib/stores/
└── import-rules.svelte.ts        # NEW (or fold into settings.svelte.ts): rules + scan progress $state

src/routes/(app)/settings/downloads/
└── +page.svelte                  # NEW route: button + rules panel + progress
```

### Pattern 1 — Extend `blobStore` native branch, not the player (D-05)

`blob-store.ts` already owns a uid → bytes contract with a never-throws posture. The device read is the same contract with a different backing store.

```ts
// src/lib/services/blob-store.ts  (sketch — 34-D-05)

/** 34-D-01: a `device:` uid is an identity NAMESPACE, not a registry source. */
function deviceContentUri(uid: string): string | null {
	// device:<volumeName>-<mediastoreId>  → content://media/<volumeName>/audio/media/<id>
	const key = uid.startsWith('device:') ? uid.slice('device:'.length) : null;
	if (!key) return null;
	const i = key.lastIndexOf('-');
	if (i <= 0) return null;
	return `content://media/${key.slice(0, i)}/audio/media/${key.slice(i + 1)}`;
}

/** Shared content-URI read — the SAME convertFileSrc + fetch path nativeGet already uses for
 *  app-private files. Works because Capacitor's WebViewLocalServer maps /_capacitor_content_
 *  back to ContentResolver.openInputStream. Never throws. */
async function readContentUri(uri: string, mime?: string): Promise<Blob | null> {
	try {
		const res = await fetch(Capacitor.convertFileSrc(uri)); // RAW fetch — local, never apiFetch
		if (!res.ok) return null;
		const blob = await res.blob();
		if (!isUsableBlob(blob)) return null;
		// Java's URLConnection.guessContentTypeFromStream only recognises ID3 → a FLAC/M4A arrives
		// with no/garbage Content-Type. `slice` re-types WITHOUT copying bytes.
		return mime && blob.type !== mime ? blob.slice(0, blob.size, mime) : blob;
	} catch {
		return null;
	}
}
```

`get()` / `has()` gain a `device:` branch before the existing app-private logic. `del()` gains a **refusal** — see the Pitfalls section.

**Why this satisfies D-05 with zero player edits:** every one of the 5 call sites does `URL.createObjectURL(blob)` on the result. A `Blob` return needs no widening. `[VERIFIED: player.svelte.ts:582, 604-607, 667-671, 3123-3129, 3336-3341]`

### Pattern 2 — Paged `scanAudio`, not one giant call

```kotlin
// MediaStoreSaverPlugin.kt (sketch — 34 scan side)
@PluginMethod
fun scanAudio(call: PluginCall) {
    if (!hasReadAudioPermission()) { requestPermissionForAlias(readAlias(), call, "scanPermsCallback"); return }
    val offset = call.getInt("offset") ?: 0
    val limit  = (call.getInt("limit") ?: 500).coerceIn(1, 1000)
    try {
        val rows = JSArray()
        // API 29+ : RELATIVE_PATH.  API <=28 : DATA LIKE (RELATIVE_PATH does not exist).
        val (selection, args) = folderSelection()
        val projection = baseProjection() + if (Build.VERSION.SDK_INT >= 30) arrayOf(ALBUM_ARTIST) else emptyArray()
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        // Deterministic order is REQUIRED for paging to be coherent.
        val sort = "${MediaStore.Audio.Media._ID} ASC LIMIT $limit OFFSET $offset"
        context.contentResolver.query(collection, projection, selection, args, sort)?.use { c ->
            while (c.moveToNext()) rows.put(rowToJs(c, collection))
        }
        call.resolve(JSObject().put("rows", rows).put("total", countMatching()).put("version", mediaStoreVersion()))
    } catch (e: Exception) { call.reject(e.message ?: "scanAudio failed") }
}
```

Notes that matter:
- `rowToJs` must emit the **full content URI** (`ContentUris.withAppendedId(collection, id).toString()`) — do not reconstruct it in TS. That is the only way SD-card / secondary volumes stay correct.
- One-dimensional array of flat dictionaries only. Capacitor Android throws `JSONArray is not a valid type` on nested arrays. `[CITED: github.com/ionic-team/capacitor issues/7747]`
- `version` = `MediaStore.getVersion(context, volumeName)` — see D-02 below.

### Pattern 3 — Guard `ensureTrackDetails` at the top, not at call sites

```ts
// src/lib/services/catalog.ts — ensureTrackDetails (currently line 345)
export async function ensureTrackDetails(track, signal?, quality?) {
	// 34-D-01: a `device:` uid is NOT in SOURCES. Line 518 does SOURCES[track.source].resolve(…)
	// — an unguarded device track TypeErrors there. The file IS the resolve: there is nothing to fetch.
	if (isDeviceUid(track.uid)) return track;
	if (isTrackReady(track)) return track;
	…
}
```

This single guard is mandatory, not optional. See "What a `device:` uid breaks".

### Anti-patterns to avoid

- **Setting `content://` or `_capacitor_content_` directly as `audio.src`.** Broken Range handling (below) makes seeking return byte-0 data; `getMimeType` on an extensionless content path likely returns `null` or a sniffed wrong type. The existing fetch→Blob→objectURL shape avoids both. Do not "optimise" it away.
- **Adding `'device'` to the `SourceId` union in `types.ts`.** `SOURCES: Record<SourceId, SourceAdapter>` (registry.ts:44) would then be structurally incomplete, and `Object.keys(SOURCES) as SourceId[]` (`onlySource`) plus `getEnabledAdapters` would silently disagree with the type. See the widening options table below.
- **Running `MediaMetadataRetriever` per file during the scan.** The columns already hold the tags; MMR is documented-slow in bulk. `[CITED: b4x.com forum — "pretty slow while retrieving information"]`
- **A second Capacitor plugin.** CONTEXT `<code_context>` already rules this out; the permission alias and the write methods belong together.
- **Adding lines to `player.svelte.ts`.** The whole point of D-05.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Streaming a device file into the WebView | A local HTTP range server, a base64 bridge transfer, a custom `WebViewClient` | `Capacitor.convertFileSrc(contentUri)` + `fetch` (already the app's native read path) | Capacitor's `WebViewLocalServer` already intercepts `/_capacitor_content_` and pipes `ContentResolver.openInputStream`. Bytes never touch the JS bridge. |
| Extracting title/artist/album/duration from audio files | `MediaMetadataRetriever` loops, a JS tag parser | The MediaStore cursor columns | The platform already ran the scanner. Free, instant, and it is literally the same data. |
| Detecting that cached MediaStore `_ID`s went stale | Heuristics (re-check every id, compare counts, hash filenames) | `MediaStore.getVersion(context, volumeName)` | Purpose-built: *"Applications that import data from MediaStore into their own caches can use this to detect that MediaStore has undergone substantial changes, and that data should be rescanned."* `[CITED: learn.microsoft.com/dotnet/api/android.provider.mediastore.getversion + developer.android.com/training/data-storage/shared/media]` |
| Incremental re-sync across imports | Full diff of every row every time | `MediaStore.getGeneration()` + `GENERATION_MODIFIED` (API 30+), with full-scan fallback | Optional optimisation; full scan is fine at this scale. Note it, don't necessarily build it. |
| Album art for a `device:` entry | Decoding embedded APIC frames in JS | `ContentResolver.loadThumbnail(albumUri, Size, null)` on API 29+ | `Albums.ALBUM_ART` is deprecated and **always null** since API 29. `[CITED: coil-kt/coil issue 922, bumptech/glide issue 4066]` |
| Bracketed-tag / feat. stripping for filename parsing | A new regex chain | `src/lib/services/match-key.ts` `norm()` (lines 23-30) | Already strips `(Live)` / `[Remaster]` / `【…】` / `- feat.` and is CJK-aware. Reuse the regexes verbatim or import the module. |
| Filesystem-safe name handling | A new sanitizer | `src/lib/services/download-filename.ts` `buildDownloadFilename` / `extFromAudioUrl` | The inverse direction, already decided (CJK, punctuation, `AUDIO_EXT = /\.(mp3\|flac\|m4a\|aac\|ogg\|wav)$/i`). The D-12 extension checkbox list should be **that same set** unless there's a reason to diverge. |
| Same-song matching for the D-09 merge | A new fuzzy matcher | `matchKey(artist, title)` + the `library.adoptCover` precedent (library.svelte.ts:94-115) | Already the app's cross-uid identity bridge. D-03 forbids catalog linking, but D-09's merge is app-own-files only — narrow and safe. |
| "Is this uid downloaded / is the copy real" | A new predicate | `library.isDownloaded(uid)` + `blobStore.has(uid)` | quick-260913-jq4 already established the two-part truth model. `has()` must gain the device branch or the badge lies. |

**Key insight:** the only genuinely new code in this phase is the Kotlin cursor query, the filename-parse rules, and the re-sync diff. Everything else is a branch inside something that already works. Treat any design that adds a parallel storage concept, a second plugin, or a new playback path as a signal you've left the ladder.

---

## Runtime State Inventory

This is an **additive feature**, not a rename/refactor/migration — but it *creates* runtime state, and two of these categories are actively dangerous. Recorded for the same reason.

| Category | Items | Action required |
|----------|-------|-----------------|
| Stored data | `openmusic:library:v1` gains `device:` entries in `downloads: Track[]`. Persisted `Track` shape must round-trip. | Verify `JSON.parse` of an old payload + new entries co-exist. No migration needed — `load()` is tolerant (`v.downloads ?? []`). |
| Stored data | `openmusic-blob-uri:<uid>` localStorage index — D-09 merge writes real-source content URIs here; D-05 may write device ones. | **DANGER** — see `nativeDel` below. If a `device:` uid ever lands in this index, `removeDownload` deletes the user's file. |
| Live service config | None — no external service holds import state. | None. Verified: no n8n/Datadog/Cloudflare surface touches this phase. |
| OS-registered state | New runtime permission grant (`READ_MEDIA_AUDIO`) persists in the OS per-app until revoked. Denial with "don't ask again" is sticky. | Plan must handle permanent-denial (deep-link to app settings, or an honest message). |
| Secrets / env vars | None. No new secret, no `.dev.vars` change, no Cloudflare binding. | None. |
| Build artifacts | `AndroidManifest.xml` gains `<uses-permission>` entries → requires a new APK. Kotlin plugin change → `pnpm apk` rebuild (`JAVA_HOME=/opt/homebrew/opt/openjdk@21/…`). Web build is unaffected. | Rebuild + reinstall APK for any verification. Nothing in `.svelte-kit/cloudflare` changes behaviourally. |
| **Device-side state the app does NOT own** | The user's actual audio files in `Music/` and `Download/`. | **Never mutated by this phase.** D-04 says play in place; D-06 says keep unavailable entries. Any code path that can delete one is a bug. |

---

## Common Pitfalls

### Pitfall 1 (CRITICAL): `removeDownload` on a device entry deletes the user's music file

**What goes wrong:** `library.removeDownload(uid)` (library.svelte.ts:185-191) unconditionally calls `void blobStore.del(uid)`. `nativeDel` (blob-store.ts:168-185) reads `getStoredUri(uid)` from `openmusic-blob-uri:<uid>` and calls `MediaStoreSaver.deleteFromMusic({ uri })`, which on a `content://` URI does `contentResolver.delete(uri, null, null)` (MediaStoreSaverPlugin.kt:208-211). A MediaStore delete of an audio row **deletes the file**.

**Why it happens:** the natural implementation of both D-05 and D-09 is "store the content URI in the existing uri index." That index was designed for files *the app created and therefore owns*. Imported files are the user's.

**How to avoid:** two independent guards, both tested.
1. `nativeDel` returns early for a `device:` uid — remove the library record and any index entry, never call `deleteFromMusic`.
2. For the D-09 merge lane (real-source uid, app-created file in `Music/OpenMusic/`), deleting IS correct and pre-existing behaviour — leave it. But the merge must only ever write URIs for files under `Music/OpenMusic/`, never for a file found elsewhere.

**Warning signs:** a test that asserts `deleteFromMusic` is *not* called for a `device:` uid is the cheapest possible insurance. Write it first.

`[VERIFIED: library.svelte.ts:185-191, blob-store.ts:168-185, MediaStoreSaverPlugin.kt:197-226]`

---

### Pitfall 2 (CRITICAL): Capacitor's HTTP Range handling returns byte 0 for every range request

**What goes wrong:** `WebViewLocalServer.handleLocalRequest` (lines 339-377) sees a `Range` header, computes `totalRange = responseStream.available()`, writes `Content-Range: bytes <from>-<to>/<total>` — and then returns **`responseStream` itself, never skipped to `<from>`**. The stream is a fresh `ContentResolver.openInputStream` / `FileInputStream` positioned at byte 0. So a seek in `<audio>` gets byte-0 data labelled as if it were from the offset.

**Why it happens:** it's an upstream Capacitor bug, present in 8.4.0. It also uses `int` for `available()` (2 GB ceiling) and `available()` is not a contractual file-size call for content streams.

**How to avoid:** **never** put a `_capacitor_content_` / `_capacitor_file_` URL directly in `audio.src`. Keep the existing `fetch(...)` → `res.blob()` → `URL.createObjectURL(blob)` shape — a `blob:` URL is served by Chromium's own blob storage, which implements Range correctly, so seeking works. This is also why the existing native download path works today.

**Cost of the workaround:** the whole file is materialised as a Blob before playback starts. See Pitfall 3.

**Warning signs:** on device, playback starts fine but the scrubber jumps back to the start / audio glitches after a seek. If you see that, someone bypassed the Blob.

`[VERIFIED: node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/WebViewLocalServer.java:339-377 — read directly]`

---

### Pitfall 3: Whole-file buffering for large lossless imports

**What goes wrong:** `readContentUri` pulls a 50 MB FLAC into a Blob before `<audio>` sees a byte.

**Nuance (this is less bad than it looks):**
- This is **already the behaviour** for every native app-download (`nativeGet`, blob-store.ts:135-153). The phase is not introducing a new class of problem.
- Chromium Blobs above a small threshold live in the browser process's blob storage (which pages to disk), not the renderer's JS heap. A 50 MB Blob is not 50 MB of JS heap. `[ASSUMED — Chromium implementation detail, not verified in this session]`
- The read is from local storage, not network: ~0.1-0.3 s for 50 MB on modern flash, versus the ~5.5 s measured cold-start budget for a streamed track. Device import should feel *faster* than streaming, not slower.
- The 24 MB `PREBUFFER_MAX_BYTES` ceiling (32-D-15) exists for *network prebuffer of the next track*, a different concern — do not reuse that number here.

**How to avoid making it worse:** do not add a second copy (D-04 already forbids it), do not re-type via `new Blob([await res.arrayBuffer()], …)` (that *does* double peak memory) — use `blob.slice(0, blob.size, mime)`, which re-types without copying.

**Flag for device verification:** a >100 MB file (a long DJ set, a lossless live album) on a 2-3 GB RAM phone is the realistic failure case. **Test with the largest file you can find.** If it OOMs, the fallback is (a) a size ceiling above which the entry is listed but marked "too large to play offline", or (b) accepting broken seek and using the direct `_capacitor_content_` src for oversize files only. Do not design for this pre-emptively.

`[VERIFIED: blob-store.ts:135-153 establishes the existing precedent | ASSUMED: Chromium blob paging, memory outcome]`

---

### Pitfall 4: MIME type from the local server is wrong or absent

**What goes wrong:** `getMimeType(path, stream)` (WebViewLocalServer.java:547-568) tries `URLConnection.guessContentTypeFromName(path)` — a content path like `/_capacitor_content_/media/external/audio/media/1234` has no extension, so that returns null — then falls back to `guessContentTypeFromStream`, which in the JDK recognises `ID3` (→ `audio/mpeg`) but **not** FLAC (`fLaC`), M4A (`ftyp`), or Ogg. So a FLAC arrives with `Content-Type: null` → `Blob.type === ''`.

**Why it mostly works anyway:** Chromium's media stack content-sniffs `blob:` sources. Empty type generally still plays.

**How to avoid:** pass `MIME_TYPE` from the scan row through to `readContentUri` and `blob.slice(0, blob.size, mime)`. One line, removes the whole class of doubt.

`[VERIFIED: WebViewLocalServer.java:547-568 | ASSUMED: Chromium media sniffing behaviour on empty-type blobs]`

---

### Pitfall 5: `_ID` stability is weaker than D-02 assumes — but `getVersion()` fixes it

**What D-02 claims:** `_ID` survives a move/rename within the same volume; does not survive factory reset / SD reinsert.

**What the evidence actually supports:**
- **HIGH confidence, from the platform's own guidance:** Android explicitly tells apps that cache MediaStore data to compare `MediaStore.getVersion(context, volumeName)` and rescan when it changes — *"Applications that import data from MediaStore into their own caches can use this to detect that MediaStore has undergone substantial changes, and that data should be rescanned"* / *"if your app caches URIs or data from the media store, you should check whether the media store version has changed compared to when you last synced."* The existence of this API is itself the platform admitting `_ID` is **not** unconditionally durable. `[CITED: learn.microsoft.com/dotnet/api/android.provider.mediastore.getversion; developer.android.com/training/data-storage/shared/media]`
- **MEDIUM confidence:** on Android 11+ (FUSE), MediaProvider intercepts filesystem renames and updates the existing row in place, so `_ID` survives a rename done by a file manager. On Android 10 and below there is no FUSE interception; an external rename can produce a new row and orphan the old one, i.e. `_ID` **changes**. `[ASSUMED — consistent with MediaProvider's architecture, not verified against docs or device this session]`
- **HIGH confidence:** `MediaStore.getVersion()` can return null if the volume is not mounted, and callers should check `getExternalVolumeNames(context)` first. `[CITED: same source]`

**Verdict: D-02 does NOT need correcting, but it needs a companion.** The decision is sound; the gap is that D-02 has no way to *detect* the "accepted cost" case. Without `getVersion`, after a factory reset / SD reinsert the library holds `device:` uids that now point at **different songs** — silently. That is worse than the entries disappearing.

**Recommendation for the planner:** store the `getVersion()` string returned by `scanAudio` alongside the import index (e.g. `openmusic:device-import:v1`). On import, if the stored version differs from the current one, treat **every** existing `device:` entry as unverified and re-match by content (`displayName` + `size` + `durationMs`) rather than by `_ID`. This is a small, bounded addition that turns a silent-corruption case into a handled one. It is not a re-litigation of D-02 — it is what makes D-02's accepted cost actually acceptable.

**Second-order note:** `_ID` is unique **per volume**, not globally. Recommend the uid key be `device:<volumeName>-<_ID>`, using the `-` separator precedent already in the codebase (`fivesing` folds `${songtype}-${songid}` into songid for exactly this reason — types.ts:75-78). `makeUid('device' as …, \`${volumeName}-${id}\`)` keeps the colon-form contract intact.

---

### Pitfall 6: Including an API-30 column in the projection crashes on API 24-29

**What goes wrong:** `ContentResolver.query` throws `IllegalArgumentException: Invalid column album_artist` when a column doesn't exist on that platform version.

**Column availability (mark and verify):**

| Column | API | Confidence |
|--------|-----|-----------|
| `_ID`, `TITLE`, `ARTIST`, `ALBUM`, `ALBUM_ID`, `ARTIST_ID`, `TRACK`, `YEAR`, `IS_MUSIC`, `DATA`, `DISPLAY_NAME`, `SIZE`, `MIME_TYPE`, `DURATION` | 1 (DURATION moved to MediaColumns at 29) | `[ASSUMED]` |
| `RELATIVE_PATH`, `VOLUME_NAME`, `BUCKET_DISPLAY_NAME`, `IS_PENDING`, `IS_DOWNLOAD`, `OWNER_PACKAGE_NAME` | 29 | `[CITED: developer.android.com/training/data-storage/shared/media — "use the DISPLAY_NAME and RELATIVE_PATH columns"]` |
| `ALBUM_ARTIST`, `GENRE`, `BITRATE`, `CD_TRACK_NUMBER`, `DISC_NUMBER`, `NUM_TRACKS`, `COMPOSER`, `WRITER`, `GENERATION_MODIFIED` | 30 | `[ASSUMED]` |
| `DATA` **deprecated** (for writes) at 29; still readable | 29 | `[CITED: same doc — "For reading existing files you can use the DATA column value… For creating/updating, don't use the DATA column"]` |

**How to avoid:** build the projection with a `Build.VERSION.SDK_INT` guard. minSdk is 24, targetSdk/compileSdk 36. `[VERIFIED: android/variables.gradle:2-4]`

**Lazy alternative worth considering:** since >99% of the 2026 install base is API 29+, the planner may reasonably scope the scan to `Build.VERSION.SDK_INT >= Q` and return an empty result with a typed sentinel below that — one branch instead of two column sets and two selection clauses. Phase 29's own RESEARCH concluded "the API ≤28 branch is effectively dead but harmless to leave", so precedent exists for either call. This is a planner decision; document whichever is chosen.

---

### Pitfall 7: Does `READ_MEDIA_AUDIO` actually expose audio in `Download/`?

**The ambiguity.** D-11 requires scanning `Download/`. Android's docs say granular media permissions grant access to *"media files that other apps have created"*, which is media-**type** scoped, not folder scoped — so an `.mp3` in `Download/` should appear in `MediaStore.Audio.Media` and be readable. But the same docs also say *"If your app wants to access a file within the `MediaStore.Downloads` collection that your app didn't create, you must use the Storage Access Framework"* — and an audio file in `Download/` is a member of **both** collections (`is_download=1`, `media_type=AUDIO`).

**Assessment (MEDIUM confidence):** querying via `MediaStore.Audio.Media` with `READ_MEDIA_AUDIO` should return and permit reading those rows — the SAF requirement applies to the Downloads collection URI and to non-media files. Real music players do surface Download-folder tracks. But this is exactly the kind of claim this project has been burned by.

**How to avoid the trap:** make this an explicit device-verification checkpoint, not an assumption baked into the plan. Concrete check: put an `.mp3` in `Download/` via a browser download, run the scan, assert it appears **and plays**. If reading fails, the documented fallback is to also query `MediaStore.Downloads.EXTERNAL_CONTENT_URI` — but if *that* also refuses for other apps' files, D-11's Download half is not deliverable without SAF, and that is a CONTEXT-level correction, not an implementation detail.

`[CITED: developer.android.com/about/versions/13/behavior-changes-13; developer.android.com/training/data-storage/shared/media | MEDIUM — sources are consistent but the collection-overlap case is not addressed head-on in any of them]`

---

### Pitfall 8: ReDoS in the D-12 raw-regex escape hatch

**What goes wrong:** the user pastes a pattern with nested quantifiers (`(\w+\s?)+-`). The scan runs it over 3000 filenames. One pathological filename hangs the single-threaded WebView indefinitely. No Web Workers are available (CLAUDE.md architectural constraint), JS `RegExp` has no timeout, and a runtime dependency is forbidden.

**How to avoid — three cheap, dependency-free layers:**
1. **Validate at save, not at scan.** When the user saves a custom pattern, compile it (`try { new RegExp(src) } catch` → reject with a message), require at least one of the named groups `title|artist|album|track`, then run it against a small battery of adversarial strings (e.g. `'a'.repeat(48) + '!'`, `'a b '.repeat(24) + '!'`, 48 chars drawn from the pattern's own literal characters) inside a `performance.now()` budget of ~50 ms. Over budget → refuse to save. This catches the realistic case (a pattern copied off the internet) without pretending to be a decision procedure.
2. **Budget-abort during the scan.** Check `performance.now()` every ~100 files; if the parse pass exceeds e.g. 2 s total, abort the custom pattern for the whole run, fall back to the D-13 preset, and surface a toast. Bounds the damage to one budget instead of a hang.
3. **Presets are never user regexes.** The D-12 checkbox presets compile to fixed, audited patterns. Only the escape-hatch field is untrusted. Most users never touch it, so the worst case is rare by construction.

Explicitly **not** recommended: input-length capping alone (filenames are ≤255 bytes, but catastrophic backtracking is exponential — 255 chars is still astronomically slow), and heuristic pattern rejection (brittle, rejects legitimate patterns).

`[ASSUMED — ReDoS mitigation design; no dependency was evaluated because CLAUDE.md forbids one. The 50 ms / 2 s numbers are starting points, not measured.]`

---

### Pitfall 9: Bridge payload size on a large library

**What goes wrong:** 3000 rows × ~250 bytes of JSON ≈ 750 KB crossing `androidBridge` as one string, then `JSON.parse`. Capacitor's own docs warn that *"parsing and transferring large amount of data from native to the web can cause issues"*, and community reports describe *"a massive performance hit when sending large JSON objects"*. Android also rejects nested arrays outright (`JSONArray is not a valid type`).

**How to avoid:** page it. `scanAudio({ offset, limit })` with `limit` default **500** (~125 KB/call, ~6 calls for 3000 files). Paging delivers three things at once: a bounded payload, a natural progress signal (`offset / total`), and a supersedable loop (a second import tap can bump a generation counter and stop the walk — the project's established idiom). Do **not** build a `notifyListeners` event stream; paging gives the same UX for less code.

`[CITED: capacitorjs.com docs; github.com/ionic-team/capacitor issues/7747 | the 500 figure is ASSUMED — tune on device]`

---

### Pitfall 10: `player.play()` falls through to `ensureTrackDetails` when the offline read misses

**What goes wrong:** the offline-blob branch at `player.svelte.ts:3122` early-returns on a hit — so the happy path never calls `ensureTrackDetails` for a device track. But on a **miss** (D-06: the file was deleted), execution falls through past line 3193 to `preconnectForSource(track.source)` (3212) and then to `SOURCES[track.source].resolve(...)` via `catalog.ts:518` → `SOURCES['device']` is `undefined` → TypeError → the player's error path.

`preconnectForSource` is harmless (`hosts.get('device')` → `undefined` → no-op, preconnect.ts:70-73). `catalog.ts:518` is not.

**How to avoid:** the Pattern-3 guard at the top of `ensureTrackDetails`. With it, a missing device file returns the unresolved track with `audioUrl` pointing at a dead content URI — which the player already treats as a failed resolve and routes to its error/fallback path. D-06 then needs the *library* to mark the entry unavailable rather than the player to evict it.

**Second required change for D-06:** `player.svelte.ts:2095-2102` evicts a corrupt download (`blobStore.del` + `library.removeDownload`). That is correct for an app blob and wrong for a device file. Since D-05's whole thesis is "fix the shared function", the cleanest guard is inside `blobStore.del` (Pitfall 1) — `removeDownload` still drops the library row, so a second guard is needed in the player branch or in `library.removeDownload` itself to honour "keeps it listed". Recommend the guard live in `library.removeDownload` (one place, both callers covered), with the player branch left untouched.

`[VERIFIED: player.svelte.ts:2095-2102, 3122-3193, 3212; catalog.ts:345, 518; preconnect.ts:70-73]`

---

## What a `device:` uid breaks — the bite list

Every site that consumes `track.source` or `track.uid`, with the verdict.

| # | Site | file:line | Behaviour with `source: 'device'` | Verdict |
|---|------|-----------|-----------------------------------|---------|
| 1 | `SOURCES[track.source].resolve(...)` | `src/lib/services/catalog.ts:518` | **TypeError** — `SOURCES['device']` is undefined | **MUST GUARD.** Early return at `ensureTrackDetails` (catalog.ts:345). |
| 2 | `blobStore.del` → `deleteFromMusic` | `src/lib/services/blob-store.ts:176-184` | **Deletes the user's file** if the content URI is in the uri index | **MUST GUARD.** Pitfall 1. |
| 3 | `library.removeDownload` | `src/lib/stores/library.svelte.ts:185-191` | Drops the entry — violates D-06 "keeps it listed" | **MUST GUARD.** Add an `unavailable` marker path. |
| 4 | `blobStore.has(uid)` | `blob-store.ts:286-300` → `nativeHas` `Filesystem.stat('downloads/device_…')` | Always `false` → download badge/`DownloadControl` lies (the exact bug quick-260913-jq4 fixed) | **MUST EXTEND.** D-05 names `get()` only; `has()` needs the branch too. |
| 5 | `isTrackReady` / `hasFreshAudioUrl` | `src/lib/services/track-ready.ts:52-65` | `resolvedAt` ages out after 15 min (`RESOLVE_URL_TTL_S`) → a device track becomes "stale" and triggers a re-resolve | Covered by guard #1, but note the semantic mismatch: a local file never expires. Do not try to keep `resolvedAt` fresh by stamping it — guard instead. |
| 6 | `fallbackOrder` / `runFallback` | `src/lib/services/fallback.ts:50` | `SOURCES[s].autoResolveEligible` — iterates `getEnabledAdapters()`, which is built from `SOURCES`, so `'device'` never enters the list. The `failed` source being `'device'` is harmless (`s !== failed` just never matches). | **SAFE.** But a failed device play would cross-source-fallback to a *streamed* version of the song — arguably wrong for D-06 ("the user sees why it won't play"). Planner should decide whether to bar fallback for device tracks. |
| 7 | `preconnectForSource(track.source)` | `player.svelte.ts:3212`, `preconnect.ts:70` | `hosts.get('device')` → undefined → returns | **SAFE.** |
| 8 | `prebufferNext` | `player.svelte.ts:2864` | `library.isDownloaded(track.uid)` → true → early return | **SAFE** — correct by accident, device files are never prebuffered. |
| 9 | `logAction('play', { source })` / `history-logic.ts:39` | `player.svelte.ts:3016`; `src/lib/history/history-logic.ts:39` | Records the string `'device'` | **SAFE** — cosmetic. |
| 10 | Share links | `src/lib/services/share.ts:423-424` `ENTITY_SOURCE_RE` | Hardcoded `(netease\|qq\|kuwo\|joox\|fivesing\|jamendo)` — **already stale** (`audius`/`ytmusic` missing). A `device:` share URL would not decode. | **ACCEPT + note.** Sharing a local file is meaningless anyway; the share affordance should be hidden for `device:` entries. The pre-existing `audius`/`ytmusic` staleness is out of scope. |
| 11 | `downloadTrack()` | `src/lib/services/download-track.ts:93` | Calls `ensureTrackDetails` (guarded by #1 → returns the track), then `fetch(r.audioUrl)` on a `content://` URL → throws → `'failed'` sentinel | **SAFE (never-throws holds)** but nonsensical UX. Hide the Download affordance for `device:` entries. |
| 12 | `dedupe.ts` `SOURCE_RANK` / `preferred` | `src/lib/services/dedupe.ts:79-80` | Only runs over search results; device tracks never enter search | **SAFE.** |
| 13 | Cover resolution chain | `cover-cache.ts` / `cover-version.svelte.ts` / `lazyCover` | `readCoverByUidOrName` → `uid:device:…` miss → `matchKey` name layer → may resolve a Deezer/iTunes cover for a device track | **SAFE and arguably desirable** — gives imported tracks art for free with zero new code. This is the cheapest answer to the D-"cover art" discretion item. |
| 14 | `Track.source: SourceId` type | `src/lib/sources/types.ts:27-32` | `'device'` is not in the union | **DESIGN DECISION** — see below. |

### The `SourceId` widening decision (a real fork the planner must settle)

| Option | Shape | Cost | Assessment |
|--------|-------|------|------------|
| **A. Widen the union** | `SourceId = … \| 'device'` | `SOURCES: Record<SourceId, SourceAdapter>` (registry.ts:44) becomes a **compile error** (missing key) — you'd have to make it `Partial<Record<…>>`, which then makes `SOURCES[track.source].resolve` (catalog.ts:518) fail strict null checks everywhere. Also pollutes `onlySource`, `getEnabledAdapters`, `settings.enabledSources`. | **Rejected.** Breaks the registry's central invariant to serve one non-source. |
| **B. Separate field on the union** | `Track.source: SourceId \| 'device'` inline at the one field | Same downstream null-safety cascade at catalog.ts:518, just localised | Half-measure, same cost |
| **C. Keep `source` as a real `SourceId` placeholder; identity lives in `uid`** | `uid: 'device:external_primary-1234'`, `source: 'kuwo'` (or any), guarded by `isDeviceUid(uid)` | Zero type changes. **Exact precedent exists:** `resolveByName` name-stubs do this — `similar.ts:140` comments *"source, // placeholder — resolveByName short-circuits dispatch (never SOURCES[source].resolve)"*. | **RECOMMENDED.** It is the house pattern for "a Track that isn't from a source", already blessed by types.ts:86-92. |
| **D. Option C + an explicit marker field** | C, plus `device?: true` (additive/optional, like `resolveByName`, `lrcUnresolved`, `fivesingSongType`) | One optional field; makes intent readable and testable without string-sniffing uids | **RECOMMENDED as the refinement of C.** Matches the additive-optional-field convention documented four times in `types.ts`. |

Recommend **D**: add `device?: true` to `Track` alongside `resolveByName`/`lrcUnresolved`, keep `source` a placeholder, and export `isDeviceUid(uid)` from the new pure module so string-sniffing lives in exactly one place.

`[VERIFIED: types.ts:17-104, registry.ts:44-63, similar.ts:140, catalog.ts:497-518]`

---

## Code Examples

### Folder filter across API levels (D-11)

```kotlin
// API 29+: RELATIVE_PATH exists and is the documented column. Values carry a TRAILING slash,
// e.g. "Music/", "Music/OpenMusic/", "Download/". LIKE 'Music/%' therefore covers both the
// top-level folder and every subfolder.
private fun folderSelection(): Pair<String, Array<String>> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // IS_MUSIC is the platform's own "this is a song, not a ringtone/notification/alarm"
        // flag — it complements the folder filter rather than replacing it (D-11).
        "(${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? OR ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?)" to
            arrayOf("${Environment.DIRECTORY_MUSIC}/%", "${Environment.DIRECTORY_DOWNLOADS}/%")
    } else {
        @Suppress("DEPRECATION")
        "(${MediaStore.Audio.Media.DATA} LIKE ? OR ${MediaStore.Audio.Media.DATA} LIKE ?)" to
            arrayOf("%/${Environment.DIRECTORY_MUSIC}/%", "%/${Environment.DIRECTORY_DOWNLOADS}/%")
    }
```

### Permission alias, following the existing `publicMusicPermsCallback` pattern

```kotlin
@CapacitorPlugin(
    name = "MediaStoreSaver",
    permissions = [
        Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "publicMusic"),
        // 34: READ side. Two aliases because the annotation cannot express an SDK condition —
        // the plugin picks the right one at call time (mirrors saveToMusic's SDK_INT branch).
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO],       alias = "readAudio33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE],  alias = "readAudioLegacy")
    ]
)
```

```xml
<!-- AndroidManifest.xml — READ_EXTERNAL_STORAGE must be capped at 32 or the Play/lint
     tooling flags it; on 33+ it is ignored by the platform anyway. -->
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                 android:maxSdkVersion="32" />
```

Denial handling (the CONTEXT leaves the flow to discretion, this is the recommendation):
- **Soft denial** → `{ status: 'denied' }` sentinel, toast, no crash, button stays tappable.
- **Permanent denial** ("Don't ask again") → the alias state stays `DENIED` and the system dialog no longer shows. Surface an honest message pointing at App info → Permissions. Do not silently retry in a loop.
- **No partial-access state exists for audio.** Android 14's user-selected-media flow (`READ_MEDIA_VISUAL_USER_SELECTED`) is **images and video only** — there is no audio equivalent, so audio is binary grant/deny. `[CITED: developer.android.com/about/versions/13/behavior-changes-13 + the Android 16 note that selected-media applies to "photos and videos" — MEDIUM confidence on the negative claim; no doc states an audio equivalent exists and none appears in the permission list]`

### Reusable bracket/feat. stripping for D-12 presets

```ts
// src/lib/services/match-key.ts:23-30 — ALREADY WRITTEN. Import it or lift the regexes.
.replace(/[（(【\[].*?[)）\]】]/g, ' ')                              // (Live) [Remaster] 【...】
.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
```

D-12's "strip bracketed tags like `[Official MV]`" is the first line, already CJK-bracket-aware. Do not write a second one.

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|--------------|------------------|--------------|-------------|
| `READ_EXTERNAL_STORAGE` for all media | `READ_MEDIA_AUDIO` / `_IMAGES` / `_VIDEO` | Android 13 / API 33 | Two aliases, runtime branch. targetSdk 36 means the granular permission is mandatory. |
| `MediaColumns.DATA` (absolute path) | `RELATIVE_PATH` + `DISPLAY_NAME` | API 29 | Deprecated for writes; still readable. Folder filter branches on SDK. |
| `Audio.Albums.ALBUM_ART` (file path column) | `ContentResolver.loadThumbnail(uri, Size, null)` | API 29 — `ALBUM_ART` is **always null** since | Album art must come from `loadThumbnail`, never the column. |
| Legacy public-dir writes (`getExternalStoragePublicDirectory`) | Scoped storage / MediaStore collections | API 29 | Already handled by the existing plugin's SDK branch. |
| Ad-hoc cache invalidation | `MediaStore.getVersion()` / `getGeneration()` | API 29 / 30 | The documented answer to D-02's stability gap. |

**Deprecated / stale in this repo (noted, not necessarily in scope):**
- `share.ts:423-424` `ENTITY_SOURCE_RE` is missing `audius` and `ytmusic` — a pre-existing decode bug for those sources' share links. Out of scope, but a device share link would land in the same hole.
- Phase 29's D-03 (move downloads `Music/OpenMusic/` → `Download/openmusic/` via the `MediaStore.Downloads` collection) was **planned but never executed** — `29-05-PLAN.md` / `29-06-PLAN.md` have no SUMMARY, `relocateToDownloads` does not exist, and `MediaStoreSaverPlugin.kt:51` still reads `"${Environment.DIRECTORY_MUSIC}/OpenMusic/"`. **This is load-bearing for D-09:** the app's own files are in `Music/OpenMusic/` *today*, exactly as D-09 states. If Phase 29's remaining plans ever land, D-09's merge lane must follow the folder. `[VERIFIED: ls .planning/phases/29-download-ux-folder-control/, MediaStoreSaverPlugin.kt:51, grep for relocateToDownloads = no hits]`

---

## Where the Settings download UI lives — answer: it doesn't

**There is no `/settings/downloads` route and no "download page".** Verified by directory listing: `src/routes/(app)/settings/` contains `+page.svelte` (the index) plus `about/ activity/ appearance/ data/ general/ home/ lastfm/ playback/ translation/` and nothing else.

Download-related UI is scattered across two existing pages:

| Where | What | file:line |
|-------|------|-----------|
| `/settings/playback` | `<h2><Download size={15}/> {t('settings.downloadQuality')}</h2>` + the quality chip row | `src/routes/(app)/settings/playback/+page.svelte:88-94` |
| `/settings/data` | Library counts including `downloads`, clear-library action | `src/routes/(app)/settings/data/+page.svelte:16-52` |

Phase 29's own D-14 designated **Settings → Data** for its (never-built) native migration button.

**Recommendation: create `src/routes/(app)/settings/downloads/+page.svelte`.** Reasons:
1. The CONTEXT says "the Settings download page" five times — the user's mental model already has one.
2. The import button + a four-section rules panel (parsing, min duration, extensions, skip rules) is far too much surface to bolt onto `/settings/playback`, whose download section is currently four lines.
3. The index page's `groups` array (settings/+page.svelte:14-24) makes adding a route a 1-line change plus 2 i18n keys × 16 locales.
4. It gives `downloadQuality` an obvious future home (moving it is optional and out of scope — do **not** move it in this phase, that's churn).

**i18n cost, budget for it:** `settings.groupDownloads` + `settings.groupDownloadsDesc` + the panel's own keys (~12-18 strings), each × 16 locale files, **double quotes**, identical key sets enforced by `i18n.test.ts`. `en.ts` defines `TranslationKey`, so a missing key in `en` is a compile error and a missing key elsewhere is a test failure.

`[VERIFIED: ls -R src/routes/(app)/settings/; settings/+page.svelte:14-24; playback/+page.svelte:88-94; data/+page.svelte:16-52; src/lib/i18n/ listing]`

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tooling | ✓ | >=22 (`.nvmrc`) | — |
| pnpm | tooling | ✓ | 8.15.5 pinned | — |
| Vitest | unit tests | ✓ | ^4.1.3, node-only project | — |
| Capacitor CLI + `android/` platform | APK build | ✓ | 8.4.0 | — |
| JDK 21 | `pnpm apk` | ✓ but **not on `java_home`** | Homebrew `openjdk@21` | `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk` — documented in STATE.md, deliberately not committed |
| Android device or emulator with audio files in `Music/`+`Download/` | **All** device verification | ⚠ emulator available (`Pixel_3a_API_34` AVD + CDP per project memory); real device required for the memory/large-file case | API 34 | Emulator covers permission flow, cursor query, content-URI playback. It does **not** cover low-RAM OOM, SD-card volumes, or OEM MediaProvider quirks. |
| `svelte-check` | the only quality gate | ✓ | `pnpm check` | — |

**Missing with no fallback:** nothing blocks *implementation*. **Verification** of Pitfalls 2, 3, 5 and 7 cannot be done in this sandbox or in CI — they are device-only.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. `[VERIFIED]`

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3, single `server` project, `environment: 'node'`, **no jsdom** |
| Config file | `vite.config.ts:6-22` (`expect.requireAssertions: true` — every test MUST assert) |
| Include glob | `src/**/*.{test,spec}.{js,ts}` (covers `*.svelte.test.ts`) |
| Quick run command | `pnpm vitest --run src/lib/services/device-import.test.ts` |
| Full suite command | `pnpm test` (≈1320 tests) |
| Type gate | `pnpm check` (`svelte-kit sync && svelte-check`) — the only linter |

### Decision → test map

| Decision | Behaviour | Test type | Automated command | File exists? |
|----------|-----------|-----------|-------------------|--------------|
| D-12/D-13/D-16 | `{artist} - {title}` preset parses; other presets; strip-track-number; strip-brackets; untagged→filename title | unit (pure) | `pnpm vitest --run src/lib/services/device-filename.test.ts` | ❌ Wave 0 |
| D-12 regex hatch | invalid pattern rejected; missing named group rejected; slow pattern rejected within budget | unit (pure) | same file | ❌ Wave 0 |
| D-15 | MediaStore tag wins over a filename that would parse differently; empty tag falls back to filename | unit (pure) | `pnpm vitest --run src/lib/services/device-track.test.ts` | ❌ Wave 0 |
| D-01/D-02 | uid shape `device:<volume>-<id>`; `isDeviceUid` round-trip; content-URI reconstruction | unit (pure) | same file | ❌ Wave 0 |
| D-07/D-08 | re-sync diff: new added, missing dropped, transient-failure NOT treated as gone | unit (pure) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ Wave 0 |
| D-09/D-10 | `Music/OpenMusic/` row merges onto an existing real-source uid, does NOT create a 2nd entry, does NOT churn cover/album | unit (pure) | same file | ❌ Wave 0 |
| D-11 | rows outside Music/Download are filtered out (given the plugin returns them) | unit (pure) | same file | ❌ Wave 0 |
| D-12 min-duration / extensions | filter honours min duration and the extension allowlist | unit (pure) | same file | ❌ Wave 0 |
| D-05 | `blobStore.get('device:…')` reads via `convertFileSrc` + fetch and returns a re-typed Blob; a fetch failure → `null` (never throws) | unit (mocked Capacitor) | `pnpm vitest --run src/lib/services/blob-store.test.ts` | ✅ **extend existing** |
| **Pitfall 1** | `blobStore.del('device:…')` **never** calls `deleteFromMusic` | unit (mocked) | same file | ✅ extend |
| Bite #4 | `blobStore.has('device:…')` is truthful (true when readable, false when gone) | unit (mocked) | same file | ✅ extend |
| Bite #1 | `ensureTrackDetails` on a device track returns it untouched and never touches `SOURCES` | unit | `pnpm vitest --run src/lib/services/catalog.test.ts` | ✅ extend |
| D-06 | `library.removeDownload` on a device uid keeps the entry listed and marks it unavailable | unit | `pnpm vitest --run src/lib/stores/library.svelte.test.ts` | ❔ check |
| D-14 | defaults produce a working import with no configuration | unit (pure, defaults object) | `pnpm vitest --run src/lib/services/device-import.test.ts` | ❌ Wave 0 |
| i18n | new keys present and identical across all 16 locales | unit | `pnpm vitest --run src/lib/i18n/i18n.test.ts` | ✅ exists |

### Sampling rate
- **Per task commit:** the relevant single-file `pnpm vitest --run <file>` + `pnpm check`
- **Per wave merge:** `pnpm test`
- **Phase gate:** `pnpm test` green + `pnpm check` clean + the device UAT matrix below

### Wave 0 gaps
- [ ] `src/lib/services/device-filename.test.ts`
- [ ] `src/lib/services/device-track.test.ts`
- [ ] `src/lib/services/device-import.test.ts`
- [ ] Check whether `src/lib/stores/library.svelte.test.ts` exists; create if not
- [ ] Framework install: **none needed**

### Established Capacitor-boundary mocking pattern — copy it, don't invent one

`src/lib/services/blob-store.test.ts:19-70` is the template and it covers everything this phase needs:

```ts
vi.mock('$app/environment', () => ({ browser: true }));
const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: () => isNativePlatform(),
		convertFileSrc: (uri: string) => `http://localhost/_capacitor_file_${uri}`
	}
}));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { getUri, deleteFile, stat }, Directory: { Data: 'DATA' } }));
vi.mock('./media-store', () => ({ MediaStoreSaver: { saveToMusic, deleteFromMusic } }));
// + a localStorage shim (installLocalStorageShim, same file)
```

Extend that mock's `convertFileSrc` to also handle `content://` (`content:/` → `/_capacitor_content_`) and add a `scanAudio` mock to the `./media-store` factory. A stubbed `global.fetch` returning a sized `Blob` completes the device-read test with **zero** device involvement.

### Device-UAT-only (not automatable — flag every one as a `checkpoint:human-verify`)

| # | What | Why it can't be unit-tested | Failure mode if skipped |
|---|------|----------------------------|-------------------------|
| 1 | Permission dialog appears; grant → scan works; deny → sentinel, no crash; permanent-deny → honest message | Real Android permission subsystem | Feature does nothing on a real phone |
| 2 | Cursor returns rows from `Music/` **and** `Download/` (Pitfall 7) | Real MediaProvider + real permission model | D-11's Download half may be undeliverable |
| 3 | An imported track **plays** end to end via the `content://` path | Real WebViewLocalServer | The whole phase is non-functional |
| 4 | **Seek** works mid-track on an imported file (Pitfall 2) | Real Range handling | Silent corruption on scrub — the worst kind of bug |
| 5 | A large (>100 MB) lossless file plays without OOM (Pitfall 3) | Real device memory | Crash on a subset of users' libraries |
| 6 | Scan of a realistic library (1000+ files) completes, progress advances, UI doesn't jank (Pitfall 9) | Real bridge + real row count | Import appears hung |
| 7 | Removing an imported song from the library **does not delete the file** (Pitfall 1) | Real MediaStore delete | **Irreversible user data loss** |
| 8 | D-09: the first import does not duplicate existing downloads | Real `Music/OpenMusic/` contents | Library doubles |
| 9 | Delete a file outside the app → entry shows unavailable, is NOT removed (D-06); next import drops it (D-07/D-08) | Real filesystem | D-06 silently violated |
| 10 | Lock-screen / media-session metadata is correct for a device track | Real media session | Cosmetic but visible |

**Item 7 should be verified before item 3.** A data-loss bug that ships is not recoverable; a playback bug is.

Emulator (`Pixel_3a_API_34` + CDP, per project memory) covers 1-4, 6, 8, 9. Items 5 and 10 want a real phone. Item 2's negative case may be OEM-specific.

---

## Security Domain

`security_enforcement` is not present in `.planning/config.json` (absent = enabled). Included accordingly.

### Applicable ASVS categories

| ASVS category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth surface; import is fully local |
| V3 Session Management | no | No session |
| V4 Access Control | **yes** | Android runtime permission (`READ_MEDIA_AUDIO`) is the access-control boundary. Never request more than needed — do **not** add `MANAGE_EXTERNAL_STORAGE` / `READ_MEDIA_VISUAL_USER_SELECTED` / broad storage scope. The manifest comment at `AndroidManifest.xml:58` currently boasts "NO READ_MEDIA_AUDIO / broad media-read scope is requested" — **update that comment truthfully** when the permission is added; a stale security comment is worse than none. |
| V5 Input Validation | **yes** | Two untrusted inputs: (a) the user's raw regex → compile in `try/catch`, require named groups, time-budget probe (Pitfall 8); (b) MediaStore string columns (`TITLE`/`ARTIST`/`DISPLAY_NAME`) are **attacker-influenceable** — any app can write a file with an arbitrary name. Treat them as untrusted text: no `{@html}`, no path interpolation, cap length before storing in localStorage. |
| V6 Cryptography | no | No crypto in this phase |
| V12 File & Resources | **yes** | Path traversal in reverse: a `DISPLAY_NAME` containing `../` must never be concatenated into a filesystem path. The scan path never writes files (D-04), which eliminates most of this class by design — keep it that way. `download-filename.ts:36`'s char class `/[/\\?%*:\|"<>]/g` is the existing sanitizer if any name ever reaches a path. |
| V13 API / Bridge | **yes** | The new `@PluginMethod` is an app-internal surface, but validate `offset`/`limit` in Kotlin (`coerceIn`) so a compromised WebView can't request a pathological page. Build the SQL selection with **bound args** (`selectionArgs`), never string concatenation — `RELATIVE_PATH LIKE ?`, not `LIKE '$x'`. |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| SQL injection into the ContentResolver selection | Tampering | `selectionArgs` binding; never interpolate user input into `selection`. The `sortOrder` string DOES take `LIMIT/OFFSET` by concatenation — bind those through validated integers only. |
| ReDoS via the user regex hanging the single-threaded WebView | DoS | Save-time timed probe + scan-budget abort + preset fallback (Pitfall 8) |
| Over-broad permission request | Information disclosure | Request `READ_MEDIA_AUDIO` only. Never `MANAGE_EXTERNAL_STORAGE`. |
| Destructive delete of user-owned media | **Tampering / data loss** | Pitfall 1's guard, tested. This is the highest-severity risk in the phase. |
| Malicious filename rendered into the UI | XSS (Svelte-mitigated) | Svelte escapes by default — just never introduce `{@html}` on a scan-derived string |
| Oversized bridge payload → renderer OOM | DoS | Paged `scanAudio` with a Kotlin-side `limit` clamp (Pitfall 9) |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `READ_MEDIA_AUDIO` grants read access to audio files located in `Download/` via `MediaStore.Audio.Media` | Pitfall 7 | **HIGH** — D-11's Download half becomes undeliverable without SAF; a CONTEXT correction |
| A2 | Chromium Blobs above a small threshold are backed by browser-process blob storage (pages to disk), so a 50 MB Blob is not 50 MB of JS heap | Pitfall 3 | MEDIUM — a large import could OOM on a low-RAM phone; mitigations listed |
| A3 | Chromium's media stack content-sniffs `blob:` sources, so an empty/incorrect `Blob.type` still plays | Pitfall 4 | LOW — mitigated by explicitly re-typing from `MIME_TYPE` |
| A4 | MediaProvider's FUSE layer preserves `_ID` across an external rename on Android 11+, but not on 10 and below | Pitfall 5 | MEDIUM — `getVersion()` companion turns this from silent corruption into a handled case |
| A5 | Column API levels: `ALBUM_ARTIST`/`GENRE`/`BITRATE`/`GENERATION_MODIFIED` = API 30; `VOLUME_NAME`/`IS_DOWNLOAD`/`BUCKET_DISPLAY_NAME` = API 29; `IS_MUSIC`/`TRACK`/`YEAR`/`ALBUM_ID` = API 1 | Pitfall 6 | MEDIUM — an unguarded column throws `IllegalArgumentException` at query time on older devices. Verify each against the AOSP source or the API reference before shipping the projection. |
| A6 | `IS_MUSIC` is set to 0 by the platform scanner for files under Ringtones/Notifications/Alarms/Podcasts | Code example | LOW — it's a complement to the folder filter, not the filter itself |
| A7 | No partial/selected-media access state exists for audio (the Android 14+ selected-media flow is images/video only) | Permission section | LOW — if wrong, the permission flow gains a third state to handle |
| A8 | 500 rows per `scanAudio` page is a reasonable bridge payload | Pitfall 9 | LOW — tune on device |
| A9 | The 50 ms save-time probe / 2 s scan budget are workable ReDoS thresholds | Pitfall 8 | LOW — tune; the mechanism matters more than the numbers |
| A10 | `MediaStore.getVersion(context, volumeName)` is API 29+ (the single-arg overload being the deprecated older one) | Pitfall 5 | LOW — verify the overload signature against the API reference |
| A11 | `ContentResolver.loadThumbnail` is API 29+ and works on an `Audio.Albums` URI | Don't Hand-Roll | LOW — cover art is a discretion item; the existing cover chain (bite #13) is the zero-cost fallback |

**Everything in the "What a `device:` uid breaks" table, the Settings-route finding, and the Capacitor Range/content-URI findings is `[VERIFIED]` by direct file reads in this session and carries no assumption.**

---

## Open Questions

1. **Does `READ_MEDIA_AUDIO` actually expose other apps' audio in `Download/`? (A1)**
   - Known: the permission is media-**type** scoped, and the Android 13 docs frame it as "media files that other apps have created".
   - Unclear: whether MediaProvider's Downloads-collection SAF rule bleeds into the Audio-collection view for `is_download=1` rows.
   - Recommendation: make this the **first** device checkpoint, before any UI work. It's a 10-minute test that could change D-11.

2. **Should a failed device play cross-source-fallback to a streamed version? (bite #6)**
   - Known: `fallbackOrder` will happily do it — `'device'` isn't in `getEnabledAdapters()`, so the ladder is intact and the code doesn't crash.
   - Unclear: whether that's desirable. D-06 says the user should "see why it won't play". Silently substituting a streamed copy contradicts the truthfulness posture (`quick-260913-jq4`).
   - Recommendation: **bar fallback for `device:` uids** and surface the unavailable state instead. Cheap, and consistent with the phase's stated ethic.

3. **D-10 merge conflict rule — settle it concretely.**
   - Recommendation, grounded in the shapes: **stored entry wins on every populated field; the file only fills holes.** The stored `Track` has a resolved `cover` (from the Deezer→iTunes→CN chain), a proper `album`, and `names.dn*`-translated strings; the file's MediaStore tags are whatever the CDN's filename gave it. The merge's *stated purpose* (D-09) is restoring **playability**, not metadata. So the merge should write exactly one thing: `openmusic-blob-uri:<real-uid> = row.uri`. Zero metadata churn, zero risk. This is also the smallest possible diff.

4. **Where do import rules live — `settings.svelte.ts` or a new store?**
   - `settings.svelte.ts` is already large and its `save()` serialises a fixed field list (lines 288, 394, 495). Adding a nested rules object there means touching `load`/`save`/`reset` three times.
   - A separate `openmusic:import-rules:v1` store is more isolated and matches the `openmusic:<domain>:v<N>` convention the CONTEXT cites.
   - Recommendation: separate store. Planner's call, but note the cost either way.

5. **`resolvedAt` semantics for a local file.**
   - The readiness guard expires a `resolvedAt` after 15 min (`RESOLVE_URL_TTL_S`). A local file never expires, but the guard can't know that.
   - Recommendation: do **not** try to keep `resolvedAt` artificially fresh (a refresh loop is exactly the class of bug this codebase has been bitten by three times — see the memory entries on re-resolve floods). Use the `isDeviceUid` guard at `ensureTrackDetails` instead. One branch, no timers.

6. **Should the Settings index expose a new group row, and does that need a new Lucide icon?**
   - Trivial but it's 2 i18n keys × 16 locales plus an icon import. `HardDriveDownload` / `FolderDown` exist in Lucide. Flagging only so the planner budgets it rather than discovering it mid-task.

---

## Sources

### Primary (HIGH confidence — read directly this session)
- `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/WebViewLocalServer.java` — `shouldInterceptRequest` (184-211), `isLocalFile` (214-216), `handleLocalRequest` + the Range bug (339-377), `getMimeType` (547-568), `createHostingDetails` content/file dispatch (640-680), `PathHandler` default headers (95-146)
- `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/AndroidProtocolHandler.java` — `openContentUrl` (72-87), `openFile` (66-70)
- `node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js:168-180` — `convertFileSrcServerUrl` scheme mapping
- `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java:95-97` — `CAPACITOR_FILE_START` / `CAPACITOR_CONTENT_START`
- `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java` — `@JavascriptInterface postMessage` / `evaluateJavascript` bridging
- `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/annotation/Permission.java`, `Plugin.java:467-618`
- Repo: `src/lib/services/blob-store.ts`, `media-store.ts`, `catalog.ts`, `download-track.ts`, `download-filename.ts`, `track-ready.ts`, `match-key.ts`, `fallback.ts`, `preconnect.ts`, `share.ts`; `src/lib/stores/library.svelte.ts`, `player.svelte.ts`; `src/lib/sources/types.ts`, `registry.ts`; `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt`, `android/app/src/main/AndroidManifest.xml`, `android/variables.gradle`; `capacitor.config.ts`, `vite.config.ts`, `package.json`; `src/routes/(app)/settings/**`
- Planning: `.planning/phases/34-*/34-CONTEXT.md`, `34-NOTES.md`; `.planning/phases/999.1-*/999.1-CONTEXT.md`; `.planning/phases/29-download-ux-folder-control/29-CONTEXT.md` + dir listing; `.planning/ROADMAP.md:340-348`; `.planning/STATE.md`; `.planning/config.json`; `./CLAUDE.md`

### Secondary (MEDIUM confidence — official docs via WebFetch/WebSearch)
- developer.android.com/training/data-storage/shared/media — granular audio permission, `RELATIVE_PATH` vs `DATA`, `loadThumbnail`, "check whether the media store version has changed"
- developer.android.com/about/versions/13/behavior-changes-13 — `READ_MEDIA_AUDIO`, auto-grant on upgrade, selected-media = photos/videos
- learn.microsoft.com/dotnet/api/android.provider.mediastore.getversion — `getVersion` semantics ("Applications that import data from MediaStore into their own caches…", null when unmounted)
- capacitorjs.com/docs/plugins/android — bridge large-data warning, `@capacitor/file-transfer` as the recommended workaround
- github.com/ionic-team/capacitor issues/7747 — Android nested-array rejection, valid bridge types
- github.com/coil-kt/coil issues/922 and github.com/bumptech/glide issues/4066 — `Albums.ALBUM_ART` deprecated + always null since Q; use `loadThumbnail`

### Tertiary (LOW confidence — flagged for validation)
- b4x.com forum + github.com/iammert/FFmpegMediaMetadataRetriever — `MediaMetadataRetriever` bulk slowness (community reports, directionally consistent, no benchmark)
- Column API-level assignments (A5) — training knowledge; the docs pages truncated before the constant tables on every fetch attempt. **Verify against the API reference before writing the projection.**

---

## Metadata

**Confidence breakdown:**
- Existing-code seams / bite list / Settings-route finding — **HIGH**: every claim read directly from source with file:line.
- Capacitor content-URI + Range behaviour — **HIGH**: read from the vendored `@capacitor/android` 8.4.0 Java source in this repo's `node_modules`, not from docs.
- Android permission model — **MEDIUM-HIGH**: official docs, but the `Download/`-folder case (A1) is not addressed head-on by any source.
- MediaStore column API levels — **LOW-MEDIUM**: every doc fetch truncated before the constant tables. Treat A5 as a to-verify list.
- `_ID` stability — **MEDIUM**: `getVersion()`'s existence and purpose are cited; the FUSE-rename mechanism is assumed.
- Memory behaviour for large blobs — **LOW-MEDIUM**: device verification required.
- ReDoS mitigation design — **MEDIUM**: the mechanism is sound; the thresholds are unmeasured.

**Research date:** 2026-09-13
**Valid until:** ~2026-10-13 (30 days). The codebase findings are stable; the Android platform claims are stable; the only fast-moving input is Capacitor — if `@capacitor/android` is bumped, **re-verify the `handleLocalRequest` Range block**, since that bug is the load-bearing reason the Blob shape must be preserved.
