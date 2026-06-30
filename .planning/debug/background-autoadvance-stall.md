---
gsd_debug_version: 1.0
slug: background-autoadvance-stall
status: fix-applied-pending-device-verify
trigger: "After a song finishes while the screen is locked / playing in background, the NEXT song is presented at 0:00 with no end time (no duration) and does not auto-play. Opening the app makes it start playing by itself. The track is resolvable (it plays once foregrounded)."
created: 2026-06-30
updated: 2026-06-30
---

# Debug: background auto-advance leaves the next track stalled at 0:00 until foreground

## Symptoms

- **Expected:** When a track ends while the screen is locked / app backgrounded, the next track keeps
  playing uninterrupted (non-stop).
- **Actual:** The next track becomes current but shows **0:00 with no end time (no duration)** and does
  NOT auto-play while backgrounded. Re-opening the app makes it start "by itself."
- **Platform:** Android Chrome (browser / installed PWA), screen locked or app backgrounded.

## Root cause (confirmed by code trace)

`ended` → `next()` → `play(nextTrack)` in `src/lib/stores/player.svelte.ts`:
1. `play()` does `await ensureTrackDetails(track)` (async network resolve) BEFORE `audio.src = …` +
   `audio.play()`. The synchronous track-end context is gone by the time it resolves.
2. In a HIDDEN tab, Android Chrome rejects that `play()` (no user activation) and does not load bytes —
   so `loadedmetadata` never fires (**0:00, no duration**) and `hasPlayedSinceSrc` stays false.
3. The existing initial-load autoplay-retry (`autoplayRetryArmed` → `maybeRetryAutoplay`) only re-plays
   once bytes are present and is driven off the `canplay` event — which does NOT fire while hidden. The
   stall watchdog (`armStall`) is a `setTimeout`, throttled in the background. The external-pause
   self-heal is gated on `hasPlayedSinceSrc` (true), so it does not apply to this never-started case.
4. → nothing resumes it until the tab becomes visible, when `canplay` finally fires and the armed retry
   (or the deferred play) starts it — i.e. it "plays by itself when you open the app." Matches the report.

Background autoplay of a freshly-loaded `src` in a hidden Android tab is largely a platform constraint;
the deterministic, in-our-control recovery is the FOREGROUND transition.

## Fix applied

`src/lib/stores/player.svelte.ts` — foreground/visibility resume self-heal:
- `resumeOnForeground` flag captured at `visibilitychange`→hidden (`this.playing || element-not-paused`)
  so foreground knows playback was active when backgrounded.
- `resumeIfStalled()` called on `visibilitychange`→visible: re-issues `audio.play()` on the current
  track ONLY when `resumeOnForeground` is set, the user did not deliberately pause (`deliberatePause`),
  and the element is paused mid-track with a src (not ended). One-shot per hide→show cycle. Covers both
  the stalled initial-load AND a mid-track external pause whose budget was spent. Never auto-starts a
  freshly-restored paused session (flag is false on a cold load).
- Logs `visibility.resume` (uid, hasPlayed, currentTime) to the new action log so the on-device
  sequence is observable.

This makes the foreground recovery deterministic + immediate (no more sitting stalled after reopening).
True background advance (playing while still locked) is NOT solved here — that needs MediaSession
continuity work, which requires real-device evidence (now capturable via the Activity log).

## Verification

- 5 new regression tests in `player.svelte.test.ts` ("foreground resume of a background-stalled
  auto-advance"): resumes when active-at-hide; not on deliberate pause; not on a freshly-restored paused
  session; not on an ended element; one-shot.
- Player suite 159/159, full suite 992/992 (67 files), svelte-check 0/0.
- Device verify pending: lock screen, let it auto-advance, unlock → confirm it resumes immediately; and
  check Settings → Activity log for the `visibility`/`visibility.resume`/`audio.error`/`play` sequence
  to see whether the background `play()` was rejected (informs the MediaSession follow-up).

## Notes

- Use the new Activity log (Settings → Activity log, quick-260630-sgw) on-device to capture the exact
  ordering — that is the evidence for any background-continuity (MediaSession) follow-up.
