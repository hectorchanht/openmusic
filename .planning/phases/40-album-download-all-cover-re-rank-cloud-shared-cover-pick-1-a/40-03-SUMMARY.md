---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
plan: 03
subsystem: download
tags: [download, album, i18n, zip, ytmusic]
requires:
  - "40-01: buildZip, albumDir, albumFolder"
  - "40-02: blobStore.put dir / moveToDir, downloadTrack dir + onSaved"
provides:
  - "download-album.ts: downloadAlbum(tracks, { artist, album }, onProgress) -> { saved, total }, never throws"
  - "toast.albumProgress / toast.albumSaved in all 15 locales"
  - "visible album Download button"
affects: [album page, download-track, zip-store]
tech-stack:
  added: []
  patterns: ["ytmusic donor fallback through the Download-from picker's lookup + audioFrom contract"]
key-files:
  created:
    - src/lib/services/download-album.ts
    - src/lib/services/download-album.test.ts
  modified:
    - src/routes/(app)/album/[name]/+page.svelte
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/zip-store.ts
    - src/lib/services/zip-store.test.ts
    - src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "downloadTrack treats a non-2xx response or an empty body as 'failed' (was: 0-byte file reported as saved)"
  - "A ytmusic album song takes its audio from the first non-ytmusic donor (fetchVariants + versionsIncludingOwn + probeDownload, audioFrom); the ytmusic file is the last resort"
  - "Album zip central headers say made-by Unix (0x0314) with a 0644 mode, plus the 0x7075 Unicode Path extra field, so Apple /usr/bin/unzip extracts CJK names"
metrics:
  duration: ~45min
  completed: 2026-09-30
  tasks: 3
  files: 22
---

# Phase 40 Plan 03: Album download end to end Summary

The album Download button is back. It downloads every song through the shared `downloadTrack` with the offline copy kept (`persist: true, save: false`). On Android the songs land in `Music/OpenMusic/<Artist>/<Album>/`, and a song already held as a single is moved there. On web you get one `<Artist> - <Album>.zip`. YouTube Music songs take their audio from another source, so 范特西 now saves 10 of 10.

## What was built

- **`download-album.ts`** runs a sequential loop. For each song it first looks for one already held, matched by uid or `sameSongKey`.
  - Native: a held song is moved with `moveToDir` and still counts as saved if the move fails.
  - Web: a held song's stored blob is reused. An empty held blob falls through to a re-download.
  - A song that is not held goes through `downloadTrack` with `dir` (native) or `onSaved` (web). The track number is `i + 1`, and the 36-D-11 comment was kept.
  - A ytmusic song tries the donors first, the same way the "Download from…" sheet does.
  - On web, one `buildZip` and one `saveBlobToDisk(zip, '<folder>.zip')` run at the end. A zip that cannot be built or saved means saved = 0.
  - `onProgress` is wrapped in try/catch. There is no `setTimeout` stagger, and no i18n or toast import.
- **Album page.** It is now a thin handler. It passes the display-language names (`names.dnArtist(albumArtist)`, `names.dnTitle(name)`) and shows `toast.albumProgress` while running, then `toast.albumSaved`. The service is imported as `downloadAlbumTracks` because the page's own handler is called `downloadAlbum`. The button is no longer commented out and keeps `disabled={busyAction === 'download'}`.
- **i18n.** Two keys were added to all 15 locales, double-quoted, with the same placeholders everywhere.
- **`downloadTrack`**: `!resp.ok` and an empty body both return `'failed'`.
- **`zip-store`**: added the 0x7075 Unicode Path extra field (version 1, CRC-32 of the header name bytes, UTF-8 name) to the local and central headers. The central header also says made-by Unix with external attributes `0x81a40000`. The 0x0800 flag is kept.

## Verification (observed)

- `pnpm test`: 170 files, 3788 tests passed. `pnpm check`: 0 errors, 12 warnings, all pre-existing. `pnpm build`: exit 0. `JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm apk`: BUILD SUCCESSFUL.
- `download-album.test.ts` has 18 tests.
  - RED was observed when the test file was committed alone (the module did not exist yet).
  - Mutation checks: removing the `sameSongKey` match or the name dedupe failed 3 tests. Disabling the ytmusic donor branch failed 2 tests. Removing the `resp.ok` and empty-body guards failed the new download-track test.
- **Web E2E** (headless Chrome, `/album/范特西?artist=周杰伦`, 10 tracks):
  - Run 1, before any fixes: "Saved 10 of 10", but 5 YouTube Music entries in the zip were 0 bytes. That led to the `downloadTrack` fix.
  - Run 2, same profile: "Saved 6 of 10". The 5 held songs were reused from IndexedDB with no re-fetch (21 s instead of 204 s).
  - Run 3, final code, fresh profile: toasts went `Preparing download…` → `Downloading 1 of 10…` … `10 of 10…` → **`Saved 10 of 10`**. One download fired, `周杰倫 - 范特西.zip` (66.6 MB). `/usr/bin/unzip -t` printed "No errors". `/usr/bin/unzip` extract exited 0 and produced `周杰倫 - 范特西/周杰倫 - <Title>.<ext>` with correct CJK names, 10 non-empty files. `file` identifies them as MP4/Ogg.
