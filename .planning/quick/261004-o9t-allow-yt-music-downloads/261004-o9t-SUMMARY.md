---
phase: quick-261004-o9t
plan: 01
subsystem: downloads
tags: [ytmusic, download, capacitor, capacitorhttp, retry, picker]

requires:
  - phase: quick-260930-uia
    provides: the never-ytmusic download rule this task lifts
  - phase: quick-260915-3ng
    provides: native on-device InnerTube resolver (ytmusic-native.ts) whose direct url is now also downloaded on-device
provides:
  - nativeFetchStreamBlob(url) — never-throw CapacitorHttp GET of a googlevideo url (Range bytes=0-, base64 → audio/mp4 Blob)
  - downloadTrack fetches a ytmusic track's OWN audio (native direct / proxy with 3-attempt retry), files named .m4a
  - ytmusic accepted as an audioFrom donor and walked by donorProbes / downloadFromDonor
  - "Download from…" picker shows the YouTube Music row; Download label = probeDownload(track)
affects: [TrackMenu, DownloadControl, download-album, download-track, ytmusic-native]

tech-stack:
  added: []
  patterns:
    - "URL-keyed (not source-keyed) ytmusic branches in runDownload, so a ytmusic audioFrom donor gets the same native/retry handling"
    - "Client-side whole-request retry for a per-invocation edge egress-IP bot gate (an in-Worker retry cannot change IP)"

key-files:
  created: []
  modified:
    - src/lib/services/ytmusic-native.ts
    - src/lib/services/ytmusic-native.test.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/download-album.ts
    - src/lib/services/download-album.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/DownloadControl.svelte
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts

key-decisions:
  - "quick-261004-o9t: never-ytmusic download rule lifted; ytmusic downloads its own audio. Native googlevideo url → CapacitorHttp blob GET on the phone (no proxy fallback, a dead direct url is 'failed'); /api/ytmusic/stream url → fetch retried up to 3 attempts, no delay; other CDNs unchanged (one fetch)"
  - "quick-261004-o9t: ytmusic downloads are named .m4a (itag 140 AAC/mp4; extFromAudioUrl would default to .mp3)"

requirements-completed: [QUICK-261004-O9T]

duration: ~25min
completed: 2026-10-04
---

# Quick 261004-o9t: Allow YT Music downloads Summary

**A ytmusic song now downloads its own itag-140 AAC as `.m4a`. On the APK the phone fetches its IP-locked googlevideo url over CapacitorHttp (`Range: bytes=0-`). On the web the stream-proxy fetch is retried up to 3 times to get past Cloudflare egress-IP bot gating. The dead never-ytmusic plumbing is deleted.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-10-04
- **Tasks:** 2/2
- **Files modified:** 10

## Accomplishments

- `ytmusic-native.ts`: new `nativeFetchStreamBlob(url)`. It calls `CapacitorHttp.get` with `Range: bytes=0-`, `responseType: 'blob'`, a 15 s connect timeout and a new 90 s `BYTES_TIMEOUT_MS` read timeout. It decodes the base64 body into an `audio/mp4` Blob. It returns null on a non-2xx status, an empty or non-string body, or a bridge rejection, and never throws. Its `ponytail:` line names the ~1.4x in-memory base64 limit and says to move to `@capacitor/file-transfer` if files get large.
- `download-track.ts`:
  - Deleted `canDownloadFrom`, `probeForDownload`, the old `downloadTrack` donor wrapper and the `audioFrom` refusal. `downloadOne` is renamed and exported as `downloadTrack`, and the contract doc moved onto it.
  - New pure helpers `isGooglevideoUrl` and `isYtmusicProxyUrl`, plus `YTMUSIC_FETCH_ATTEMPTS = 3` and `fetchRetrying(url, attempts)`. `fetchRetrying` returns an ok response at once. It returns a non-ok response or rethrows a rejection only on the last attempt, with no delay between attempts.
  - `runDownload` picks the fetch path from the URL. A googlevideo url on native goes through `nativeFetchStreamBlob`. Everything else uses `fetchRetrying`: 3 attempts for ytmusic urls, 1 for any other url. The 40-03 non-ok and empty-body guards are unchanged.
  - The filename extension is `m4a` for both kinds of ytmusic url.
- `donorProbes` drops only `exclude`d sources now, so ytmusic can be a donor.
- `TrackMenu.svelte` and `DownloadControl.svelte` label the Download row with `probeDownload(target, ac.signal)`. The "Download from…" list is the unfiltered `versionsIncludingOwn(...)`, so the YouTube Music row is back. `mapWithConcurrency(…, 2, …)` and its comment are untouched.
- `download-album.ts` and its test: comments and the describe title reworded for the lifted rule. No logic change.

## Task Commits

1. **Task 1: native googlevideo helper, proxy retry, rule lift, test rewrite**: `daa2ef16` (feat)
2. **Task 2: picker row back, label probes the song, album comments**: `6ae7c73f` (feat)

Task 1 was test-first. The new tests failed before the production edits: 13 failed / 93 passed across `download-track.test.ts` + `ytmusic-native.test.ts`. RED and GREEN went into one `feat` commit per task because the orchestrator asked for exactly one commit per task, so there is no separate `test(...)` commit.

