---
phase: 34-import-device-songs-as-native-downloads
plan: 01
subsystem: storage
tags: [capacitor, mediastore, android, blob-store, device-import, identity]

requires:
  - phase: 999.1-v2-0-native-capacitor-migration
    provides: "platform-switched blobStore (IndexedDB on web, Filesystem + MediaStore bridge on native) and the openmusic-blob-uri index"
  - phase: 31
    provides: "MIN_BLOB_BYTES / isUsableBlob single-read-boundary size floor (31-D-13)"
provides:
  - "device-track.ts — the `device:` uid namespace, MediaStore content-URI reconstruction, and the ScanRow → Track mapper"
  - "blobStore data-loss guard: a device: uid can never reach MediaStoreSaver.deleteFromMusic"
  - "blobStore in-place device read/probe through convertFileSrc + fetch (D-04/D-05)"
  - "blobStore.linkPublicUri + the stored public-URI fallback in nativeGet/nativeHas (D-09)"
affects: [34-02 player/library device guards, 34-03 device-import merge lane, 34-04 Kotlin scanAudio bridge, 34-07 import store]

tech-stack:
  added: []
  patterns:
    - "Single-owner string literal: `'device:'` appears only in device-track.ts; every other module asks isDeviceUid()"
    - "First-statement refusal as a destructive-operation guard, placed so a later refactor cannot slip a delete above it"
    - "Second-chance read at the shared seam: app-private copy first, recorded public content URI second"

key-files:
  created:
    - src/lib/services/device-track.ts
    - src/lib/services/device-track.test.ts
  modified:
    - src/lib/services/blob-store.ts
    - src/lib/services/blob-store.test.ts
    - src/lib/sources/types.ts

key-decisions:
  - "makeUid's parameter widened to `SourceId | 'device'`; the SourceId union and SOURCES registry left untouched (34-D-01)"
  - "deviceContentUri accepts only /^\\d+$/ ids, so no path fragment can be smuggled from a uid into a content URI (T-34-03)"
  - "No device content URI is ever persisted — the URI is reconstructed from the uid, which keeps the openmusic-blob-uri index free of user-owned files by construction"
  - "readContentUri / probeContentUri extracted so the device read, the app-private read and the D-09 fallback share one implementation"
  - "Blob MIME re-typing (RESEARCH Pitfall 4) deliberately not done here — marked ponytail with its upgrade path"

patterns-established:
  - "Guard placement: destructive native calls get their refusal as the function's first statement, with the reason recorded inline"
  - "has() and get() answer the same question the same way, so the download badge cannot lie (RESEARCH bite #4 / quick-260913-jq4)"

requirements-completed: [34-D-01, 34-D-02, 34-D-04, 34-D-05, 34-D-06, 34-D-09, 34-D-15, 34-D-16]

duration: 6min
completed: 2026-09-13
---

# Phase 34 Plan 01: Device identity + the shared blobStore seam Summary

**Imported device files now have a `device:` identity, read in place through `blobStore.get`, and provably cannot be deleted by `removeDownload` — plus a real download whose app-private copy is gone now plays from its public `Music/OpenMusic/` copy.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-13T18:39:00Z
- **Completed:** 2026-09-13T18:45:00Z
- **Tasks:** 2 of 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

### Task 1 — `device-track.ts` (commit `e9d1a56`)

`deviceUid` / `isDeviceUid` / `deviceContentUri` / `tagOrEmpty` / `rowToTrack` / `DEVICE_SOURCE` / `UNKNOWN_TAG`, plus the `ScanRow` and `ParsedName` interfaces. Pure, never-throw, node-testable — no store, no Capacitor, no DOM.

- `makeUid`'s parameter is now `SourceId | 'device'`. That is the whole `types.ts` change; `SourceId` and `Track` are untouched, so `SOURCES: Record<SourceId, SourceAdapter>` still compiles.
- `deviceContentUri` rebuilds `content://media/external/audio/media/<id>` from the uid rather than storing it, and rejects anything that is not digits-only (T-34-03). Because nothing is persisted, no device URI can enter the `openmusic-blob-uri` index at all — the Pitfall-1 guard in Task 2 is the second line of defence, not the only one.
- `tagOrEmpty` carries the non-obvious rule: MediaStore writes the display-name stem into TITLE for an untagged file, so a stem-equal TITLE is MediaStore's fallback and not a tag. Without it D-15 ("tags win") would make every untagged `Artist - Title.mp3` import with the whole stem as its title and no artist.
- Precedence is `tag → parsed filename → stem` (D-15 / D-16), so an untagged, unparseable file still imports with something visible rather than being silently skipped.

17 `it()` cases (plan asked for ≥ 10).

### Task 2 — `blob-store.ts` device branch, guard and fallback (commit `fecb8db`)

- **`nativeDel` — the data-loss guard.** `if (isDeviceUid(uid)) { clearStoredUri(uid); return; }` is the function's first statement. Verified: the first real `getStoredUri(` / `deleteFromMusic(` call inside `nativeDel` is at line 266, the guard at line 255. A separate test proves a real uid still reaches `deleteFromMusic`, so the guard is narrow rather than a blanket off-switch.
- **`nativeGet` — the D-05 in-place read.** A device uid resolves its content URI and reads it via `readContentUri` (raw `fetch(convertFileSrc(uri))`). No app-private lookup, no copy (D-04). The Blob shape is kept deliberately — a comment states in plain terms that turning it into a direct `_capacitor_content_` `audio.src` is a silent seek-corruption bug, not an optimisation (RESEARCH Pitfall 2).
- **`nativeHas` — the truthful badge.** Same question, same answer path: probe the content URI. `Filesystem.stat` is never called for a device uid. This is the bite-#4 requirement, i.e. the exact class of bug `quick-260913-jq4` fixed.
- **D-09 fallback.** Both `nativeGet` and `nativeHas` now take a second chance on the recorded public URI when the app-private copy is missing or unusable, and `linkPublicUri(uid, uri)` records it — refusing device uids and empty inputs. Added to the `blobStore` namespace.
- The "OFFLINE-READ SPLIT" paragraph was amended in place (dated `34-D-09`) rather than replaced, since the original split is still accurate for the primary read.

