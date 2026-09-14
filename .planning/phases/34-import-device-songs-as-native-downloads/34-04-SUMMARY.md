---
phase: 34-import-device-songs-as-native-downloads
plan: 04
subsystem: storage
tags: [capacitor, kotlin, mediastore, android, permissions, device-import]

requires:
  - phase: 999.1-v2-0-native-capacitor-migration
    provides: "the hand-written MediaStoreSaver Capacitor plugin (write-only) and its TS wrapper"
  - phase: 34
    plan: 01
    provides: "ScanRow and the deviceContentUri reconstruction contract"
provides:
  - "MediaStoreSaverPlugin.requestReadAudio — tap-time audio-read grant with a four-state result"
  - "MediaStoreSaverPlugin.scanAudio — paged, bound-arg MediaStore.Audio cursor over Music/ + Download/"
  - "manifest declarations for READ_MEDIA_AUDIO and READ_EXTERNAL_STORAGE(maxSdk 32)"
  - "media-store.ts typings for both new bridge methods + the ReadAudioState union"
affects: [34-07 import store, 34-09 device APK verification]

tech-stack:
  added: []
  patterns:
    - "Two permission aliases for one logical grant, chosen at call time — the @CapacitorPlugin annotation cannot express an SDK condition"
    - "Permanent-denial detection only inside the permission callback, where shouldShowRequestPermissionRationale is unambiguous"
    - "Bundle query args (QUERY_ARG_SQL_SELECTION_ARGS) so the folder filter is bound SQL, never interpolation"

key-files:
  created: []
  modified:
    - android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
    - android/app/src/main/AndroidManifest.xml
    - src/lib/services/media-store.ts

key-decisions:
  - "Scan is API 29+ only; API <= 28 resolves 'unsupported' / an empty page rather than carrying a second column set and DATA-LIKE selection (RESEARCH Pitfall 6 lazy alternative, taken explicitly)"
  - "Paging branches on API 30: QUERY_ARG_LIMIT/OFFSET on R+, LIMIT/OFFSET appended to the sort order on API 29 — the API-30 constants would be silently ignored there and every page would return the whole table"
  - "total comes from a second count-only query (projection _ID, same selection, no limit) rather than being inferred from a short page"
  - "One plugin, one registerPlugin call — the read methods live beside the write methods (CONTEXT code_context)"

requirements-completed: [34-D-11, 34-D-02, 34-D-14]

duration: 4min
completed: 2026-09-14
---

# Phase 34 Plan 04: Kotlin read bridge — permission + paged MediaStore scan Summary

**The MediaStoreSaver plugin can now read as well as write: one tap-time permission request with an honest four-state result, and a paged `_ID ASC` cursor over `Music/` + `Download/` that emits the exact content URI `device-track.ts` reconstructs.**

## Performance

- **Duration:** ~4 min (02:10Z → 02:14Z)
- **Tasks:** 2 of 2
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

### Task 1 — Kotlin permission + scan, manifest (commit `4aaa566`)

- **Two aliases, one grant.** `readAudio33` (READ_MEDIA_AUDIO) and `readAudioLegacy` (READ_EXTERNAL_STORAGE) joined `publicMusic` in the `@CapacitorPlugin` block; `readAlias()` / `readPermission()` / `hasReadAudio()` pick between them at call time, mirroring how `saveToMusic` branches on `SDK_INT`.
- **`requestReadAudio`** resolves `unsupported` below API 29, `granted` when already held, else requests through `readAudioPermsCallback`. The callback decides `denied` vs `denied-permanently` from `activity.shouldShowRequestPermissionRationale(readPermission())` — with a comment recording *why* that check is only trustworthy there (we just asked, so the "never asked" case that also returns `false` cannot occur).
- **`scanAudio`** clamps `offset` to `>= 0` and `limit` to `1..1000` (default 500) before anything touches the provider (T-34-07/V13), guards on `hasReadAudio()` (T-34-09), and wraps `performScan` in one try/catch → `call.reject`.
- **`performScan`** queries `MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)` with an 11-column API-29-safe projection, a bound `RELATIVE_PATH LIKE ? OR RELATIVE_PATH LIKE ?` selection against `Music/%` + `Download/%` (T-34-06), and emits flat `JSObject` rows whose `uri` is `ContentUris.withAppendedId(collection, id)` — the string `deviceContentUri` rebuilds. The collection contract is spelled out in a comment at the call site because changing it silently breaks playback of every imported file.
- **Manifest:** both read permissions declared (READ_EXTERNAL_STORAGE capped at `maxSdkVersion="32"`), and the D-11 comment block rewritten — the stale sentence claiming "NO READ_MEDIA_AUDIO … is requested" is gone (RESEARCH Security V4); the WRITE_EXTERNAL_STORAGE sentences were kept verbatim.

### Task 2 — `media-store.ts` typings (commit `bc9ef95`)

`ReadAudioState` plus the two interface methods, `ScanRow` imported as a type from `./device-track` (34-01 landed first, so no local duplicate was needed). The JSDoc carries the never-throws mapping in the file's house style: a `requestReadAudio` reject → `'denied'` (soft, button stays tappable); a `scanAudio` reject → that page failed → import reports `'failed'` and the D-07 drop pass does NOT run, since a failed page is transient and never "confirmed gone" (D-08). Header comment gained a `34` paragraph: read + write, permission-gated, bytes still never cross the bridge. No second `registerPlugin` call.

## Verification Results

All commands were run; these are observed outputs.

