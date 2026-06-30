---
gsd_debug_version: 1.0
slug: autoadvance-pauses-after-1s
status: awaiting_human_verify
trigger: "Playable songs stop at the very beginning and the player freezes/stalls instead of continuing. A song ends, the next (playable) track becomes current, ~1s of audio plays, then it STOPS at the start and never advances. Resumable by tapping play; switching back to the foreground app sometimes resumes it. Happens on Android Chrome, frequently during screen lock or while backgrounded. Player should NEVER stop on external interruption — it must self-heal (re-issue play / auto-advance) and keep music playing non-stop. Future-song cache + prefetch already exist to guarantee non-stop playback; they are not preventing this stall."
created: 2026-06-30
updated: 2026-06-30
---

# Debug: auto-advanced playable track pauses ~1s after start, no self-heal

## Symptoms

- **Expected:** When the queue auto-advances to a playable next track, it starts and keeps playing uninterrupted — non-stop "endless flow" — even while the screen is locked or the app is backgrounded. Any external pause (audio focus loss, background throttle) must self-heal: re-issue `play()` and resume; never sit frozen.
- **Actual:** Song A ends → next track (Song B, genuinely playable) becomes the current track → roughly **1 second of audio plays, then playback stops at the very beginning (frozen ~0:00–0:01, no advance)**. The track is NOT marked unplayable — tapping the play button resumes it, and returning to the foreground app sometimes resumes it on its own. So the track is provably playable; something pauses it right after start and nothing re-starts it.
- **Errors:** None surfaced to the user.
- **Platform:** Android Chrome (browser and/or installed PWA).
- **Stuck state:** Frozen at the start (~0:00), no auto-advance, resumable by manual play.
- **Timeline:** Always been flaky (not pinned to one change). Survives across the three earlier resolved playback fixes — likely a distinct root cause from those.
- **Reproduction:** Let the queue auto-advance on track end, especially with the screen locked or the app in the background. Intermittently the new current track plays ~1s and then pauses. Switching back to the app often resumes it.

## Distinction from prior RESOLVED sessions (do not re-tread)

- `playback-skip-and-autoplay` (resolved): over-aggressive skip / false-unplayable + next-song-no-autoplay. THIS bug is different — the track DOES start (audio is heard) then pauses; it is not skipped or marked dead, and it is not a "never started" case.
- `next-end-swipe-prefetch-queue` (resolved): track end stopped instead of advancing; fixed via awaitable `growPromise`, `primeNext()`, asset warming. THIS bug advances (new track becomes current and starts) but then stalls ~1s in.
- `search-next-up-wrong-mode` (resolved): wrong queue contents. Not relevant to a stall.

The new signature — **plays ~1s then pauses, on Android, worse when locked/backgrounded, self-resumes on foreground** — points at an external pause (Android audio-focus / background media throttle / a transient `pause`/`stalled`/`waiting`/`suspend` audio event during the src swap) that the player's recovery path does not re-issue `play()` for.

## Investigation scope (orchestrator hints)

- **Core file:** `src/lib/stores/player.svelte.ts` — the auto-advance + auto-play seam (`ended` → `next()`), `prefetchNext()` / `primeNext()` / `ensureAhead()`, `recoverFromStop()`, `nextPlayableIndex()`, and especially the `<audio>` event handlers: `pause`, `stalled`, `waiting`, `suspend`, `ended`, `playing`, `timeupdate`. Look for: does anything listen for an UNEXPECTED `pause` mid-playback and re-issue `play()`? Is the `play()` promise after a src swap awaited / its rejection handled? Is there a guard that mistakes the rapid src swap for an intentional pause?
- **MediaSession / background audio:** search for `mediaSession`, `setActionHandler`, `playbackState`, `navigator.wakeLock`, `visibilitychange`, `Audio(` construction, `preload`, the muted warm-up `Audio` element from the prefetch warming fix (could a muted warm Audio be stealing audio focus / colliding with the real element on Android?).
- **Service worker / PWA:** `src/service-worker.*` or similar — background media, focus, and any throttling on Android PWA.
- **Components:** `src/lib/components/NowPlaying.svelte` and the now-bar — autoplay gating on `playing`/`pause` events (memory `player-displayed-defer-broke-mobile`: do NOT gate UI swap on `playing` event — unreliable on mobile; check no similar gate pauses playback).
- **Tests:** `src/lib/stores/player.svelte.test.ts` — the playback contract; add a regression for "external pause shortly after auto-advance → player re-issues play / does not freeze".