`readContentUri` / `probeContentUri` were extracted so the device read, the app-private read and the D-09 fallback share one implementation instead of three near-copies — the app-private path's body moved into `readContentUri` unchanged, which is why all pre-existing native-get tests stayed green without edits.

50 tests in `blob-store.test.ts` (42 pre-existing, all still passing).

## Verification Results

All commands were run; these are observed outputs, not restatements of the plan.

| Check | Result |
|---|---|
| `pnpm vitest --run src/lib/services/device-track.test.ts` | 17 passed |
| `pnpm vitest --run src/lib/services/blob-store.test.ts` | 50 passed |
| `pnpm vitest --run` (full suite) | 116 files, 2149 tests passed |
| `pnpm check` | 4441 files, 0 errors, 0 warnings |
| `git diff --stat HEAD~2 HEAD` | exactly the 5 files in `files_modified` |

**The mandatory guard test exists and passes:** `del on a device: uid NEVER calls deleteFromMusic, even with a content URI in the index` — pre-seeds `openmusic-blob-uri:device:42` with a content URI, then asserts `expect(deleteFromMusic).not.toHaveBeenCalled()`, `deleteFile` untouched, and the stray index key cleared.

TDD gates observed for both tasks: tests written first and run failing (Task 1: module-not-found; Task 2: 8 failed / 42 passed), then implemented to green.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blockers were encountered.

### Acceptance-criterion note (not a code change)

One acceptance grep in the plan is comment-blind:

```
awk '/async function nativeDel/{f=1} f&&/getStoredUri|deleteFromMusic/{print NR; exit}'
```

It prints 245, which is *smaller* than the guard's 255 — but line 245 is the guard's own comment, which names `deleteFromMusic` while explaining why the refusal exists. The criterion's intent (no delete **call** precedes the guard) holds: skipping comment lines moves the first real call to 266. Recorded here rather than silently rewriting the comment to dodge a grep, since the comment is the load-bearing part.

## Assumption Drift (advisory)

**Device uid shape: `device:<volumeName>-<_ID>` → `device:<_ID>`**
- **Found during:** Task 1
- **Planned:** 34-RESEARCH recommends folding the volume name into the songid (`device:external-42`), citing the `fivesingSongType` precedent.
- **Actual:** the plan's own `<interfaces>` and `<behavior>` blocks specify plain `device:42`, digits-only, and the plan is the later artifact — so that is what shipped.
- **Why it matters:** a volume fold would have been the hedge against RESEARCH Pitfall 5 (`_ID` reuse across volumes / after an SD reinsert). Without it, `deviceContentUri` also hardcodes the `external` volume. D-02 already accepts re-import-as-new-entry after a factory reset or SD reinsert, so this is consistent with the locked decision — but if multi-volume support is ever wanted, `deviceUid` and `deviceContentUri` are the two functions to change, and both are in one file.

**MIME re-typing deferred**
- **Planned:** the plan explicitly says not to re-type here and to mark it `ponytail:`; RESEARCH Pitfall 4 calls it "one line, removes the whole class of doubt."
- **Actual:** not done, marked `ponytail:` with the upgrade path (persist `mimeType` on the Track, `blob.slice(0, size, mime)`).
- **Why it matters:** rests on `[ASSUMED A3]` (Chromium content-sniffs `blob:` sources). Device UAT item 3 (a FLAC and an m4a) is the check that retires the assumption.

## Known Stubs

None. Every export in this plan is fully implemented and exercised by a test. The `source: 'kuwo'` placeholder on a device Track is not a stub — it is a documented never-dispatched value (precedent: `similar.ts:140`), and the `ensureTrackDetails` short-circuit that makes it safe is Plan 34-02's stated work.

## Threat Flags

None. No new network endpoint, auth path, or schema was introduced. The one trust boundary touched (`nativeDel` → MediaStore delete) is narrowed, not widened, and `deviceContentUri`'s digits-only rule closes T-34-03.

## Notes for Future Phases

- **34-02** must add the `ensureTrackDetails` guard at `catalog.ts:345` before any device Track reaches the player, and the second D-06 guard (keep the library row listed) at the player's silent-eviction site / `library.removeDownload`. `blobStore` protects the *file*; the *row* is still unprotected.
- **34-03**'s merge lane is the only permitted caller of `linkPublicUri`, and must only pass URIs for files under `Music/OpenMusic/`.
- **34-04**'s Kotlin `scanAudio` must emit `uri` as `ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri(VOLUME_EXTERNAL), id)`. `device-track.test.ts` pins that `deviceContentUri(deviceUid(row.id)) === row.uri`, so a drift there fails a test rather than silently breaking playback.
- **34-07**'s store test can copy the `./media-store` mock factory from `blob-store.test.ts`, which now includes `scanAudio` / `requestReadAudio`.

## Self-Check: PASSED

- `src/lib/services/device-track.ts` — FOUND
- `src/lib/services/device-track.test.ts` — FOUND
- `src/lib/services/blob-store.ts` — FOUND (modified)
- `src/lib/services/blob-store.test.ts` — FOUND (modified)
- `src/lib/sources/types.ts` — FOUND (modified)
- Commit `e9d1a56` — FOUND
- Commit `fecb8db` — FOUND
