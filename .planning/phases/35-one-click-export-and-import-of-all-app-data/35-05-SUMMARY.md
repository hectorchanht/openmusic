---
phase: 35-one-click-export-and-import-of-all-app-data
plan: 05
status: paused-awaiting-human-verification
subsystem: device-verification
tags: [android, capacitor, checkpoint, apk, emulator, logcat, device-only]
requires:
  - "Settings → Data page with Export / Import / Undo / Re-download (plan 04)"
  - "@capacitor/share registered in the Android project (plan 03)"
provides:
  - "Debug APK built + installed on emulator-5554 with the plan-35 backup UI"
  - "Three backup fixtures staged in /sdcard/Download/ and MediaStore-indexed"
  - "Live logcat capture for the two blocking human-verify checkpoints"
affects:
  - "D-15 / D-16 / D-17 remain UNVERIFIED until the human taps"
  - "research open question A4 (does sessionStorage survive location.reload() in the Capacitor WebView) remains UNANSWERED"
tech-stack:
  added: []
  patterns:
    - "device checkpoint: automate to the tap, then stop — no CDP button driving on the human's behalf"
key-files:
  created: []
  modified: []
decisions:
  - "Emulator was already booted (emulator-5554, API 34); plan step 2 (boot a fresh AVD) was skipped rather than starting a second instance"
  - "logcat capture is nohup-detached, not a harness background job — a harness job dies when the agent returns, and the checkpoint requires the capture to outlive the hand-off"
metrics:
  duration: ~10 min (automation only; checkpoints not yet run)
  completed: null
  tasks: 1 of 3
  files-modified: 0
---

# Phase 35 Plan 05: Android Device Checkpoint Summary (PAUSED)

Task 1's automation is complete and the emulator is staged for the two blocking human-verify
checkpoints. **Nothing device-behavioural is verified yet.** D-15, D-16, D-17 and the research A4
question are still open; this SUMMARY exists to record the setup and the exact state the human is
being handed, not to claim a result.

## Task 1 — complete (no commit: zero files changed)

This plan's `files_modified` is `[]` by design — it is a verification plan. Task 1 produced build
artifacts and device state, not source changes, so there is no per-task commit.

### Build — `JAVA_HOME=/opt/homebrew/opt/openjdk@21/… pnpm apk`

```
> Task :app:packageDebug
> Task :app:createDebugApkListingFileRedirect UP-TO-DATE
> Task :app:assembleDebug

BUILD SUCCESSFUL in 1s
306 actionable tasks: 27 executed, 279 up-to-date
```

(`1s` is the gradle leg only — `build:native` and `npx cap sync android` ran ahead of it in the same
`pnpm apk` invocation. The gradle daemon had warm task outputs from an earlier run, so most library
subprojects were UP-TO-DATE; `:app:packageDebug` and `:app:assembleDebug` executed.)

```
$ ls -l android/app/build/outputs/apk/debug/app-debug.apk
-rw-r--r--@ 1 laichan  staff  6130598 Sep 13 19:49 android/app/build/outputs/apk/debug/app-debug.apk
(newer than package.json: YES)
```

### The installed APK really does contain the new code

```
$ grep -rl 'application/json,.json' android/app/src/main/assets/public/_app/
android/app/src/main/assets/public/_app/immutable/nodes/17.CAyvMTdj.js

$ grep -rl "Undo last import" android/app/src/main/assets/public/_app/immutable/
android/app/src/main/assets/public/_app/immutable/chunks/B6Ekrxmm.js
```

Share plugin registration (the plan's `unzip -l | grep capacitorjs/plugins/share` criterion — the
classes are dexed, so the count comes from the dex strings, and `capacitor.plugins.json` carries the
registration itself):

```
$ for d in classes*.dex; do … strings | grep -c "capacitorjs/plugins/share"; done
classes7.dex: 3   classes9.dex: 1   (all others 0)

$ unzip -p app-debug.apk assets/capacitor.plugins.json
…
	{ "pkg": "@capacitor/share", "classpath": "com.capacitorjs.plugins.share.SharePlugin" },
…
```

### Install + fixtures

```
$ adb install -r android/app/build/outputs/apk/debug/app-debug.apk
Performing Streamed Install
Success

$ adb shell ls -l /sdcard/Download/ | grep openmusic-backup
-rw-rw---- 1 u0_a170 media_rw 1210 2026-09-13 19:50 openmusic-backup-2026-09-13.json
-rw-rw---- 1 u0_a170 media_rw   81 2026-09-13 19:50 openmusic-backup-damaged.json
-rw-rw---- 1 u0_a170 media_rw   48 2026-09-13 19:50 openmusic-backup-newer.json

$ adb shell ls /sdcard/Download/ | grep -c openmusic-backup-
3
```

Fixture contents match `<interfaces>`: the good file has two kuwo-shaped liked tracks
(`kuwo:900001` / `kuwo:900002`, both "Fixture Artist"), empty playlists/downloads, `favArtists:
['Fixture Artist']`, empty history, one search-history entry, `{theme:'dark'}` settings and a
`openmusic:name-tr:v2:zh-Hant` record. Each key name was checked against the real constants in
`backup-logic.ts` (`LIBRARY_KEY`, `HISTORY_KEY`, `SEARCH_HISTORY_KEY`, `SETTINGS_KEY`,
`NAME_TR_PREFIX`) so a fixture typo cannot masquerade as an import failure at the checkpoint.