- **Android E2E** (Pixel_3a_API_34, API 34, APK against the production `/api`). This ran before the donor fallback was added.
  - The single 簡單愛 landed flat: `_id=1000000022 relative_path=Music/OpenMusic/`.
  - Album Download then showed "Saved 4 of 10". Every saved row is at `Music/OpenMusic/周杰倫/范特西/`, including the single (same `_id`, moved, no flat duplicate).
  - After a retag, all 4 rows were still in the album folder. The `_id`s changed because a retag rewrites the file; there is still one row per song.
  - Remove download on 忍者 removed its MediaStore row.
- **Not verified:**
  - Offline playback of an album song. The user deferred it to `/gsd:verify-work`.
  - The ytmusic donor path on the emulator. It is unit-tested and E2E-verified on web only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A download that failed was reported as saved, with a 0-byte file**
- **Found during:** Task 3 web E2E
- **Issue:** `fetch()` does not reject on a 403. The ytmusic stream proxy answers a full GET with a 403 and an empty `audio/mp4` body, so `downloadTrack` persisted and saved 0 bytes and returned `'saved'`. This affected single downloads too.
- **Fix:** return `'failed'` on `!resp.ok` or an empty body. A test was added.
- **Files modified:** src/lib/services/download-track.ts, download-track.test.ts
- **Commit:** a2857c4a

**2. [Rule 1 - Bug] Empty stored blobs could reach the zip**
- **Fix:** a held single whose stored blob is empty is re-downloaded. A fresh download uses the stored blob only when it is non-empty.
- **Commit:** 615f3b06

**3. [Rule 1 - Bug] The album track-number guard test read the old page loop**
- **Issue:** the guard test (`trackNumber: String(i + 1)`, never `displayIndex`) in `download-track.test.ts` still read the album page.
- **Fix:** it now reads `download-album.ts`.
- **Commit:** 1040745a

**4. [User-requested at checkpoint] YouTube Music donor fallback**
- **Issue:** ytmusic songs cannot be fetched by the album path (web: googlevideo 403; native: CORS).
- **Fix:** they now take audio from the "Download from…" lookup (`fetchVariants` + `versionsIncludingOwn` + `probeDownload`, one donor at a time) through the `audioFrom` contract, under the song's own identity. The ytmusic file itself is tried last.
- **Commit:** aeb49c2c

**5. [User-requested at checkpoint] Info-ZIP Unicode Path field, plus made-by Unix**
- **Issue:** the 0x7075 field alone did not fix Apple's unzip. The run-3 zip of an earlier build carried 0x7075 and still failed, because Apple's build has no UNICODE_SUPPORT and CP437-translates names of MS-DOS-made entries.
- **Fix:** the central header also declares made-by Unix with a 0644 regular-file mode, which makes `/usr/bin/unzip` take the UTF-8 bytes verbatim.
- **Commit:** ac79e756

**6. [Naming]** The page imports the service as `downloadAlbumTracks` because the page's own handler is called `downloadAlbum`. The markup still says `onclick={downloadAlbum}`.

**7. [Scope]** `download-album.ts` also imports the `names` store, so a held single's zip entry name uses the same display-language names as a fresh download.

## Assumption Drift (advisory)

- **Found during:** checkpoint follow-up (zip)
- **Planned:** the 0x7075 Unicode Path field makes macOS `/usr/bin/unzip` extract CJK names.
- **Actual:** it also needed "version made by" set to Unix.
- **Why:** the Apple build lacks UNICODE_SUPPORT and its name mangling comes from the MS-DOS host translation.

## Known Stubs

None.

## Known limitations

- Re-running an album where an old ytmusic download stored a 0-byte blob can leave that stale library entry next to the re-downloaded copy, if the second resolve picks a different uid. Only data from before the fix is affected.

## Threat Flags

None. Entry names still come only from `albumFolder` + `buildDownloadFilename`/`sanitizeFilename`. The donor lookup reuses the existing governed picker path (`searchAll` is memoised, there is one probe at a time, and nothing is added to the `apiFetch` fan-out).

## Self-Check: PASSED

- FOUND: src/lib/services/download-album.ts, download-album.test.ts, zip-store.ts, download-track.ts, album +page.svelte
- FOUND commits: 66348e09, aec7c839, 1040745a, a2857c4a, 615f3b06, aeb49c2c, ac79e756
