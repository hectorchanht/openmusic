---
status: partial
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick
source: [40-VERIFICATION.md]
started: 2026-10-01T03:39:12Z
updated: 2026-10-01T03:39:12Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Offline playback of a downloaded album song
expected: Library → Downloads → tap an album song with the network offline; it plays from the offline copy.
result: [pending]

### 2. YT Music fallback album download on Android
expected: On the emulator/device, album download of an album with ytmusic-resolved songs saves every song into Music/OpenMusic/<Artist>/<Album>/ (donor audio), toast "Saved N of N".
result: [pending]

### 3. Crowd cover inside the APK against production (after deploy)
expected: Two voters pick the same cover for a song; a third device (APK) playing it shows that cover; cached repeat lookups still load (CORS on __edge cache hits).
result: [pending]

### 4. "Cover updated" toast + OS lock-screen artwork after crowd adopt
expected: Picker tap shows the toast; when a crowd cover is adopted for the playing song, NowPlaying hero, Nowbar and lock-screen card all switch.
result: [pending]

### 5. Legacy Android (API ≤28) album move (WR-05)
expected: An already-downloaded single moves into the album folder; no overwrite of an existing file; nothing outside Music/OpenMusic is touched.
result: [pending]

### 6. Real 2-voter flow after the quorum change
expected: One vote stays private (only the voter sees it via their pin); a second distinct voter agreeing publishes it to everyone.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
