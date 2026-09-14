# Phase 34 — seed notes

Captured at `/gsd:add-phase` time. Entry-point facts so planning does not re-derive them.

## Shape of the feature

User-triggered, not a background scan. A button in the **Settings → download page** ("Import songs from device"). Tap → scan → parse → map → index → those files show up as downloaded songs everywhere downloaded state is rendered.

## Known entry points

- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` (227L) is **write-only** today: `@PluginMethod saveToMusic` / `deleteFromMusic`, plus `mimeForFileName`, `openSource`, `streamCopy`, `performSave`, `publicMusicPermsCallback`. A new query `@PluginMethod` is needed (MediaStore audio cursor over Music/Download).
- Web-side download stack to integrate with, not duplicate:
  - `src/lib/services/blob-store.ts` (IndexedDB blobs)
  - `src/lib/services/download-track.ts`, `download-save.ts`, `download-filename.ts`, `downloads-queue.ts`
  - `src/lib/services/media-store.ts` (existing TS bridge to the Kotlin plugin)
  - `library.isDownloaded(uid)` in `src/lib/stores/library.svelte.ts`
- `src/routes/(app)/settings/` has no `download/` subroute yet — download settings currently live elsewhere (Phase 29 "Download UX & Folder Control" is the related prior work; confirm where its UI landed before adding a button).

## Constraints to carry into the plan

- **Dedupe** against existing IndexedDB blob downloads so an imported file and an app-downloaded copy of the same song do not both claim "downloaded".
- **Identity**: `Track.uid` is `${source}:${songid}` via `makeUid()`. Imported device files have no upstream source id — the plan must decide the identity scheme (a `device:` pseudo-source, or matching to an existing uid by tags) and how `isDownloaded` resolves it.
- **Guarding**: `browser` + Capacitor `isNativePlatform()` guarded so the web build no-ops (see the existing Capacitor call sites).
- **Permissions**: reading shared audio needs a runtime permission on modern Android (`READ_MEDIA_AUDIO`); `publicMusicPermsCallback` in the Kotlin plugin is the existing pattern for the write side.
- **Playback**: verify a `content://` URI feeds the app's single `<audio>` element in the Capacitor WebView — if it does not, the import has to copy or resolve to a `blob:`/file URL like the existing offline path does.