### A3 pre-observation — the picker MIME question is favourable here

`adb push` does not set a MIME type, but MediaStore had already indexed all three and assigned one:

```
$ adb shell "content query --uri content://media/external/file --projection mime_type \
    --where \"_display_name LIKE 'openmusic-backup%'\""
Row: 0 mime_type=application/json
Row: 1 mime_type=application/json
Row: 2 mime_type=application/json
```

So on **this** device (API 34) the `EXTRA_MIME_TYPES=["application/json"]` filter should leave the
fixtures selectable. That is a prediction about the picker, not a verification of it — research A3
warns other API levels can resolve `.json` to a null MIME.

### Session state + logcat

```
$ adb devices                    emulator-5554  device   (API 34, sys.boot_completed=1)
$ adb shell pidof com.openmusic.app   12887
$ curl -s localhost:9222/json    → one target, url https://localhost/  (WebView alive, app loaded)
```

`adb logcat -c` then a **nohup-detached** raw capture plus a filtered tail:

- raw: `<scratchpad>/logcat-35-raw.txt`
- filtered (`ArrayIndexOutOfBounds|FileChooser|fileprovider|SharePlugin|chromium.*Uncaught|openmusic`):
  `<scratchpad>/logcat-35.txt`

Baseline at hand-off: 1060 raw lines, **0** matches for
`ArrayIndexOutOfBounds|FileProvider|SharePlugin`.

### Pre-import baseline for the Undo step

Read out of the WebView's leveldb via `run-as` (observation only):

```
$ adb shell "run-as com.openmusic.app sh -c 'cat app_webview/Default/\"Local Storage\"/leveldb/* | strings'" \
  | grep -o 'openmusic:[a-z0-9:-]*' | sort -u
openmusic:action-log:v1
openmusic:cover-cache:v1
openmusic:history:v1
openmusic:player:v1
openmusic:top-picks:v2
```

No `openmusic:library:v1` — the emulator's library is **empty**, so the counts line should read
`0 liked · 0 playlists · 0 downloads` before the import, `2 liked · 0 playlists · 0 downloads`
after, and back to `0 liked …` after Undo.

## Tasks 2 and 3 — NOT RUN (blocking human-verify)

Both are `gate="blocking"` checkpoints. The tap-by-tap scripts were handed to the orchestrator; no
button was driven from CDP and no checkpoint was self-approved. Until the human reports:

| Requirement | Status |
|---|---|
| D-15 native document picker + import + refusals | **PENDING** |
| D-16 / D-17 share sheet, readable output, dismiss-is-not-an-error | **PENDING** |
| D-09 / research A4 — does `sessionStorage` survive `location.reload()` in the WebView | **UNANSWERED** |
| D-13 reload behaviour, 600 ms toast window | **PENDING** |

If A4 comes back FAIL the documented fallback (swap `sessionStorage` → `localStorage` at the three
call sites in `settings/data/+page.svelte`, plus a `snapshot.length > 2_000_000` pre-check) is a
follow-up quick task, **not** an edit inside this plan, and this checkpoint is not approved.

## Deviations from Plan

**1. [Rule 3 — environment] Emulator boot skipped**

- **Found during:** Task 1 step 2.
- **Issue:** `Pixel_3a_API_34` was already running as `emulator-5554` before this plan started.
- **Fix:** Reused it. Booting a second instance would have split `adb` targets for no gain.

**2. [Rule 3 — harness] logcat capture detached rather than backgrounded**

- **Found during:** Task 1 step 5.
- **Issue:** A harness background job is terminated when the agent returns its final response —
  which is exactly when the human starts tapping. The capture would have been dead for the entire
  checkpoint.
- **Fix:** `nohup`-detached `adb logcat` + a `tail -F | grep --line-buffered` filter, both surviving
  the hand-off. No repo change.

## Assumption Drift (advisory)

- **Planned:** the checkpoint script names a button **"Re-download missing (N)"**. **Actual:** the
  shipped label is **"Re-download missing songs (N)"** (`backup.redownload` in `en.ts`); likewise the
  plan's `<what-built>` wording for the other three controls was checked against the real strings.
  **Why:** plan 04 wired the real dictionary keys; the plan-05 prose was written from the plan-04
  design sketch. The hand-off script uses the real labels so the human is not hunting for a control
  that does not exist by that name. Label-only — no behaviour implication.

## Known Stubs

None — this plan changed no source.

## Concurrency notes

A second Claude session has been executing phases 34/36 in this repository. The working tree was
**clean** (`git status --short` empty) at the start of this run, and this plan stages only
`.planning/phases/35-…/35-05-SUMMARY.md` plus the GSD metadata files. `state.advance-plan` was NOT
called — STATE.md's shared position cursor belongs to the other session. No file outside this
phase's directory was staged, reverted or edited.

## Self-Check: PASSED

- `android/app/build/outputs/apk/debug/app-debug.apk` — FOUND (6130598 bytes, 19:49)
- `/sdcard/Download/openmusic-backup-2026-09-13.json` — FOUND on device
- `/sdcard/Download/openmusic-backup-damaged.json` — FOUND on device
- `/sdcard/Download/openmusic-backup-newer.json` — FOUND on device
- `<scratchpad>/logcat-35.txt` — FOUND, capture live
- `com.openmusic.app` — RUNNING (pid 12887)
- No per-task commit expected or claimed (`files_modified: []`)
