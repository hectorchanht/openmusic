---
phase: 35-one-click-export-and-import-of-all-app-data
plan: 03
subsystem: backup
tags: [backup, capacitor, share, platform-split, downloads, pacing]
requires:
  - "@capacitor/filesystem (already installed) for the native cache write"
  - "$lib/services/download-save: saveBlobToDisk (the web anchor seam)"
provides:
  - "$lib/services/backup-io: exportBackup, ExportResult"
  - "$lib/backup/sweep: findMissing, sweepMissing, SweepDeps, SweepResult"
  - "@capacitor/share@^8.0.1 declared + registered in the Android project"
affects:
  - "plan 04 (settings/data page) imports exportBackup and sweepMissing/findMissing by name"
  - "plan 05 device checkpoint exercises the share sheet these gradle edits register"
tech-stack:
  added:
    - "@capacitor/share@8.0.1"
  patterns:
    - "platform split behind ONE isNativePlatform() branch (blob-store.ts template)"
    - "never-throw service returning a sentinel; a dismissed share sheet is 'dismissed', not 'failed'"
    - "dependency injection instead of vi.mock so the sweep stays pure and node-testable"
    - "sequential-with-stagger bulk loop copied from the album bulk-download path"
key-files:
  created:
    - src/lib/services/backup-io.ts
    - src/lib/services/backup-io.test.ts
    - src/lib/backup/sweep.ts
    - src/lib/backup/sweep.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - android/capacitor.settings.gradle
    - android/app/capacitor.build.gradle
decisions:
  - "`Directory.Data` is not mentioned anywhere in backup-io.ts, not even in a comment — the plan's prose asked for a comment naming it while an acceptance grep required zero occurrences; the comment says 'the app-files directory' instead so both hold"
  - "exportBackup's web branch contains NO await at all (not merely 'no await before the save'), so the iOS gesture task cannot be lost to a future edit"
  - "'no-audio' folds into `failed` in the sweep result — the user wants one number for 'did not come back'"
  - "The sweep re-probes presence at the TOP of each iteration rather than filtering up front, which is what makes a killed run resumable with no bookmark or persisted progress key"
  - "The web/native `blobStore.has` size-floor asymmetry is accepted and documented in findMissing's header, not worked around"
metrics:
  duration: ~12 min
  completed: 2026-09-13
---

# Phase 35 Plan 03: Share Dependency, Export Seam and Download Sweep Summary

Adds `@capacitor/share` (zero Android source edits needed) and the two runtime seams the Settings → Data page will sit on: `backup-io.ts`, the phase's single platform branch for getting the backup file out of the app, and `sweep.ts`, a strictly sequential, abortable re-download loop whose concurrency of 1 is a deliberate mitigation rather than a style choice.

## What Was Built

### Task 1 — `@capacitor/share@8.0.1` + `cap sync` (commit `145cac4`)

`pnpm add @capacitor/share@^8.0.1` then `npx cap sync android`. The sync reported 7 Capacitor plugins including `@capacitor/share@8.0.1` and rewrote `android/capacitor.settings.gradle` + `android/app/capacitor.build.gradle`. `AndroidManifest.xml` and `res/xml/file_paths.xml` were **not** touched — the FileProvider authority `${applicationId}.fileprovider` and the `<cache-path>` root the plugin needs already exist, exactly as research predicted.

Observed acceptance output:

```
pkg: 1              # "@capacitor/share": "^8.0.1"
settings.gradle: 2  # capacitor-share
build.gradle: 1     # capacitor-share
d.ts OK
8.0.1               # node -e require('@capacitor/share/package.json').version
(git diff --stat on AndroidManifest.xml / file_paths.xml printed nothing)
pnpm check -> COMPLETED 4507 FILES 0 ERRORS 0 WARNINGS
```

An unrelated pre-existing peer warning surfaced during install (`@jofr/capacitor-media-session` wants `@capacitor/core@^6`, found `8.4.0`); it predates this plan and was not touched.

### Task 2 — `src/lib/services/backup-io.ts` (RED `63d606d`, GREEN `c081c12`)

`exportBackup(json, filename): Promise<'ok' | 'dismissed' | 'failed'>` — the phase's only `isNativePlatform()` branch (D-18).

- **Web (D-14):** builds a `Blob` with `type: 'application/json'` and hands it straight to `saveBlobToDisk`. There is **no `await` anywhere in the function body**, so the anchor save still executes inside the tap's gesture task (iOS drops a programmatic anchor activation once a turn of the loop has passed). The anchor/object-URL machinery is not reimplemented — that seam is grep-guardrailed against DL-BUG-01.
- **Native (D-16/D-17):** writes the string to `Directory.Cache` with `Encoding.UTF8`, resolves the `file://` URI via `getUri`, and opens the share sheet. Two separate `try` blocks: a write failure is `'failed'`, a rejected share **after** a successful write is `'dismissed'`. The cache file is deliberately left behind.

Observed: `npx vitest run src/lib/services/backup-io.test.ts` → **7 passed**. Acceptance greps: `Directory.Cache` 2 lines, `Directory.Data` 0 (anywhere, including comments), `encoding: Encoding.UTF8` 1, `createObjectURL|.click()` 0, `export default` 0, and the `awk` window over `exportBackup` shows a single line — `saveBlobToDisk` at relative line 9 with no `await` line at all.