## Key hypotheses to test first

1. On track-end auto-advance, the new `src` is set and `play()` called, but Android Chrome (locked/backgrounded) suspends the element ~1s later (audio-focus transition / power throttle), firing `pause`/`stalled`. The player has no "unexpected pause → resume" self-heal, so it stays frozen. Foreground return re-grants focus and the user/visibility handler resumes it.
2. The prefetch warm-up muted `Audio` element collides with / steals audio focus from the real playback element on Android during the transition.
3. The `play()` promise after the src swap rejects (`AbortError`/`NotAllowedError` from rapid `load()`+`play()` or from no user-gesture while backgrounded) and the rejection is swallowed without retry.
4. MediaSession `playbackState` / position not kept in sync across the transition, so Android pauses the session.

## Current Focus

- hypothesis: CONFIRMED. The track produces audio (sets `hasPlayedSinceSrc = true` via `playing`/`timeupdate`), then an EXTERNAL `pause` fires (Android audio-focus loss / background throttle / transient pause right after the auto-advance src swap). The `pause` listener (line 1135) sets `playing = false`, disarms the stall watchdog, and CLEARS `autoplayRetryArmed` — then does NOTHING to resume. ALL existing self-heal (`autoplayRetryArmed` / `maybeRetryAutoplay` / `armStall`) targets only the INITIAL-LOAD autoplay-policy pause (before `hasPlayedSinceSrc`); there is no recovery for a pause AFTER playback started. So a provably-playable track sits frozen at ~0:01 until a manual tap or foreground return re-issues play.
- next_action: DONE — fix applied + verified at unit/type level. Awaiting human verification on a real Android Chrome device (lock screen / backgrounded auto-advance) that a playable track no longer freezes ~1s after start.
- reasoning_checkpoint:
    hypothesis: "A playable auto-advanced track is paused ~1s after start by an external Android event (audio-focus loss / background throttle) that fires a `pause` event on the live <audio>; player.svelte.ts has no self-heal for an UNEXPECTED pause after playback already started, so it freezes."
    confirming_evidence:
      - "pause listener (player.svelte.ts:1135-1148) only sets playing=false, disarmStall(), and clears autoplayRetryArmed — it never re-issues play() and comment explicitly says 'NEVER re-play() from inside the pause listener'."
      - "All self-heal arms (autoplayRetryArmed/maybeRetryAutoplay/armStall) are gated on the INITIAL-LOAD window: maybeRetryAutoplay is one-shot, set only on a rejected play() during the src swap, and armStall returns early once hasPlayedSinceSrc is true (line 906). After audio starts (the ~1s case), none of them can fire."
      - "playing listener (line 1104) sets hasPlayedSinceSrc=true and clears autoplayRetryArmed=false — so by the time the external pause arrives ~1s in, every retry hook is disarmed."
      - "The error path explicitly treats a post-playback (hasPlayedSinceSrc) interruption as recoverable (reresolveCurrent, line 1274) — but an external PAUSE does not raise an `error` event, so that recovery never engages for this signature."
    falsification_test: "If a `pause` event fires on a track with hasPlayedSinceSrc=true, time remaining, and no user/MediaSession/sleep-timer intent, and the player does NOT re-issue play(), the track stays frozen — exactly the reported symptom. A test simulating that pause must show the element re-played for the fix to hold; if re-playing on every pause breaks a genuine user pause test, the hypothesis/fix is wrong."
    fix_rationale: "Adding an intent-gated mid-playback resume in the pause listener addresses the ROOT cause (no self-heal for external mid-playback pause), not a symptom. Gating on hasPlayedSinceSrc + an explicit user/MediaSession/sleep-timer pause-intent flag + remaining time ensures it only fights EXTERNAL pauses, never a deliberate one."
    blind_spots: "Cannot reproduce the actual Android audio-focus event in the unit/jsdom environment — must rely on a simulated `pause` event + the intent flag contract. Real-device confirmation deferred to human-verify. Also must ensure the resume does not loop against a genuinely-dead track (cap per src) and does not fight the sleep-timer fade (which pauses intentionally)."
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-30 | type: code-trace | src/lib/stores/player.svelte.ts:1135-1148 — the `pause` event listener does ONLY: `playing=false`, `syncPlaybackState()`, `disarmStall()`, `autoplayRetryArmed=false`. It re-issues NO play(). Comment (1143-1147): "an observed `pause` ... clears the autoplay-retry arm so we NEVER re-play() from inside the pause listener (per specialist — that would fight a genuine user pause)." So an external pause mid-playback is indistinguishable here from a user pause and the player freezes.
- timestamp: 2026-06-30 | type: code-trace | The whole self-heal stack is INITIAL-LOAD-only: `armStall` (900-921) returns at 906 once `hasPlayedSinceSrc` is true; `maybeRetryAutoplay` (933-951) is one-shot, only set true on a rejected play() during the src swap in `play()` (lines 2010-2012 offline / 2122-2124 network) and only when `!opts?.fresh`. The `playing` listener (1104-1134) sets `hasPlayedSinceSrc=true` and `autoplayRetryArmed=false`. Therefore once ~1s of audio has played, every retry hook is disarmed → no path re-issues play() on a later pause.
- timestamp: 2026-06-30 | type: code-trace | The `error` path (1248-1313) DOES treat a post-playback interruption as recoverable: line 1274 `if (this.hasPlayedSinceSrc) { reresolveCurrent(); return; }`. But an external audio-focus / throttle PAUSE fires a `pause` event, NOT an `error` event, so this recovery never engages for the reported signature. This confirms the design intent (post-playback interruptions should self-heal) but reveals the `pause`-event branch was never wired into it.
- timestamp: 2026-06-30 | type: code-trace | Intentional-pause sources to exclude from any resume: (1) user tap → toggle()/the play/pause UI; (2) MediaSession `pause` action handler (line 1323 `ms.setActionHandler('pause', () => this.audio?.pause())`); (3) sleep-timer expiry `finishExpiry()` (line 1013 `this.audio?.pause()`). A resume must NOT fight any of these — needs an explicit pause-intent flag set by each before calling pause().

