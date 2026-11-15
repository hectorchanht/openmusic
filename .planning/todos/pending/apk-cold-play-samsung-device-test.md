---
title: Device-test APK cold play from a Samsung routine (MediaBrowserService path)
date: 2026-11-15
priority: medium
---

# Device-test the APK cold-play fix on a real Samsung phone

Fix `e2aa2388` (on `dev`, not pushed) — see `.planning/debug/resolved/apk-cold-media-play.md`.

Verified on the API 34 emulator ONLY for the media-key path (`cmd media_session dispatch play`
with the process dead → app starts, resumes the last track, minimizes). NOT verified:

1. **Samsung Modes & Routines "Play music"** — does OpenMusic now appear in the app picker, and
   does the routine's command (through `OpenMusicBrowserService`, not a media key) start playback
   with the app closed? adb has no hook to drive a MediaBrowser connection, so this needs the
   user's device: `pnpm apk`, install, pick OpenMusic in the routine, swipe the app away, run it.
2. **Background activity start on the device** — the emulator allowed it (`BAL_ALLOW_PERMISSION`
   from the media-key allowance). A routine's browser connection may not carry that allowance. If
   nothing opens, grant Settings → Apps → OpenMusic → "Display over other apps"
   (`SYSTEM_ALERT_WINDOW` is declared) and retry. If that is still needed, consider an in-app
   prompt/button for the permission (UI change → impeccable first).

## Upgrade path (only if the above proves unreliable)

A native ExoPlayer engine in the service (YouTube Music's model) would play without starting the
Activity at all, but needs native resolve/queue/fallback — phase-sized. User chose the lighter
"MediaBrowserService + wake UI" approach on 2026-11-15.
