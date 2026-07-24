# Phase 29: Download UX & Folder Control - Discussion Log

> **Audit trail only.** Not consumed by downstream agents (researcher, planner, executor).
> Decisions live in `29-CONTEXT.md`.

**Date:** 2026-07-23
**Phase:** 29-download-ux-folder-control
**Mode:** discuss (manual — GSD roadmap parser can't resolve `<details>` phases in this repo)
**Route:** `/gsd:do` → full-cycle → `/gsd:discuss-phase`

## Scope (user request)

Download function overhaul, 5 requirements:
1. Default store to `/download/openmusic`, no per-download location prompt.
2. Filename through translation rules (zht → zht filename); reform to `{artist} - {song}.{format}`; control the name, not the provider's.
3. Fix: clicking download sometimes opens a media playing page instead of saving.
4. Per-song download loading state (song A must not spin song B); greyed "Downloaded" label once saved.
5. Settings button to move previously-downloaded songs into the openmusic folder (remap) and read/write there from then on.

## Codebase scouting (before questions)

- Web download: `TrackMenu.svelte` §doDownload — filename `{artist} - {title}.{ext}` already present but RAW names; `catch → window.open(audioUrl)` = the media-page bug; `inFlight` Set is per-action/one-menu.
- Album download: `album/[name]/+page.svelte` §downloadAlbum — 2nd filename + 2nd window.open fallback; `busyAction` isolation.
- Native: `blob-store.ts` writes app-private (uid-keyed, offline-read) + public `Music/OpenMusic/` via `MediaStoreSaverPlugin.kt`; public filename = `<uid>.mp3`.
- Folder hardcoded in Kotlin: `relativePath = DIRECTORY_MUSIC/OpenMusic/` (line 51) + legacy (178–179).
- State: `library.svelte.ts` has `downloads`/`isDownloaded`/`addDownload`; NO per-uid downloading flag.
- Translation: `names.dnTitle`/`dnArtist` (settings-driven, raw fallback).
- Shared row: `CompactRow.svelte` (home/search); library + album pages use own row markup.

## Questions asked

### Platform target
- Options: Native for folder+migration/web gets rest · Native only · Web only
- **Selected:** Native app for folder+migration; web gets the rest.
- Rationale: #1 folder + #5 file-move/read are physically impossible in a browser; web still gets #2/#3/#4 best-effort.

### #3 media-page bug fallback
- Options: Never open a play page (toast + keep in Library) · Retry once then fail · Keep window.open as last resort
- **Selected:** Never open a play page — toast + keep in Library.

### #4 per-song loading + button placement
- Options: ⋮ menu row only · ⋮ menu + list rows · Everywhere a track row renders
- **Selected:** Everywhere a track row renders (shared `library.downloading` Set<uid>).

### #5 migration behavior
- Options: Move existing + switch · Only switch future · Move but read both
- **Selected:** Move existing files into `/download/openmusic` + switch future downloads there (rewrite uid→uri index).

## Locked without asking (low ambiguity)

- Filename translation applies `names.dnArtist`/`names.dnTitle` with raw fallback; format `{artist} - {song}.{ext}`, extension from resolved audio. (D-05..D-08)

## Deferred

- Awaited-translation for guaranteed zh-Hant filenames; iOS native folder; byte-level progress bars.

## Claude's discretion

- Consolidate the filename builder into one shared `download-filename.ts` helper across all three save sites (D-08).
- Exact shared control vs snippet for the row download affordance (D-11).
