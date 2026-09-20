---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 09
subsystem: infra
tags: [android-app-links, capacitor, deep-link, verification, emulator, adb]

# Dependency graph
requires:
  - phase: 38-05
    provides: the web arrival surface the deep link lands on
  - phase: 38-07
    provides: getLaunchUrl (cold) + appUrlOpen (warm) native seams
  - phase: 38-08
    provides: static/.well-known/assetlinks.json with both fingerprints
provides:
  - "Emulator-verified Android App Links association for openmusic.lol (debug key)"
  - "Cold / warm / negative deep-link evidence recorded in 38-VALIDATION.md"
affects: [any future native deep-link surface, the release-channel APK]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App Links verification loop: pm set-app-links 0 all -> pm verify-app-links --re-verify -> poll pm get-app-links for the literal `verified`"
    - "WebView route assertion over CDP: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid> -> /json/list"

key-files:
  created:
    - .planning/phases/38-share-links-that-play-instantly-and-open-in-the-app/38-09-SUMMARY.md
  modified:
    - .planning/phases/38-share-links-that-play-instantly-and-open-in-the-app/38-VALIDATION.md

key-decisions:
  - "Cold and warm were asserted by DIFFERENT observable signals, not just focus: cold by pidof-exit-1 before the intent, warm by an UNCHANGED PID plus the `task brought to the front` notice — focus alone cannot tell the two code paths apart"
  - "The negative test asserts resolution, not just outcome: `pm query-activities` shows OpenMusic is not even a candidate for /search, which is stronger than observing that a browser happened to win"
  - "nyquist_compliant left FALSE — the release fingerprint and felt latency are device-only and remain unverified"

patterns-established:
  - "Deep-link route assertion on Android: read the live WebView location over CDP rather than inferring from logcat"

requirements-completed: []

# Metrics
duration: 22min
completed: 2026-09-20
---

# Phase 38 Plan 09: On-device verification Summary

**Android App Links for `openmusic.lol` verified by the OS on the `Pixel_3a_API_34` emulator with the debug-signed APK — cold (`getLaunchUrl`), warm (`appUrlOpen`) and the negative unclaimed-path case all behave as specified; the release-signed APK and the felt first-tap latency remain unverified because both are device-only.**

## Status: PARTIAL — Task 2 complete, Task 3 awaiting a real device

| Task | Type | Status |
|---|---|---|
| 1 — human push/deploy gate | checkpoint:human-action | done before this run (approved; `8022177..4264a5b` pushed, Pages live) |
| 2 — emulator verification | auto | **complete, all assertions passed** |
| 3 — real-device latency + release APK | checkpoint:human-verify | **STOPPED — blocking, needs a physical phone** |

## Verification Performed

Every command was actually run; the output below is verbatim.

### 1. Live `assetlinks.json`

```
$ curl -si https://openmusic.lol/.well-known/assetlinks.json | sed -n 1,15p
HTTP/2 200
date: Sun, 20 Sep 2026 20:24:11 GMT
content-type: application/json
content-length: 432
x-content-type-options: nosniff
...
cache-control: public, max-age=0, must-revalidate
etag: "636b11229d4d46600a581eba5fab3859"
```

No `location:` header. Body diff against the repo file:

```
$ diff <(curl -s https://openmusic.lol/.well-known/assetlinks.json) static/.well-known/assetlinks.json
IDENTICAL (exit 0)
```

### 2. Build + install

```
$ export JAVA_HOME=/opt/homebrew/opt/openjdk@21 && pnpm apk
BUILD SUCCESSFUL in 9s
306 actionable tasks: 29 executed, 277 up-to-date

$ ls -la android/app/build/outputs/apk/debug/app-debug.apk
-rw-r--r--@ 1 laichan staff 6132628 Sep 20 14:25 app-debug.apk

$ adb install -r android/app/build/outputs/apk/debug/app-debug.apk
Performing Streamed Install
Success
```

Emulator network reachability was checked before trusting the verifier (Pitfall: a verifier with no
network never reaches `verified` and looks like a fingerprint failure):

