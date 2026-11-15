---
status: resolved
trigger: "APK: a Samsung Modes & Routines 'play music' / 'play last song' does nothing until the app is opened by hand; OpenMusic is not offered as the routine's music app. Make it work like YouTube Music."
created: 2026-11-15
updated: 2026-11-15
---

## Symptoms
- expected: routine / headset play key with the app closed starts the last song; OpenMusic is pickable as the routine's music app
- actual: nothing happens until the app is opened, then the song plays; app missing from the picker
- reproduction: kill the app (swipe away), trigger the routine or a media PLAY key

## Resolution
root_cause: |
  The audio engine is the WebView <audio>, which exists only while MainActivity is alive, and the APK
  declared no MediaBrowserService — the component Android / Samsung routines use to list a music app
  and to wake it. With the process dead, the media key went to androidx MediaButtonReceiver, which
  started the @jofr plugin's MediaSessionService with no session (the JS side never bound it), so
  the key was dropped.
fix: |
  ColdMediaLaunch.kt: an exported OpenMusicBrowserService (listed as a music app, cold-connectable)
  plus OpenMusicMediaButtonReceiver replacing androidx's receiver. Warm (activity alive + plugin
  service running) keeps the old plugin path; cold starts MainActivity on openmusic://play/resume.
  +layout.svelte awaits restore(), resumes the last track, and on a cold launch minimizes the app
  once `playing` fires. SYSTEM_ALERT_WINDOW declared as the background-start fallback.
verification: |
  API 34 emulator: played a track, HOME, `am stop-app` (process dead, not stopped state),
  `cmd media_session dispatch play` → ActivityTaskManager START ... (BAL_ALLOW_PERMISSION),
  audio paused=false at the saved position, launcher back on top. Warm pause/play keys while
  backgrounded toggle audio without surfacing the app. pnpm check 0 errors; vitest failures
  identical to baseline (5 pre-existing). NOT verified: a real Samsung routine connecting through
  the MediaBrowserService (no adb hook for that) — needs a device test.
files_changed:
  - android/app/src/main/java/com/openmusic/app/ColdMediaLaunch.kt
  - android/app/src/main/AndroidManifest.xml
  - android/app/src/main/java/com/openmusic/app/MainActivity.java
  - android/app/build.gradle
  - src/lib/services/native-resume.ts (+ test)
  - src/routes/+layout.svelte