## Verification (observed output)

- Task 1 verify: `vitest --run download-track.test.ts ytmusic-native.test.ts download-probe.test.ts` → **Test Files 3 passed (3), Tests 142 passed (142)**. The `canDownloadFrom|probeForDownload` grep on download-track.ts found nothing. The `quick-261004-o9t` count in download-track.ts is **8** (needs at least 3).
- After Task 2: `vitest --run download-album.test.ts download-track.test.ts ytmusic-native.test.ts library.svelte.test.ts` → **Test Files 4 passed (4), Tests 190 passed (190)**.
- `pnpm exec vitest --run src/lib/services` (run twice) → **Test Files 1 failed | 79 passed (80), Tests 1 failed | 2044 passed (2045)**. The one failure is unrelated to this change; see Deferred Issues.
- `pnpm check` → **`COMPLETED 4663 FILES 0 ERRORS 13 WARNINGS 3 FILES_WITH_PROBLEMS`**. All 13 warnings are pre-existing unused-CSS-selector warnings in files this task did not touch.
- `grep -rn "canDownloadFrom\|probeForDownload" src` → empty.
- The `never route(s) to YT Music` grep over download-track.ts, TrackMenu.svelte and download-album.ts → empty.
- **Not verified:** a device or web smoke test. This sandbox cannot reach googlevideo from a phone IP. Whether CapacitorHttp returns the full itag-140 body on a real APK, and the real proxy 502 rate, need the user to check on the APK and openmusic.lol after deploy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Stale ref] Renaming `downloadOne` left 5 comment references pointing at a function that no longer exists**
- **Found during:** Tasks 1 and 2 (`grep -rn downloadOne src`)
- **Fix:** Renamed the references to `downloadTrack`. They are comments only, in `library.svelte.ts` (2 places), `library.svelte.test.ts`, `download-album.ts` and `download-album.test.ts`.
- **Files modified:** `src/lib/stores/library.svelte.ts` (committed in daa2ef16 and 6ae7c73f) and `src/lib/stores/library.svelte.test.ts` (6ae7c73f). Neither file is in the plan's file list. The plan's two album files also got the rename.

**2. [Rule 1 - Test premise] Two `downloadFromDonor` tests no longer matched the code once the ytmusic filter was gone**
- **Found during:** Task 1 GREEN run
- **Issue:** `"no eligible donor → 'no-audio'"` in the x3q describe relied on ytmusic being filtered out. Its variants were `[qq:10, ytT()]`, so with the filter gone ytmusic became a valid donor. Separately, `'no options still takes the first donor in walk order'` used a ytmusic track with no `exclude`. `versionsIncludingOwn` puts the track's own row first, so that ytmusic row is now walked first.
- **Fix:** The first test now uses `[qq:10]` only, the same fix the plan gave for the prefer-tier split. The second is now `'no prefer still takes the first donor in walk order, not the tier match'`, run on a qq track with `exclude: ['qq']`. That is the only shape the album caller actually uses. It keeps the original assertion: netease 320k wins over the later kuwo lossless match.
- **Files modified:** `src/lib/services/download-track.test.ts`
- **Commit:** daa2ef16

**3. [Test strength] The "song not in the library is never marked" test now actually exercises the guard**
- The plan's replacement test would pass with the default `isDownloaded → false` stub even if the guard were missing. I set `isDownloaded` to mirror whether `addDownload` was called, so the test now depends on the `isDownloaded` guard.

## Assumption Drift (advisory)

- **Found during:** Task 1. **Planned:** keep "no options (the ytmusic path) still takes the first donor" by retitling only. **Actual:** the body had to change. With the filter gone a ytmusic track's own row is a candidate, so `downloadFromDonor` without `exclude` tries the track's own source first. **Why it matters:** no production caller is affected, because `download-album.ts` always passes `exclude: [tr.source]`.

## Deferred Issues

- `src/lib/services/device-filename.test.ts` › "rejects a catastrophically-backtracking pattern, and the probe itself stays bounded" fails only in the full parallel `src/lib/services` run. It measured 4632 ms and 2176 ms against an `elapsed < 2000` wall-clock bound. Run on its own it passes: 36/36 on two runs. It imports only `download-filename.ts`, which this task did not change. This is a pre-existing timing flake under CPU contention, so it is out of scope and was not fixed.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-o9t-01: `nativeFetchStreamBlob` is only called when `Capacitor.isNativePlatform() && isGooglevideoUrl(r.audioUrl)`.
- T-o9t-03: the retry is capped at 3 attempts, applies only to ytmusic urls, and runs inside the transfer gate, which is released in `finally`.

## Self-Check: PASSED

- FOUND: src/lib/services/ytmusic-native.ts (exports nativeFetchStreamBlob)
- FOUND: src/lib/services/download-track.ts (exports downloadTrack, downloadFromDonor, donorProbes, donorRank, donorMatchesTier, currentQualityMeets)
- FOUND: commit daa2ef16
- FOUND: commit 6ae7c73f