```
$ adb shell ping -c 2 openmusic.lol
64 bytes from 172.67.150.98: icmp_seq=1 ttl=255 time=135 ms
2 packets transmitted, 2 received, 0% packet loss
```

### 3. App Links verification — the real gate (T-38-05)

Immediately after `pm set-app-links --package com.openmusic.app 0 all` +
`pm verify-app-links --re-verify com.openmusic.app`, the state was `none`:

```
  com.openmusic.app:
    ID: 84320164-6218-400f-934a-37ee2c0f434a
    Signatures: [37:30:88:C4:7F:83:64:6F:83:D8:B3:C7:E1:58:FB:37:F5:8D:17:7C:1B:27:00:3F:BF:1A:5E:AD:87:EB:8D:A2]
    Domain verification state:
      openmusic.lol: none
```

Polling at 10s intervals, it flipped on the first poll (`t=10s`). Final state, verbatim:

```
$ adb shell pm get-app-links com.openmusic.app
  com.openmusic.app:
    ID: 84320164-6218-400f-934a-37ee2c0f434a
    Signatures: [37:30:88:C4:7F:83:64:6F:83:D8:B3:C7:E1:58:FB:37:F5:8D:17:7C:1B:27:00:3F:BF:1A:5E:AD:87:EB:8D:A2]
    Domain verification state:
      openmusic.lol: verified
```

`Signatures:` is byte-identical to the FIRST fingerprint in `static/.well-known/assetlinks.json`
(the debug key) — Pitfall 5 cleared. The second (release) fingerprint is untested here by
construction; that is exactly what Task 3 exists to cover.

No re-verify retries or timeouts were needed — verification landed within 10 seconds, well inside the
3-minute budget, so the Android-version verification-latency caveat never came into play on API 34.

### 4. COLD path — `App.getLaunchUrl()` (plan 07 Task 1)

Force-stopped first, and confirmed genuinely not running before the intent (otherwise this is just a
second warm test):

```
$ adb shell am force-stop com.openmusic.app
$ adb shell pidof com.openmusic.app ; echo "pidof exit=$?"
pidof exit=1

$ adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
    -d "https://openmusic.lol/song/Adele/Hello?u=kuwo7758916"
Starting: Intent { act=android.intent.action.VIEW cat=[android.intent.category.BROWSABLE] dat=https://openmusic.lol/... }

$ adb shell dumpsys window | grep -i mCurrentFocus
  mCurrentFocus=Window{324949c u0 com.openmusic.app/com.openmusic.app.MainActivity}
$ adb shell dumpsys activity activities | grep topResumedActivity
    topResumedActivity=ActivityRecord{73a51f6 u0 com.openmusic.app/.MainActivity t36}
```

WebView route read over CDP (`adb forward tcp:9222 localabstract:webview_devtools_remote_6071`):

```
$ curl -s http://localhost:9222/json/list | grep '"url"'
   "url": "https://localhost/song/Adele/Hello?u=kuwo7758916",
```

**PASS** — the shared `/song/…` route, not `/`. This is the regression the task exists to catch: a
listener-only implementation would have landed on the home screen here.

Note on timing: `mCurrentFocus` read `null` at +8s and only resolved to `MainActivity` at +18s — the
splash/WebView boot window. A cold assertion made too early reads as a false failure.

### 5. WARM path — `appUrlOpen` (plan 07 Task 2)

```
$ adb shell pidof com.openmusic.app        # before
6071
$ adb shell input keyevent KEYCODE_HOME
$ adb shell dumpsys window | grep -i mCurrentFocus
  mCurrentFocus=Window{fd4bb80 u0 com.google.android.apps.nexuslauncher/...NexusLauncherActivity}

$ adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
    -d "https://openmusic.lol/song/Coldplay/Yellow?u=kuwo6979350"
Starting: Intent { ... }
Warning: Activity not started, its current task has been brought to the front

$ adb shell pidof com.openmusic.app        # after
6071
$ adb shell dumpsys window | grep -i mCurrentFocus
  mCurrentFocus=Window{324949c u0 com.openmusic.app/com.openmusic.app.MainActivity}
$ curl -s http://localhost:9222/json/list | grep '"url"'
   "url": "https://localhost/song/Coldplay/Yellow?u=kuwo6979350",
```

