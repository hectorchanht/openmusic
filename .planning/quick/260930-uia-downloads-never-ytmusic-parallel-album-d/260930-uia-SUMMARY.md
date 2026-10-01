---
phase: quick-260930-uia
plan: 01
subsystem: downloads
tags: [download, ytmusic, album, concurrency, progress]
requires: [quick-260916-0d9 audioFrom contract, 40-03 album download, quick-260919-l9e SongRow resolve-on-tap]
provides: [canDownloadFrom rule, ytmusic donor path in downloadTrack, 3-wide album pool, per-row album download rings]
affects: [TrackMenu Download from… sheet, album page, DownloadControl rows]
tech-stack:
  added: []
  patterns: [worker pool over index slots (same idiom as album resolveAll)]
key-files:
  created: []
  modified:
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/services/download-album.ts
    - src/lib/services/download-album.test.ts
    - src/lib/components/SongRow.svelte
    - src/routes/(app)/album/[name]/+page.svelte
decisions:
  - "The ytmusic download rule lives in downloadTrack (canDownloadFrom). A ytmusic song takes a donor's audio or returns 'no-audio'. It is never resolved or fetched as ytmusic."
  - "downloadAlbum runs POOL=3. onProgress counts completions. Zip entries are assembled in album order after the pool drains."
  - "Album rows get the page's index-aligned resolved Track through SongRow's `resolved` prop, so the existing DownloadControl/DownloadRing pipeline lights each row."
metrics:
  completed: 2026-09-30
  tasks: 3
  files: 7
---

# Quick 260930-uia: downloads never route to YT Music, album downloads run 3-wide with per-row progress

No download path ever routes to YouTube Music now. A ytmusic song downloads a non-ytmusic donor's audio under its own identity, or comes back 'no-audio'; the rule is in `downloadTrack`. The "Download from…" sheet no longer offers YouTube Music rows. Album downloads run 3 songs at a time, keep album order and count completions, and each album row's own download ring shows its song's progress.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 RED | b68d79e2 | test(quick-260930-uia): ytmusic rule in downloadTrack |
| 1 GREEN | 7c884627 | feat(quick-260930-uia): downloads never route to YT Music |
| 2 RED | bdd6e17d | test(quick-260930-uia): 3-wide album pool, album order, completion-counted progress |
| 2 GREEN | 25f7645d | feat(quick-260930-uia): album download runs 3-wide, album order kept |
| 3 | 964b534f | feat(quick-260930-uia): album rows show their own download progress |

## What changed

- **download-track.ts**: new export `canDownloadFrom(source)`. The old body is now the private `downloadOne`, which refuses a ytmusic `audioFrom` before `beginDownload`. The new `downloadTrack` passes non-ytmusic tracks straight to `downloadOne`, so their behaviour is unchanged. For a ytmusic track it runs the donor loop that used to live in the album code: `fetchVariants` → `versionsIncludingOwn` → drop ytmusic rows → `probeDownload` → `downloadOne(track, { audioFrom })`. It returns 'saved' on the first donor that works, 'failed' if any donor attempt failed, and 'no-audio' if there were no donors. The spinner stays on through the lookup, and the function never throws.
- **TrackMenu.svelte**: both `dlPickList` assignments are filtered through `canDownloadFrom`.
- **download-album.ts**: the variants/probe imports, the `YTMUSIC` const and the donor branch are gone, so each song makes one `downloadTrack` call. A pool of 3 workers fills one slot per album position. `seenUids` is claimed synchronously before any await. `onProgress(done, total)` fires after each song settles, whether it was saved, failed or skipped. Zip entries are built from the slots in index order, so the `(2)` suffixing stays in album order.
- **SongRow.svelte**: new `resolved?: Track | null` prop, with `real = resolvedTrack ?? resolved ?? null`. `actUid`, `rowActionTarget` and DownloadControl's `track` now use it.
- **album page**: new `resolvedRows` state holds `resolveAll`'s index-aligned results. It is reset on album change and passed to each row as `resolved={resolvedRows[i] ?? null}`.

