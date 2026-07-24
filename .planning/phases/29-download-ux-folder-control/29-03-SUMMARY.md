---
phase: 29-download-ux-folder-control
plan: 29-03
subsystem: api
tags: [downloads, blob-store, mediastore, isolation, never-throws, svelte5-runes, vitest]

# Dependency graph
requires:
  - phase: 29-01
    provides: "download-filename.ts (buildDownloadFilename/extFromAudioUrl) + download-save.ts (saveBlobToDisk anchor seam)"
  - phase: 29-02
    provides: "library.downloading Set + beginDownload/endDownload/addDownload/isDownloaded helpers"
provides:
  - "downloadTrack(track, opts?) — the ONE shared, node-testable single-song download orchestration (resolve→addDownload→fetch→persist→save)"
  - "DownloadResult sentinel type ('saved' | 'no-audio' | 'failed') — never-throws, never-navigates"
  - "blobStore.put(uid, blob, filename?) — optional human filename threaded to the native MediaStore public write with a `<uid>.mp3` fallback"
affects: [29-04 wire downloadTrack into TrackMenu + album, 29-05 native folder saveToDownloads, 29-06 migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extract-inlined-component-logic-to-a-pure-service seam: TrackMenu.doDownload body lifted verbatim (behavior-preserving) into a node-testable $lib/services module that imports NO i18n/toast (UI localizes off the returned sentinel)"
    - "Sentinel-result orchestration: a Promise<DownloadResult> ('saved'|'no-audio'|'failed') carries every outcome so the never-throws + no-navigation contract is provable in node"
    - "Throwing-setter isolation assertion: mocked player.current/playGen get set() traps that fail the test if the service ever writes them (D-18 proven, not just asserted-absent)"

key-files:
  created:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
  modified:
    - src/lib/services/blob-store.ts (Task 1 — filename param; committed in prior continuation run)
    - src/lib/services/blob-store.test.ts (Task 1 — filename plumbing cases)

key-decisions:
  - "download-track.ts imports player ONLY to READ .current (reuse-current-quality) — never writes any player field (D-18 DOWNLOAD ISOLATION); the throwing-setter test enforces it"
  - "currentQualityMeets reproduced locally (not imported from the Svelte component) to keep the service store/component-free and node-testable"
  - "persist defaults TRUE; persist:false (album bulk path) skips blobStore.put only — addDownload + saveBlobToDisk + begin/end still run (album parity)"
  - "Real download-filename helper (not mocked) runs in the test so the exact `{artist} - {title}.{ext}` output is asserted end-to-end; all store/service deps mocked via vi.hoisted"

patterns-established:
  - "Single tested initiation path for a cross-surface action: 29-04 (UI) and 29-05/06 (native) call downloadTrack instead of re-inlining the flow, so the format + bug-fix + state bracket can never drift again"
  - "DL-BUG-01 guarantee proven two ways: a spy asserts window.open is never called on fetch-reject/save-false, AND a source-grep test asserts the string never appears in the module body"

requirements-completed: [DL-FILE-01, DL-BUG-01, DL-STATE-01]

# Metrics
duration: ~27min (two sessions — Task 1 continuation + Task 2)
completed: 2026-07-23
---

# Phase 29 Plan 03: Shared downloadTrack Service + blobStore filename param Summary

**One isolation-safe, never-throws `downloadTrack(track, opts?)` service that orchestrates the whole single-song download (resolve→addDownload→fetch→persist→save) with a `'saved'|'no-audio'|'failed'` sentinel and no `window.open`, plus `blobStore.put(uid, blob, filename?)` threading the human filename to the native public write — the interface layer 29-04 (UI) and 29-05 (native) consume.**

## Performance

- **Duration:** ~27 min across two sessions (Task 1 committed in a prior continuation run 21:08–21:09; Task 2 this session 21:33–21:35)
- **Started:** 2026-07-23T21:08:45Z (Task 1 RED)
- **Completed:** 2026-07-23T21:35:06Z (Task 2 GREEN)
- **Tasks:** 2 (both TDD: RED→GREEN)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `downloadTrack(track, opts?)` — the single, node-testable download initiation path extracted from the ~85-line inlined `TrackMenu.doDownload`, preserving the reuse-current-quality logic (pzs-04), the RAW-fetch note, and the addDownload-before-fetch ordering.
- Never-throws + never-navigates proven in node: a fetch reject or `saveBlobToDisk` false returns `'failed'` and the DL-BUG-01 spy confirms `window.open` is never called (the song stays in `library.downloads` and re-streams on tap).
- DOWNLOAD ISOLATION (D-18) proven by throwing setters on the mocked `player.current`/`playGen` — the service reads `player.current` only and never writes any player field.
- `blobStore.put` gained an optional `filename` (Task 1) threaded to `saveToMusic` with a `<uid>.mp3` fallback so the existing single caller stays byte-for-byte unchanged.
- 33 tests green (`download-track` + `blob-store`); `pnpm check` clean (0 errors, 0 warnings).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: blobStore.put optional filename** (prior continuation run)
   - `d959fdf` test — assert put threads a human filename to the native public write (RED)
   - `0268c15` feat — blobStore.put accepts an optional human filename (GREEN)
2. **Task 2: shared downloadTrack orchestration** (this session)
   - `90f50f7` test — add failing tests for shared downloadTrack orchestration (RED)
   - `81253a6` feat — shared isolation-safe downloadTrack orchestration (GREEN)

_Note: TDD tasks have test → feat commit pairs._

## Files Created/Modified
- `src/lib/services/download-track.ts` — NEW. `downloadTrack(track, opts?)` + `DownloadResult` type + local `currentQualityMeets`. Orchestrates resolve (reuse-current or re-resolve on a COPY at `settings.downloadQuality`) → `library.addDownload` → RAW `fetch` → optional `blobStore.put(uid, blob, filename)` → `saveBlobToDisk`. Bracketed by `library.beginDownload`/`endDownload` (finally). Imports no i18n/toast; catch returns `'failed'`, never `window.open`.
- `src/lib/services/download-track.test.ts` — NEW. 12 cases: saved (re-resolve), translated filename, reuse-current, reuse-refused-on-lower-tier, different-uid-not-reused, no-audio, fetch-reject-failed (no window.open), save-false-failed, resolve-reject-degrades, persist:false, persist-default-true, D-18 throwing-setter isolation, import-contract grep.
- `src/lib/services/blob-store.ts` — MODIFIED (Task 1). `put(uid, blob, filename?)` + `nativePut(uid, blob, filename?)` passing `filename ?? nativeFileName(uid)` to `saveToMusic`.
- `src/lib/services/blob-store.test.ts` — MODIFIED (Task 1). Added "threads a human filename" + "falls back to nativeFileName when absent" cases.

## Decisions Made
- Reproduced `currentQualityMeets` inside the service rather than importing it from `TrackMenu.svelte` — keeps the service component-free and node-testable (the component keeps its own copy until 29-04 rewires it to call `downloadTrack`).
- Kept `player` imported for a READ-ONLY `.current` reuse read; the throwing-setter test is the enforcement mechanism for "read-only".
- Left `TrackMenu.doDownload` untouched this plan — rewiring the component (and deleting its `window.open`/`showSaveFilePicker`) is explicitly 29-04's scope. This plan delivers only the consumable interface.

## Deviations from Plan

None - plan executed exactly as written. (Task 1's blob-store change was already committed by a prior continuation run — verified `d959fdf`/`0268c15` present and `blob-store` tests green — so this session executed Task 2 and finalized.)

## Issues Encountered
None. Task 1 was already complete on entry (continuation); Task 2's RED failed on the missing module as expected, GREEN passed on first implementation, `pnpm check` clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 29-04 (wave 3) can now replace `TrackMenu.doDownload` and the album loop with `downloadTrack(track)` / `downloadTrack(track, { persist: false })`, delete `window.open`/`showSaveFilePicker`, and localize the returned sentinel (`toast.downloadFailedKeptInLibrary` on `'failed'`, `toast.noAudio` on `'no-audio'`, `toast.downloaded` on `'saved'`).
- 29-05 native folder work already has the `filename` param plumbed through `blobStore.put` → `saveToMusic`; the collection swap remains device-only UAT (unit tests mock `MediaStoreSaver` and cannot catch a wrong collection).
- No blockers.

## Self-Check: PASSED
- Files: FOUND `download-track.ts`, `download-track.test.ts`, `blob-store.ts`, `blob-store.test.ts`
- Commits: FOUND `d959fdf`, `0268c15`, `90f50f7`, `81253a6`
- Gates: `pnpm test -- download-track blob-store` → 33 passed; `pnpm check` → 0 errors / 0 warnings
- Min-lines: `download-track.ts` 125 (≥45), `download-track.test.ts` 338 (≥70)

---
*Phase: 29-download-ux-folder-control*
*Completed: 2026-07-23*