### Task 3 — `src/lib/backup/sweep.ts` (RED `d528c3f`, GREEN `793967b`)

`findMissing(tracks, has)` probes all uids together (one index lookup each on web) and returns the absent tracks in input order; a probe that throws reads as absent.

`sweepMissing(tracks, deps)` walks the list **one track at a time**: abort check → `has` re-probe → `download` → count → 250 ms stagger (0 in tests). It never throws — an injected `download` that rejects counts as `failed`, as does `'no-audio'`. `onProgress` fires once per processed track, skipped ones included, so a progress bar always reaches `(n, n)`.

Both dependencies are injected rather than imported: `download-track.ts` transitively pulls in the `player` / `library` / `settings` / `names` runes stores, which the single node Vitest project cannot load.

Observed: `npx vitest run src/lib/backup/sweep.test.ts` → **7 passed**, including the `peak === 1` concurrency guard and the interleaved `has kuwo:1, download kuwo:1, has kuwo:2, …` log assertion. Acceptance greps: `^import { ` 0, `^import type` 2, `Promise.all` 1, `signal?.aborted` at line 80, `localStorage|sessionStorage` 0.

## Verification

| Command | Result |
|---|---|
| `npx vitest run src/lib/backup/ src/lib/services/backup-io` | 4 files, **52 passed** (includes plan 01's backup-logic + roundtrip suites) |
| `pnpm check` | `COMPLETED 4513 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test` (full suite) | 120 files, **2211 passed** |

VALIDATION.md rows 35-03-02 (D-14 web branch) and 35-03-03 (D-06/D-07 sweep) now have passing automated commands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `download` mock had no typed parameter, so `mock.calls[0][0]` was a zero-length tuple**
- **Found during:** Task 3, at the `pnpm check` gate (the tests themselves passed)
- **Issue:** `vi.fn(async (): Promise<DownloadResult> => 'saved')` infers `calls: [][]`; `svelte-check` reported two errors — `Tuple type '[]' has no element at index '0'` and an `undefined → Track` assertion complaint. `pnpm check` is the project's only linter and must be clean.
- **Fix:** typed the mock as `vi.fn(async (_track: Track): Promise<DownloadResult> => 'saved')` and dropped the now-redundant `as Track` cast in the assertion.
- **Files modified:** `src/lib/backup/sweep.test.ts`
- **Commit:** `793967b`

### Known Plan Defect (honoured the grep, rephrased the prose)

Task 2's `<action>` asked for a comment stating that "`Directory.Data` would need a `<files-path>` entry that does not exist", while its acceptance criterion required `Directory.Data` to appear zero times outside comments — and the criterion's own exclusion filter (`grep -v '^\s*//'`) is unreliable on macOS BSD grep with tab-indented comments. Rather than gamble on which grep dialect runs, the comment conveys the same warning using the phrase "the app-files directory", so `grep -c "Directory\.Data"` returns **0 for the whole file**. The intent (do not write the share file outside the `<cache-path>` root) is preserved verbatim; only the token is avoided. Same shape as the defect flagged in plan 35-01.

### Concurrency Notes

Another session is executing phase 36 in this working tree. Consequences recorded rather than acted on:

- `src/lib/services/download-track.ts` was flagged as possibly dirty. It was **clean** by the time this plan read it, and its `downloadTrack(track, opts?): Promise<DownloadResult>` signature is intact (phase 36 added `trackNumber` / `albumArtist` opts and an in-memory tagging step, neither of which affects the sweep, which only imports the `DownloadResult` **type**).
- Two phase-36 commits (`48ae0cc`, `7c4f440`) interleave with this plan's commits in `git log`. Nothing was staged outside this plan's declared paths; every commit used explicit `git add <path>`.
- Per the execution brief, `state.advance-plan` was **not** run — STATE.md's shared position cursor is left alone and only additive edits were made.

## Assumption Drift (advisory)

None material. Research's predictions about `cap sync` (one plugin added, zero Android source edits) and the FileProvider/`<cache-path>` situation held exactly.

## Known Stubs

None. Both modules are complete and fully exercised; they are simply not wired to any UI yet — plan 04 does that. Nothing user-visible ships from this plan, so the commits are safe on `main`.

## Notes for Plan 04

- Call `exportBackup(serializeEnvelope(env), backupFilename())` **directly in the click handler**, with nothing awaited before it.
- Inject the sweep: `sweepMissing(missing, { has: blobStore.has, download: (t) => downloadTrack(t, { save: false }), signal, onProgress })`. `save: false` is what keeps 200 songs from producing 200 browser save dialogs.
- `exportBackup` returns three outcomes; `'dismissed'` must show nothing or a neutral message, never an error toast.

## Self-Check: PASSED

- `src/lib/services/backup-io.ts` — FOUND
- `src/lib/services/backup-io.test.ts` — FOUND
- `src/lib/backup/sweep.ts` — FOUND
- `src/lib/backup/sweep.test.ts` — FOUND
- Commits `145cac4`, `63d606d`, `c081c12`, `d528c3f`, `793967b` — all FOUND in `git log`