**PASS** — and distinguishably warm, not a relaunch: the PID is unchanged (`6071` → `6071`) and the
OS reported `its current task has been brought to the front`. The route changed to the SECOND song,
proving the listener routed through `goto` rather than the process restarting into `getLaunchUrl`.

### 6. NEGATIVE — unclaimed path must not open the app (T-38-02, D-24)

Asserted at the resolver level, which is stronger than watching who happens to win:

```
$ adb shell pm query-activities -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
    -d "https://openmusic.lol/search"
      name=com.google.android.apps.chrome.IntentDispatcher
      packageName=com.android.chrome
```

OpenMusic is **not a candidate at all**. Behaviourally:

```
$ adb shell am start ... -d "https://openmusic.lol/search"
$ adb shell dumpsys window | grep -i mCurrentFocus
  mCurrentFocus=Window{f0ca4de u0 com.android.chrome/...FirstRunActivity}
$ adb shell pidof com.openmusic.app ; echo "pidof exit=$?"
pidof exit=1
```

**PASS** — Chrome took it and OpenMusic never started.

Positive control, for contrast — a claimed path does list the app first:

```
$ adb shell pm query-activities ... -d "https://openmusic.lol/song/Adele/Hello"
      name=com.openmusic.app.MainActivity
      packageName=com.openmusic.app
      name=com.google.android.apps.chrome.IntentDispatcher
      packageName=com.android.chrome
```

## What was NOT verified — stated plainly

- **The RELEASE fingerprint is untested.** The emulator ran the debug-signed APK, and the OS reported
  only the debug `Signatures:` value. The second fingerprint in `assetlinks.json` is unexercised.
  Only the release-signed `latest` prerelease on a real phone can confirm it.
- **Felt first-tap latency is untested.** It is perceptual and cannot be measured on an emulator.
- **In-app playback of a shared link was not exercised.** The kuwo upstream returned
  `error code: 526` (Cloudflare origin-SSL failure) for the entire run — both
  `https://openmusic.lol/api/kuwo/search?name=…` and the upstream `kw-api.cenguigui.cn` directly.
  So a `?u=kuwo…` carrier could not resolve to audio. The Task 2 acceptance criteria are about
  ROUTING (focus + WebView path) and routing passed; the resolve-and-play leg of the shared arrival
  is simply untested here, not passing. This is an upstream outage, unrelated to this phase.
- **`nyquist_compliant` is still `false`** in `38-VALIDATION.md`, and correctly so.

## Task Commits

1. **Task 2: emulator verification evidence** — `09e5177` (docs)

## Files Created/Modified

- `.planning/phases/38-share-links-that-play-instantly-and-open-in-the-app/38-VALIDATION.md` — three
  manual rows flipped to ✅ with observed evidence; a WARM row and a NEGATIVE row added (both ✅); a
  new pending row for the release-signed APK + felt latency; an emulator-evidence table; and the JDK
  path trap recorded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `$(/usr/libexec/java_home -v 21)` resolves to JDK 20 on this machine**
- **Found during:** Task 2, step 2
- **Issue:** The plan's literal command `export JAVA_HOME=$(/usr/libexec/java_home -v 21)` set
  `JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-20.jdk/Contents/Home`. `java_home` only indexes
  `/Library/Java/JavaVirtualMachines`, and the Homebrew `openjdk@21` is not symlinked there, so the
  `-v 21` request silently fell back to the newest available (20). Gradle failed:
  `Execution failed for task ':capacitor-android:compileDebugJavaWithJavac' > invalid source release: 21`.
- **Fix:** Used the literal Homebrew path `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`
  (`openjdk version "21.0.11"`). Build then succeeded in 9s.
- **Files modified:** none (environment only); the trap is now recorded in `38-VALIDATION.md` so the
  next run does not lose 10 minutes to it.
- **Commit:** `09e5177` (the documentation of it)

### Method deviations (no permission needed, recorded for honesty)