## Eliminated

- timestamp: 2026-06-30 | Hypothesis 2 (prefetch warm-up muted Audio steals focus): the prefetch/probe Audio (`probePlayable`, ~line 1735+) is muted and offscreen and is created during prefetch, not at the moment of the ~1s pause. While plausible on some Android builds, the symptom (self-resumes on foreground, resumable by manual play) is the signature of an external pause with NO self-heal, not of a second element holding focus — and a focus-steal would also break the INITIAL play, not just pause it 1s in. De-prioritized; the missing self-heal is the actionable root cause regardless.
- timestamp: 2026-06-30 | Hypothesis 3 (play() promise rejection swallowed) — already handled: `play()` captures the rejection (`rejected` flag) and arms `maybeRetryAutoplay` for the non-fresh case. That covers the INITIAL load. It does not cover a pause that arrives AFTER playback started (the actual signature), so it is not THIS bug's cause.

## Resolution

root_cause: |
  The single app-wide <audio> element had no "unexpected pause mid-playback -> re-issue play()" self-heal.
  Once a track produced audio (a real `playing` event set hasPlayedSinceSrc=true and disarmed both the
  stall watchdog and the autoplay-retry arm), an EXTERNAL pause on Android Chrome (audio-focus loss to a
  transient sound, background/lock-screen power throttle, or a transient pause right after the auto-advance
  src swap) fired a `pause` event with NO accompanying `error`. The `pause` listener only flipped state and
  disarmed recovery; nothing re-issued play(). All existing recovery (armStall / maybeRetryAutoplay) was
  gated on the INITIAL-LOAD window (!hasPlayedSinceSrc), and the error-path re-resolve only fires on an
  `error` event — neither covers a `pause` AFTER playback started. So a provably-playable track sat frozen
  at ~0:01 until the user tapped play or a foreground return re-granted focus.