## Verification (observed)

- `pnpm test -- download-track.test.ts` after Task 1 GREEN: 62 passed, 1 failed. The failure was the planned import-contract test, which stays RED until Task 2.
- `pnpm test -- download-album.test.ts download-track.test.ts` after Task 2: **83 passed**. The grep for `fetchVariants|probeDownload` in download-album.ts finds nothing, and `POOL` appears 4 times.
- `pnpm test` (full suite): **171 files, 3858 tests passed**.
- `pnpm check`: **0 errors**, 12 warnings. All warnings are unused CSS selectors in `artist/[name]/+page.svelte` that were already there and are unrelated.
- **Dev-server E2E**: run on the existing 5173 server (left running, it was not mine) with headless Chrome over CDP, a fresh profile and a 400x860 mobile viewport. Page: `/album/rice & shine?artist=陳奕迅&mbid=03fac712…`.
  - (a) Toasts were `Preparing download…` → `Downloading 1 of 10…` … `Downloading 10 of 10…` → `Saved 10 of 10`.
  - (b) At most **3** rows were busy at once (`.dc.busy[aria-busy="true"]`). Busy-count histogram over 612 samples at 250 ms: 0→57 (resolve phase), 1→158, 2→15, 3→382. At the end there were 0 busy rows and **10 `.dc.downloaded` ticks**.
  - (c) One file saved: `陳奕迅 - rice & shine.zip`. It has 10 distinct non-empty entries (6.2–8.9 MB each) and no `(2)` names. They are in the same order as the page rows: 娛樂天空, 四季圈, 愚人快樂, 不如承諾來的簡單, 對面, 放棄治療, 時光隧道, 可以了, 陰天快樂, 你給我聽好.
  - (d) **0** requests to `/api/ytmusic/stream` or `googlevideo`. The only `/api/ytmusic` traffic was `/api/ytmusic/search` from the variants lookup (search, not audio) plus Vite module loads.
  - The "Download from…" sheet on row 1 listed 网易云音乐, QQ 音乐 and JOOX, with no YouTube Music row. The ytmusic search for that song does return results, so the filter is what removes the row.
  - Wall clock: **155.0 s** for 10 songs, down from 40-03's sequential ~204 s. About 14 s of that is the up-front resolve, and the 1-busy tail suggests one slow CDN body set the total.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Stale-album guard on `resolvedRows`**
- **Found during:** Task 3
- **Issue:** `resolveAll` can finish after the user has moved to another album. Assigning `resolvedRows` then would give the new album's rows the old album's resolved Tracks, and a row's Download or Like would act on the wrong song.
- **Fix:** `resolveAll` captures `const list = tracks` and assigns `resolvedRows` only when `tracks === list`.
- **Files modified:** src/routes/(app)/album/[name]/+page.svelte
- **Commit:** 964b534f

### Notes

- The album-order (reverse-completion) test in Task 2 passed even before the pool existed, because a sequential loop is trivially in order. The pool-width and completion-progress tests were the ones that went RED. It is kept as a guard against regressions now that completion order differs from album order.

## Deferred Issues

- The "Download" label probes still call `probeDownload` on the row's own track. These are the TrackMenu main row's `dlProbe` and the `probe` opt-in on DownloadControl. For a ytmusic track that means one `/api/ytmusic` resolve plus a HEAD/Range on its audio url, just to fill in the `FORMAT · size` label. No file is downloaded, and the actual download goes through the donor path, but the label can describe the ytmusic file rather than the donor that will be saved. The fix would be to probe the first donor for a ytmusic track. Not in this plan's scope.

## Threat Flags

None. No new endpoints or hosts. Donor urls come from the existing `probeDownload` resolve. T-uia-01 (POOL=3, resolve calls still governed) and T-uia-02 (the service refuses a ytmusic `audioFrom`, and a grep test checks that download-album has no donor loop) are both implemented.

## Self-Check: PASSED

- All 7 modified files exist. The commits b68d79e2, 7c884627, bdd6e17d, 25f7645d and 964b534f are on main and have not been pushed.
