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

## Update 2 — stale hasPlayedSinceSrc misroutes a dead new track (from the on-device log)

A second action-log export (backgrounded + screen-locked) showed the deeper cause. While hidden, a
track ended → `advance` → `play(netease:2003248545, fresh:false)` → `resolve.ok` (2.5s later) →
`audio.error {hasPlayed:TRUE}` on a track that NEVER produced a `playing`. The `hasPlayed:true` was
wrong and it misrouted the dead track into the already-played recovery (`reresolveCurrent` +
`ext-resume.schedule`/`ext-resume.play`) — which spun in place instead of advancing. It sat dead for
236s until `visibility.resume` (still `ct:0`).

Root cause: `play()` set `this.current = track` at entry (line ~2176) but reset `hasPlayedSinceSrc =
false` only at src-set (line ~2363), AFTER the async `ensureTrackDetails` resolve. During that
multi-second gap `current` was the NEW track while the flag still held the OLD (played) track's `true`.
A dead new track (netease 403) erroring in that window hit the `hasPlayedSinceSrc` branch →
`reresolveCurrent` (re-resolve the SAME dead source) + the external-pause self-heal, instead of the
cross-source fallback that would try qq/kuwo/joox and advance PAST it.

Fix: reset `hasPlayedSinceSrc = false` at `play()` ENTRY (right after `this.current = track`). Now a
resolve-gap error on the new track is correctly treated as never-played → cross-source fallback →
advance to a playable track. `reresolveCurrent` is a mid-track re-attach that does NOT go through
`play()`, so it keeps its own `true` (legit mid-track recovery unaffected). Regression tests: entry
resets the flag synchronously before the resolve settles; a never-played error routes to `runFallback`,
not `reresolveCurrent`. Player 163/163, full suite 1001/1001, svelte-check 0/0.

Remaining platform limit (honest): starting a BRAND-NEW `src` in a hidden/locked Android tab is still
constrained by the OS. This fix ensures the player correctly SKIPS dead tracks (via fallback/advance)
rather than pinning on one, so by foreground-resume the current track is a playable one that then
resumes — but truly gapless background advance across track changes would need MediaSession-continuity
work (separate, needs device evidence).