- The plan offered `adb logcat -d | grep -i "openmusic\|Capacitor"` as an alternative to CDP for the
  route assertion. CDP was used instead — it reads the live `location.href` rather than inferring
  from log lines, which is the difference between observing the route and guessing it.
- The negative test was strengthened with `pm query-activities` before the behavioural `am start`.
  The plan only required the behavioural check; the resolver query proves the intent-filter scope
  directly instead of relying on which app happened to win.

## Assumption Drift (advisory)

**1. Verification latency was budgeted at up to 3 minutes; it took ~10 seconds**
- **Found during:** Task 2, step 3
- **Planned:** RESEARCH §2d and assumption A3 expected "~30-60s" and the plan polled for up to 3
  minutes, treating slow verification as the likely friction point.
- **Actual:** `openmusic.lol: verified` appeared on the FIRST 10-second poll.
- **Why it matters:** the anticipated risk (slow/failed verification needing `--re-verify` retries)
  never materialised, so no retry or override path was exercised. A reader should not conclude that
  the retry tooling was validated — it was not needed.

**2. The plan's `?u=kuwo<id>` URLs implied an in-app resolve would be observable**
- **Found during:** Task 2, steps 4-5
- **Planned:** the plan notes "the APK WebView resolves `/api/*` to `https://openmusic.lol`, so the
  in-app resolve itself runs against prod", implying the carrier would resolve.
- **Actual:** kuwo returned `526` throughout, so no carrier resolved. The WebView title showed the
  previously restored track, not the shared song.
- **Why it matters:** the cold/warm PASSes are routing-only. They do not evidence that the arrival
  surface resolves and arms a shared song on Android — that is Task 3's step 3.

## Threat Register Outcomes

| Threat ID | Disposition | Outcome |
|---|---|---|
| T-38-05 | mitigate (verify) | **Met on the debug key.** The literal `verified` string was the gate, not `am start`; `Signatures:` diffed against the JSON and matched. The RELEASE key is still unverified (Task 3). |
| T-38-02 | mitigate (verify) | **Met.** `/search` does not resolve to the app at all; `/song/…` does. |
| T-38-10 | mitigate | **Met.** Every command's output is recorded verbatim above and in `38-VALIDATION.md`. |
| T-38-SC | accept | No package installs this plan. |

## HAND-OFF TO THE HUMAN — Task 3 (blocking)

The emulator has taken this as far as it goes. What is left needs a physical Android phone with the
**release-signed** `latest` prerelease, installed or updated **after** the Task 1 deploy (Android ≤14
verifies at install/update time — an older install will still hold the pre-deploy 404 failure and
must be reinstalled).

1. `adb shell pm get-app-links com.openmusic.app` → expect `openmusic.lol: verified` and a
   `Signatures:` equal to the RELEASE fingerprint `1B:70:46:64:4B:…:08:5A:05:82:34`.
2. Share any song from the track menu to yourself; confirm the URL carries `?u=` (or `&u=`).
3. Force-stop the app, tap the link → must open OpenMusic (not the browser) on the song page, song
   in the nowbar, **no audio yet**. Tap "Play on openmusic" → sound should start near-instantly.
4. While that plays, tap a link to a DIFFERENT song → switches and plays at once, shows the
   "Playing shared song · your queue is kept" toast, Up Next rows survive.
5. Tap the same link again → nothing changes, no restart.
6. Tap `https://openmusic.lol/search` → opens in the browser.

Reply `approved` with device model + Android version, or one of:
`NOT-VERIFIED` · `BROWSER-OPENED` · `AUTOPLAYED` · `SLOW` · `QUEUE-LOST` · `RESTARTED` · `RELEASE-PENDING`.

On `approved`, the resumed executor sets `nyquist_compliant: true` and `status: approved` in
`38-VALIDATION.md` and records the device model. No source or config change is permitted inside
Task 3 under any outcome.

## Self-Check: PASSED

- `38-09-SUMMARY.md` — FOUND
- `38-VALIDATION.md` — FOUND
- `android/app/build/outputs/apk/debug/app-debug.apk` — FOUND
- commit `09e5177` — FOUND
- `nyquist_compliant: false` still set (correct — Task 3 outstanding)
