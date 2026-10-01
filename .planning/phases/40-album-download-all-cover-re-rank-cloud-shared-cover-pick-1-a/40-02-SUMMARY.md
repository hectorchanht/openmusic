---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 02
subsystem: download
tags: [download, android, mediastore, blob-store]
requires: ["40-01: sanitizePathSegment / albumDir"]
provides:
  - "MediaStoreSaver.saveToMusic subPath (validated by Kotlin safeSubPath) + moveInMusic"
  - "blob-store: sticky openmusic-blob-dir:<uid> index, put(uid, blob, name, { dir }), moveToDir, getStoredDir"
  - "downloadTrack opts.dir + opts.onSaved"
affects: [40-03]
tech-stack:
  added: []
  patterns: ["per-uid sticky localStorage index re-validated on read", "conditional spread to keep a bridge call shape byte-identical"]
key-files:
  created: []
  modified:
    - android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
    - src/lib/services/media-store.ts
    - src/lib/services/blob-store.ts
    - src/lib/services/blob-store.test.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
decisions:
  - "getStoredDir rejects (reads as flat) any stored dir that is not already a sanitizePathSegment fixed point or has more than 2 segments, instead of repairing it segment by segment"
  - "The same cleanDir check runs on put opts.dir and moveToDir's target, so an unclean dir never reaches the bridge"
  - "onSaved fires whenever the fetch succeeded, including persist:false, before the save:false early return"
metrics:
  duration: ~8min
  completed: 2026-09-30
  tasks: 3
  files: 6
---

# Phase 40 Plan 02: Native album folder plumbing Summary

The Kotlin `MediaStoreSaver` now takes a validated `Artist/Album` `subPath` and gains `moveInMusic`. `blob-store` keeps a sticky per-uid folder so dir-less rewrites never un-file an album song, and adds `moveToDir`. `downloadTrack` passes `dir` through and fires `onSaved`. Nothing passes `dir` yet, so current behaviour is unchanged.

## What was built

- **Kotlin** (`MediaStoreSaverPlugin.kt`): `relPath(sub)` replaces the fixed `relativePath`. `safeSubPath` rejects more than 2 segments, blank, `.`/`..`, backslash and control chars. `saveToMusic` and `publicMusicPermsCallback` both re-read `subPath` (Pitfall 2) and reject `bad-subpath`. `performSave` writes to `relPath(sub)` on API 29+ and to `OpenMusic/<sub>` on legacy. New `moveInMusic`: on a content uri it updates RELATIVE_PATH and resolves the same uri. On a file uri it sits behind the `publicMusic` gate (with its own `movePermsCallback`), renames the file, scans the old and new paths, and resolves the new file uri. Any failure rejects `io:move`.
- **TS** (`media-store.ts`): `subPath?: string` on `saveToMusic` and the `moveInMusic` signature, both with JSDoc.
- **blob-store.ts**: `openmusic-blob-dir:<uid>` index (`getStoredDir` exported, plus set/clear), and `cleanDir` validation. In `nativePut`, `dir = cleanDir(opts.dir) ?? getStoredDir(uid)` and `subPath` is spread in only when `dir` is set. The index is recorded only for an explicit `opts.dir`. `del` clears the index above the native fork. `moveToDir` refuses device uids, returns false on web, returns false for a bad dir, returns true without moving when already in that dir, and returns false when there is no stored uri. Otherwise it stores the returned uri and the dir. It never throws. `getStoredDir` and `moveToDir` are on the `blobStore` namespace.
- **download-track.ts**: `opts.dir` / `opts.onSaved`. `put` gets a 4th `{ dir }` arg only when `dir` is set. `onSaved` is wrapped in try/catch and fires before the `save:false` return. The stale "album bulk path" doc is rewritten.

## Verification (observed)

- `pnpm exec vitest --run src/lib/services/blob-store.test.ts src/lib/services/download-track.test.ts`: 162 passed (107 blob-store incl. 11 new, 55 download-track incl. 5 new). Pre-existing saveToMusic / put call-shape tests pass unmodified.
- RED observed first: blob-store 9 failed / 98 passed, download-track 2 failed / 53 passed.
- Full suite `pnpm test`: 169 files, 3774 tests passed.
- `pnpm check`: 0 errors, 12 warnings (all pre-existing, unrelated `.svelte` files).
- `JAVA_HOME=…openjdk@21… pnpm apk`: exit 0, BUILD SUCCESSFUL. `:app:compileDebugKotlin` executed (not up-to-date), so the new Kotlin compiles.
- Acceptance greps: Kotlin `fun moveInMusic|fun safeSubPath|fun relPath` = 3, `private val relativePath` = none, `getString("subPath")` = 4. media-store `subPath?: string` = 1, `moveInMusic(opts: { uri: string; subPath: string })` = 1. blob-store `openmusic-blob-dir:` = 1, `export async function moveToDir` = 1, `moveToDir` = 3, `subPath: dir` = 1, `sanitizePathSegment` = 3. download-track `onSaved` = 3, `{ dir: opts.dir }` = 1, `album bulk path` = none.
- **Not verified here:** the real MediaStore behaviour on a device or emulator (an album save landing in a subfolder, a move on API 29+ and on ≤28, same-name collision on update). Per the plan this is UAT in Plan 03's human-verify checkpoint.

## Deviations from Plan

**1. [Rule 2 - Security] getStoredDir rejects instead of repairing.** The plan said to map each segment through `sanitizePathSegment` and drop empties. That turns `../x` into `x`, but the plan's own behaviour line expects `../x` to read as absent. `cleanDir` therefore returns null unless every segment is already a sanitizer fixed point and there are at most 2 segments. The same check guards `put` opts.dir and `moveToDir`. Commit f2e3be2b.

**2. [Acceptance-driven] Legacy move permission callback named `movePermsCallback`.** The name `moveInMusicPermsCallback` would have made the `fun moveInMusic` grep count 4. Commit 504ef0e4.

**3. [Convention] Decision refs** use the house `40-D-0N` form, the same as Plan 01, rather than "Phase 40 D-0N". The describe titles keep the plan's literal text.

## Known Stubs

None. `dir` / `onSaved` / `moveToDir` have no callers yet by design; Plan 03 wires them.

## Threat Flags

None beyond the plan's register (T-40-02-01..05 mitigated as planned).

## Self-Check: PASSED

- FOUND: all 6 modified files
- FOUND commits: 504ef0e4, adcb1b4d, f2e3be2b, 5c908e2f, 946a5d0d