| Check | Result |
|---|---|
| `./gradlew :app:compileDebugKotlin --offline` (JDK 21) | `BUILD SUCCESSFUL`, exit 0 |
| `pnpm check` | 4521 files, 0 errors, 0 warnings |
| `pnpm vitest --run src/lib/services/blob-store.test.ts` | 53 passed |
| `pnpm vitest --run` (full suite) | 123 files, 2301 tests passed (baseline held) |
| `grep -c '@PluginMethod'` | 4 |
| alias greps (`publicMusic` / `readAudio33` / `readAudioLegacy`) | 3 lines |
| `QUERY_ARG_LIMIT\|QUERY_ARG_OFFSET\|QUERY_ARG_SQL_SELECTION_ARGS` | 5 lines |
| `LIKE '` (interpolated literal — must be absent) | no matches |
| `MediaStore.VOLUME_EXTERNAL)` | 1 line, inside `performScan` |
| `shouldShowRequestPermissionRationale` / `"denied-permanently"` | 2 lines (1 call + 1 comment) / 1 |
| manifest: `READ_MEDIA_AUDIO` / `maxSdkVersion="32"` / `NO READ_MEDIA_AUDIO` | present / present on the next line / 0 |

**Not verified here:** nothing about this runs off-device. The plugin was compiled, not executed — whether `READ_MEDIA_AUDIO` actually exposes `Download/` rows (RESEARCH Pitfall 7) and whether the API-29 paging branch behaves are device questions, and Plan 34-09 is the hard gate for both.

**Acceptance-criterion note (not a code change):** the criterion `grep -n "ALBUM_ARTIST\|GENRE\|BITRATE\|MediaMetadataRetriever" …Plugin.kt` returns nothing expects zero hits; it returns 3 — all of them *comments* that name those columns in order to say "do NOT add them" / "no MediaMetadataRetriever is involved". The intent (no such column in the projection, no MMR call) holds: the projection is 11 explicit `MediaStore.Audio.Media.*` constants, none of them API-30. Recorded rather than deleting the load-bearing warning comments to dodge a grep — the same call 34-01 made.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] API-29 paging would have returned the whole table on every page**
- **Found during:** Task 1
- **Issue:** the plan prescribes `ContentResolver.QUERY_ARG_LIMIT` / `QUERY_ARG_OFFSET` in the query Bundle. Those two constants were added in **API 30**, but the scan's floor is API 29. They compile (compileSdk 36) and an unknown Bundle key is silently ignored by a pre-R provider — so on API 29 every page would have come back as the entire matching table: the exact Pitfall-9 payload blow-up the paging exists to prevent, plus duplicated rows across pages.
- **Fix:** one `if (SDK_INT >= R)` inside the Bundle builder. R+ uses `QUERY_ARG_LIMIT`/`QUERY_ARG_OFFSET` as planned; API 29 appends `LIMIT n OFFSET m` to `QUERY_ARG_SQL_SORT_ORDER` (the pre-R way — API 30 added the strict-token check on sort order that makes this unsafe on R+, which is why it is a branch and not a single path). Both go through the same Bundle query; the comment records why.
- **Files modified:** `MediaStoreSaverPlugin.kt`
- **Commit:** `4aaa566`

### Deferred / not in scope

`MediaStore.getVersion` (RESEARCH's recommended staleness signal, sketched in Pattern 2 as a third `resolve` key) is NOT emitted — the plan's `<interfaces>` fixes the resolve shape at `{ rows, total }` and 34-01 pinned the TS side to it. If the re-sync plan wants it, it is one `put("version", …)` and one optional field.

## Assumption Drift (advisory)

**Bundle query args are not uniformly available on the scan's floor**
- **Found during:** Task 1
- **Planned:** the plan presents the `Bundle` form as "the non-deprecated way to page", implicitly uniform from API 26 across the whole supported range.
- **Actual:** only the three SQL keys are API 26; `QUERY_ARG_LIMIT` / `QUERY_ARG_OFFSET` are API 30, so the supported range is split at R, not at Q.
- **Why it matters:** the module now has two paging paths, and only the R+ one is exercised on a modern test device. An API-29 device is the only way to observe the fallback, and none is in the 34-09 UAT list — so on API 29 this is compiled-and-reasoned, not verified.

## Known Stubs

None. Both methods are fully implemented. No web behaviour changed — nothing calls them until Plan 34-07's store lands, which is the plan's stated shape, not a stub.

## Threat Flags

None beyond the register the plan already carries. The new surface is the permission grant itself (T-34-08), and it is scoped as narrowly as the platform allows: audio only, `READ_EXTERNAL_STORAGE` capped at 32, no `MANAGE_EXTERNAL_STORAGE`, requested at tap time, and the manifest comment now states this truthfully instead of denying it.

## Notes for Future Phases

- **34-07** should default its page size to 500 to match the Kotlin default, treat a reject as one failed page (not a failed import that clears state), and stop at `offset >= total` rather than at a short page — a short page is possible in principle if rows vanish mid-walk.
- **34-09** must check a `Download/` file end to end (Pitfall 7 is the one MEDIUM-confidence claim this whole lane rests on) and, if any API-29 hardware is reachable, the paging fallback above.

## Self-Check: PASSED

- `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` — FOUND (modified)
- `android/app/src/main/AndroidManifest.xml` — FOUND (modified)
- `src/lib/services/media-store.ts` — FOUND (modified)
- Commit `4aaa566` — FOUND
- Commit `bc9ef95` — FOUND
