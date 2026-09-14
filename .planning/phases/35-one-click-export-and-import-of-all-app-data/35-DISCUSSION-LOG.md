# Phase 35: One-click export and import of all app data - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 35-CONTEXT.md — this log preserves how they were reached.

**Date:** 2026-09-13
**Phase:** 35-one-click-export-and-import-of-all-app-data
**Mode:** discuss (default, interactive)
**Areas discussed:** What's in the file · Import merge semantics · Native file in/out · Failure + rehydrate UX

## Area selection

Presented four phase-specific gray areas; user selected **all four**.

## What's in the file

| Question | Options presented | Selected |
|---|---|---|
| Which keys does the export carry? | Identity only (rec) / Identity + caches / Every `openmusic:*` key | **Identity only** |
| Does it carry `openmusic:player:v1`? | No, skip (rec) / Yes, restore position / You decide | **No — skip it** |
| What about downloaded audio blobs (GBs)? | Export list not bytes (rec) / list + mark re-downloadable / drop entries | **"1 and user can one click to re-download all those songs if missing"** |
| Re-download button placement | Settings → Data, missing only (rec) / prompt after import / both | **Settings → Data, missing only** |
| File format | One JSON version-tagged (rec) / minified / zip of per-domain files | **One JSON, version-tagged** |
| Filename | `openmusic-backup-YYYY-MM-DD.json` (rec) / fixed name / you decide | **Dated filename** |

**Notes:** the blob answer went beyond the options offered — the user asked for a one-click bulk re-download of missing files. Accepted as part of this phase's restore story (D-06) rather than deferred: a restored device showing 200 liked songs with no way back to the offline copies is an incomplete restore, and the button is small.

## Import merge semantics

| Question | Options presented | Selected |
|---|---|---|
| What happens to state already on the device? | Replace everything (rec) / merge union / ask at import time | **Replace everything** |
| Auto-save a rollback copy first? | Yes, silent snapshot (rec) / no, confirm is enough / you decide | **Yes — silent snapshot** |
| What about download entries with no bytes here? | Restore as missing (rec) / restore + auto-download / keep local, merge list | **Restore them as missing** |

**Notes:** Replace + "restore as missing" would mark a device's real local downloads as missing if "missing" were a stored flag. Resolved during capture by making missing a *computed* property (D-07), which needs no extra decision from the user.

## Native file in/out

| Question | Options presented | Selected |
|---|---|---|
| Where does Android export land? | System share sheet (rec) / public Downloads via Kotlin / both | **System share sheet** |
| How does Android import get a file? | Plain `<input type="file">` (rec) / native ACTION_OPEN_DOCUMENT / paste JSON | **Plain `<input type="file">`** |
| Web side | Blob + `<a download>` / `<input file>` (rec) / File System Access + fallback / you decide | **Blob + `<a download>`** |

**Notes:** scouted `MediaStoreSaverPlugin.kt` first and found it audio-only (`MediaStore.Audio`, `Music/` relative path), which ruled it out as a carrier for a JSON file and made the share-sheet route cheaper than extending it.

## Failure + rehydrate UX

| Question | Options presented | Selected |
|---|---|---|
| How does the live app pick up imported state? | Force full reload (rec) / live re-hydrate stores / reload after stopping playback | **Force a full app reload** |
| Corrupt / foreign / newer file? | Validate all, write nothing, name the reason (rec) / generic message / best-effort partial | **Validate all, name the reason** |
| Older file with a changed schema? | Migrate what we can, refuse the rest (rec) / accept as-is / refuse anything non-current | **Migrate what we can** |
| Share sheet needs a native capability | Add `@capacitor/share` (rec) / Kotlin ACTION_SEND / you decide | **Add `@capacitor/share`** |

## Claude's discretion (explicitly left open)

Envelope field names and version-tag shape · where the pure validator lives · rollback-snapshot retention and location · progress/result UI for export, import and the re-download sweep · `confirm()` vs a proper sheet for the destructive confirm.

## Deferred ideas raised

Cloud/account-backed sync · exporting the audio bytes as a full archive · merge-on-import and a per-import Replace-or-Merge choice · File System Access API on desktop.

## Todos reviewed, not folded

`song-share-stale-cover-comment.md` (0.6) and `artist-page-hyphenated-lookup-key.md` (0.2) — both keyword false positives, unrelated to backup/restore. Not presented to the user.
