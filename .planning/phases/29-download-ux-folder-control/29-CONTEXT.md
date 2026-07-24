# Phase 29: Download UX & Folder Control - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Overhaul the download experience across the app:
1. **Native folder** — land downloaded audio in the public `Download/openmusic/` folder (today: `Music/OpenMusic/`), no per-download location prompt.
2. **Controlled filename** — build the saved filename ourselves as `{artist} - {song}.{ext}`, running artist/song through the app's display-name translation (so a user on zh-Hant gets a zh-Hant filename). Do NOT use the provider's filename.
3. **Fix the "opens a media page" bug** — a failed save must never open the audio stream in a new tab.
4. **Per-song loading + "Downloaded" state** — each song's download control shows its own spinner and a greyed, disabled "Downloaded" once saved; one song's download never spins another song's button.
5. **Settings migration button (native)** — one-shot: move already-downloaded files into `Download/openmusic/`, rewrite the uid→uri index ("remap"), and point all future read/write at that folder.

**Platform split (locked):** Native Android (Capacitor) owns the real folder + migration (a browser cannot choose a save folder or read/move a user's files). The web PWA gets #2 (filename), #3 (bug fix), and #4 (per-song loading) on a best-effort basis (browser Downloads root). #1 folder + #5 migration are **native-only**.

**Out of scope:** changing WHAT gets downloaded (quality tiers stay as-is via `settings.downloadQuality`), the offline re-stream/blob-cache playback path, and any new source integration.
</domain>

<decisions>
## Implementation Decisions

### Platform targeting
- **D-01:** Native app owns folder placement + migration. Web PWA still receives filename control, the bug fix, and per-song loading state (degraded: saves into the browser Downloads root, no folder choice).
- **D-02:** No location prompt on any platform. On web desktop this means **stop using `showSaveFilePicker`** (it prompts every time) — go straight to the anchor auto-save into Downloads. On native the folder is fixed to `Download/openmusic/`.

### Native download folder (#1)
- **D-03:** Public download target moves from `Music/OpenMusic/` → `Download/openmusic/`.
  - **⚠ RESEARCH CORRECTION (29-RESEARCH.md, HIGH confidence):** `Download/` is NOT a legal top-level dir for the `MediaStore.Audio` collection — writing `RELATIVE_PATH="Download/openmusic/"` into `MediaStore.Audio.Media` throws `IllegalArgumentException` at runtime. The fix is a **collection change, not a path-string change**: insert into the **`MediaStore.Downloads`** collection (`MediaStore.Downloads.getContentUri(VOLUME_EXTERNAL_PRIMARY)`) with `RELATIVE_PATH="Download/openmusic/"`. targetSdk 36 / minSdk 24 → full scoped storage, no legacy escape hatch, so the API ≤28 branch is effectively dead but harmless to leave.
  - Change `MediaStoreSaverPlugin.kt`: swap the insert collection to Downloads + set `RELATIVE_PATH` to `${Environment.DIRECTORY_DOWNLOADS}/openmusic/`. Deletes/queries must target the Downloads collection URI form.
- **D-04:** The **app-private** offline copy (`Directory.Data/downloads/<sanitized-uid>`, the `get()` read source in `blob-store.ts`) stays uid-keyed and stays where it is — it must remain uid-addressable for offline playback. Only the **public** MediaStore copy gets the new folder + the human filename.

### Controlled filename (#2)
- **D-05:** Filename format `{artist} - {song}.{ext}` (already the shape in TrackMenu/album), but sourced through the display-name translation: `names.dnArtist(track.artist)` and `names.dnTitle(track.title)` instead of raw `track.artist`/`track.title`. Same sanitize step (`.replace(/[/\\?%*:|"<>]/g, '_')`).
- **D-06:** Extension from the resolved audio (the existing `audioUrl` regex → `mp3|flac|m4a|aac|ogg|wav`, default `mp3`). The **public native filename** (`nativeFileName` in `blob-store.ts`) changes from `<uid>.mp3` to the same `{artist} - {song}.{ext}` — so the Kotlin bridge must accept the real filename (it already takes `fileName`).
- **D-07:** Translation fallback: if `names.dn*` returns the original (translation not cached / missing), use the raw name — never block the download waiting on a translation. (Planner: consider awaiting `ensureTranslated` when the user's name-lang differs, for a reliable zh-Hant filename — flagged, not required.)
- **D-08 (Claude's discretion):** Extract the filename builder into ONE shared pure helper (e.g. `download-filename.ts`) and call it from all three save sites (TrackMenu, album, native `blob-store`) so the format never drifts again.

### Media-page bug (#3)
- **D-09:** Remove `window.open(r.audioUrl, '_blank')` from the `catch` in `TrackMenu.doDownload` (line 230) and the equivalent last-resort in `album.downloadAlbum`. On save failure: show a toast (song stays in the Library Downloads reference list, re-streams on tap) — never navigate to the stream. Reuse/adjust the existing `toast.openedAudio` key or add a `toast.downloadFailedKeptInLibrary` key.

### Per-song loading + "Downloaded" state (#4)
- **D-10:** Add a reactive per-uid set to the **library store**: `downloading = $state(new Set<string>())` with `beginDownload(uid)` / `endDownload(uid)` helpers (reassign `new Set(...)` to stay reactive — same idiom as TrackMenu `inFlight`). This is the single source of truth every surface reads.
- **D-11:** Rollout = **every track row that renders a download affordance**: `CompactRow.svelte` (home + search), the library page rows (all tabs), the album page rows, and the `TrackMenu` Download row. A small shared stateful control (or a shared snippet) renders three states: idle (Download icon, enabled) → `downloading.has(uid)` (spinner, disabled) → `library.isDownloaded(uid)` (greyed, disabled, label "Downloaded").
- **D-12:** The `TrackMenu` Download row must no longer `onclose()` immediately then run blind — the per-uid state is what gives feedback, so the button reflects state whether or not the menu is open. Global `toast.preparingDownload` may stay as a secondary cue.
- **D-13:** Add i18n key `menu.downloaded` / a shared "Downloaded" label (all 16 locales, double-quote convention). `en` defines the `TranslationKey`.

### Migration button (#5, native)
- **D-14:** New button in **Settings → Data** (`settings/data/+page.svelte`) — that page already owns library/downloads bulk actions (clear-library lives there). Native-only: hide/disable on web (`Capacitor.isNativePlatform()` guard).
- **D-15:** Behavior = **move existing + switch**: relocate every already-downloaded public file from `Music/OpenMusic/` → `Download/openmusic/`, rewrite each `openmusic-blob-uri:<uid>` localStorage entry to the new content URI ("remap"), and (from D-03) all future downloads already write to the new folder. Needs a NEW Kotlin method on `MediaStoreSaverPlugin` (`relocateToDownloads`). **⚠ RESEARCH CORRECTION:** a cross-collection move (Audio→Downloads) CANNOT be done by updating `RELATIVE_PATH` in place (in-place moves are intra-collection only) — the migration MUST be **copy+delete**: re-insert into the Downloads collection using the untouched app-private copy as the byte source (D-04), then delete the old `MediaStore.Audio` entry, then rewrite `openmusic-blob-uri:<uid>`. OpenMusic owns its own entries → no `RecoverableSecurityException`/consent dialog. Idempotent by URI inspection (`…/audio/media/…` = needs move; `…/downloads/…` = already done). Mirrors the never-throws contract (partial failure degrades gracefully, per-uid).
- **D-16:** Progress + result surfaced via toast/inline count (e.g. "Moved N of M"). One-shot, idempotent (already-moved entries are skipped). App-private copies are untouched (D-04).

### Never-throw / isolation contracts (carry-forward, MUST hold)
- **D-17:** All new native filesystem/MediaStore paths keep the existing **never-throws** posture (resolve `false`/`null`/`void`, never reject) — a failed public write or migration step degrades to CDN re-stream, never crashes the player.
- **D-18:** The **DOWNLOAD ISOLATION CONTRACT** in `TrackMenu.doDownload` stays intact — download work must not touch `player.current`, `playGen`, the shared `<audio>`, or lyrics (quick-260625-pzs-04). Per-song state lives in the library store, not the player.
</decisions>

<specifics>
## Specific Ideas

- User's words: "reform the downloaded file name to `{artist name} - {song name}.{format}`. Control the downloaded file name instead using the one from provider."
- User's words: "if user select zht for song name, the download file name will be in zht" → honor the display-name translation (`names.dn*`), which already tracks the user's name-language setting.
- User's words: folder `/download/openmusic` → interpreted as Android public `Download/openmusic/` (lowercase, matching the ask; current code uses `Music/OpenMusic/`).
- User's words: "start reading and writing song in that folder since" → after migration, the new folder is the canonical public location.
</specifics>

<canonical_refs>
## Canonical References

**No external specs/ADRs exist for this work** — requirements are captured in `<decisions>` above. The contracts that constrain this phase live in source; downstream agents MUST read these before planning/implementing:

### Web download path (surfaces #2, #3, #4)
- `src/lib/components/TrackMenu.svelte` §`doDownload` (lines 148–233) — the primary per-song download: filename build (202), quality reuse (T-pzs-02), the `window.open` bug (230), the DOWNLOAD ISOLATION CONTRACT comment (151–162).
- `src/routes/(app)/album/[name]/+page.svelte` §`downloadAlbum` (lines 355–410) — whole-album loop; second filename site + second `window.open` fallback; `busyAction` per-action isolation pattern.

### Native download + folder (surfaces #1, #5)
- `src/lib/services/blob-store.ts` — dual web(IDB)/native(FS+MediaStore) store; `nativePut`/`nativeGet`/`nativeDel`, `nativePath` (app-private, uid-keyed), `nativeFileName` (public `<uid>.mp3` → change to human name), `openmusic-blob-uri:<uid>` index.
- `src/lib/services/media-store.ts` — TS wrapper for the `MediaStoreSaver` plugin (`saveToMusic`/`deleteFromMusic`); add the relocate method here.
- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` — Kotlin MediaStore bridge; `relativePath` (line 51) + legacy path (178–179) are the folder constants to change; add `relocateToDownloads`.

### State + translation + settings
- `src/lib/stores/library.svelte.ts` — `downloads`/`isDownloaded`/`addDownload`/`removeDownload` (lines 155–166); add the reactive `downloading` Set (D-10).
- `src/lib/stores/names.svelte.ts` §`dnArtist`/`dnTitle` (235, 240) — the display-name translation to apply to filenames.
- `src/lib/stores/settings.svelte.ts` — `downloadQuality` (159–160); name-language setting that drives `names.dn*`.
- `src/routes/(app)/settings/data/+page.svelte` — host for the migration button (D-14).
- `src/lib/components/CompactRow.svelte` — the shared row for home/search (D-11 rollout target).
- `src/lib/i18n/en.ts` (+ 15 sibling locales) — download strings; `menu.download` (272), `toast.preparingDownload/downloaded/openedAudio` (323–331). Add `menu.downloaded` + migration strings. **Double-quote convention.**
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Filename shape already exists** — `${artist} - ${title}.${ext}` + sanitize is in both TrackMenu (202) and album (393). D-08 consolidates into one helper and swaps raw names → `names.dn*`.
- **Per-action in-flight idiom** — `inFlight = $state(new Set<string>())` (TrackMenu 59) and `busyAction` (album) already model isolated, reassign-to-stay-reactive state. D-10 lifts this to a store-level per-uid set.
- **Native dual-write already built** — `blob-store.nativePut` writes app-private (offline read) + public MediaStore (visibility) and records the content URI. Only the folder + public filename change; the architecture stays.
- **`names.dnTitle`/`dnArtist`** — reactive, settings-driven translation with raw fallback; exactly what #2 needs.
- **Settings → Data page** already hosts destructive/bulk library actions (clear-library) — natural home for the migration button.

### Established Patterns
- **NEVER-THROWS services** — blob-store/media-store resolve sentinels, never reject (D-17). New native paths must match.
- **DOWNLOAD ISOLATION** — download must not mutate player state (D-18, quick-260625-pzs-04).
- **Runes store singletons** — `library` is a `$state` class singleton; add `downloading` as a `$state<Set<string>>` field, reassigned on change.
- **i18n parity** — all 16 locale dicts share an identical key set (`i18n.test.ts` guards it); double quotes throughout.
- **RAW `fetch` for media** — download-to-blob uses raw `fetch`, NOT `apiFetch` (absolute CDN URLs; governor would corrupt them). Keep.

### Integration Points
- `library.downloading` Set → read by CompactRow, library rows, album rows, TrackMenu (D-11).
- Shared `download-filename.ts` helper → called by TrackMenu, album, and native `nativeFileName` (D-08).
- `MediaStoreSaver.relocateToDownloads` (new Kotlin + TS wrapper) → called by the Settings migration action (D-15).
- Folder constant change in Kotlin (D-03) → automatically routes new downloads to `Download/openmusic/`.
</code_context>

<deferred>
## Deferred Ideas

- **Reliable zh-Hant filenames via awaited translation** — if `names.dn*` cache misses at click time the filename falls back to raw (D-07). A guaranteed-translated filename (await `ensureTranslated`) is a possible follow-up if raw fallback proves noticeable.
- **iOS native download folder** — this phase's native work is Android (Capacitor + Kotlin MediaStore). An iOS files-app equivalent is a separate future effort.
- **Download progress bars** (byte-level) — current scope is spinner → Downloaded, not a percentage.

None of these are required for Phase 29.
</deferred>

---

*Phase: 29-download-ux-folder-control*
*Context gathered: 2026-07-23*