fix: |
  Added an intent-gated, bounded, debounced external-pause self-heal in src/lib/stores/player.svelte.ts:
  - New `pauseAudio()` is now the ONE sanctioned way to pause the element: it sets a `deliberatePause`
    flag, disarms any pending resume, then calls audio.pause(). All four intentional pause sources route
    through it: user toggle() (2449), MediaSession 'pause' action (1444), sleep-timer finishExpiry() (1114),
    and handleOffline() (2777).
  - The `pause` listener (1239-1265) consumes the flag: a deliberate pause is honoured (no resume); a pause
    WITHOUT the flag is treated as external and calls scheduleExternalResume().
  - scheduleExternalResume() (1026-1058) re-issues audio.play() after EXTERNAL_RESUME_DELAY_MS (400ms),
    gated on: hasPlayedSinceSrc (skip the initial-load case), not el.ended, time-remaining (>=0.25s from
    end), a per-src budget capped at EXTERNAL_RESUME_CAP (3), and a playGen generation guard. It self-cancels
    if the element resumed on its own or a deliberate pause landed during the debounce.
  - The `playing` listener (1213-1214) and both play() src-set points (2115-2117 offline / 2231-2233 network)
    reset the self-heal state (disarmResume + budget=0 + deliberatePause=false) so each src is judged on its
    own merits and a recovered track refunds its budget.
  - HEADPHONE-UNPLUG EXCEPTION (orchestrator, per user choice): a `devicechange` listener on
    navigator.mediaDevices records lastDeviceChangeAt; scheduleExternalResume() leaves the track paused when
    a pause fires within DEVICE_CHANGE_PAUSE_WINDOW_MS (2000ms) of an output-device change (wired headset /
    Bluetooth disconnect → "becoming noisy"). Resuming there would blast audio from the phone speaker, so an
    unplug is treated like a deliberate pause. Guarded for SSR/jsdom (mediaDevices may be absent).
  A genuinely non-resolvable track is unaffected: it never reaches `playing`, so hasPlayedSinceSrc stays
  false and the existing initial-load watchdog / cross-source failover owns it.

verification: |
  - Added 9 regression tests in src/lib/stores/player.svelte.test.ts under
    "player external-pause self-heal — plays ~1s then paused by Android → re-plays": external pause -> re-play
    after debounce; deliberate pause (toggle) NOT healed; MediaSession pause NOT healed; initial-load pause
    (hasPlayedSinceSrc false) not healed; end-of-track pause not healed; a natural `ended` disarms the pending
    resume; budget cap stops after 3 attempts; a real `playing` refunds the budget; self-resume during the
    debounce skips the re-play.
  - Player suite: 157/157 pass. Full suite: 981/981 across 66 files. svelte-check: 0 errors, 0 warnings.
    (Two debugger runs each added an external-pause self-heal describe block — both green; consolidating
    the duplicate into one block is a low-risk cleanup follow-up.)
  - Orchestrator added 2 headphone-unplug regression tests: a pause within the devicechange window is NOT
    resumed; a pause after the window expires IS still self-healed.
  - NOTE: unit/jsdom cannot reproduce the real Android audio-focus event or the devicechange→pause sequence;
    real-device confirmation is the human-verify step (lock screen / background auto-advance must keep
    playing non-stop; unplugging headphones must NOT resume to the speaker).

files_changed:
  - src/lib/stores/player.svelte.ts (pauseAudio/disarmResume/scheduleExternalResume + pause/playing listeners + src-set resets + clearQueue reset + four deliberate-pause call sites routed through pauseAudio + devicechange/headphone-unplug guard)
  - src/lib/stores/player.svelte.test.ts (external-pause self-heal regression suite + 2 headphone-unplug tests)
