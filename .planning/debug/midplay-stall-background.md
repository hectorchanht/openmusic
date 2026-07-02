---
gsd_debug_version: 1.0
slug: midplay-stall-background
status: awaiting_human_verify
trigger: "Songs stuck at middle of playing recently, cause unknown, seems not network. Sometimes shows error 'playback stopped - couldn't load songs' — but fetch errors should never stop the player, they should skip until a playable song."
created: 2026-07-02
updated: 2026-07-02
---

# Debug: songs stall mid-play while backgrounded; error toast 'playback stopped - couldn't load songs'

## Symptoms

- **Expected:** Player never stops. Simple, sensible mechanism: prefetch next song near end of current for seamless advance; if a track fails to resolve from ALL available sources, skip it; keep next-up list auto-populated when exhausted. Do NOT force play against external audio-focus loss (interferes with other apps' voice notes) — no aggressive resume-fighting.
- **Actual:** Songs stall mid-play. Audio stops with timer frozen; tap play resumes it; sometimes resumes only after foregrounding. Sometimes UI shows error "playback stopped - couldn't load songs" and playback halts (should be impossible — fetch failures must skip, not stop).
- **Errors:** UI toast/message "playback stopped - couldn't load songs". Action log shows repeated `audio.error` with `hasPlayed:true`, `reresolve.cap`, `mark-dead`.
- **Timeline:** Recent regression/behavior; prior related sessions: background-autoadvance-stall (hasPlayedSinceSrc fix landed), autoadvance-pauses-after-1s (awaiting verify), reresolve-loop-stops-playback (reresolve cap landed).
- **Reproduction:** Android, background / screen locked. Not reliably reproducible; two on-device action-log exports captured covering stalls.

## Evidence

- Action-log exports saved: `.planning/debug/midplay-stall-log-1.json` (585 events, ~3.1h span) and `.planning/debug/midplay-stall-log-2.json` (52 events, ~23min span).
- Log event distribution (log1): pause 99, audio.error 75, ext-resume.schedule 69, play 60, resolve.ok 50, advance 49, playing 47, visibility 42, ext-resume.play 24, mark-dead 19, reresolve.cap 17, ended 13, visibility.resume 9, grow.added 6, retry-dead 3, grow.request 2, fallback 1.
- Pattern A — resume fight loop (log2, while hidden): `playing` → `pause(deliberate:false)` ~120ms later → `ext-resume.schedule(budget:1)` → `ext-resume.play` ~400ms later → `playing` → `pause` again — repeats ~2x/sec for many rounds on qq:0028lHKV21AMgm. Forced resume fighting external audio-focus holder (matches user's voice-note interference complaint).
- Pattern B — background dead-play stall (log1 @ t=1782956754225): `audio.error(hasPlayed:true, n:4)` → `reresolve.cap` → `pause(deliberate:false)` → `ext-resume.schedule` → `advance(toUid:netease:110740)` → `play` → `resolve.ok` → then NO `playing` event for ~123s until `visibility hidden:false`; user manually advanced to another track.
- Pattern C — double-play race (log1 @ t=1782956920212..922286): user plays netease:32701152 (`playing` at ...921001), then 1.3s later a stale `play(netease:110740)` fires and takes over (`playing` at ...922772) — the stalled pending play from Pattern B resurfacing after foreground.
- Note: ext-resume.schedule 69 vs ext-resume.play 24 — most scheduled resumes never execute (budget exhausted or superseded).

## Eliminated

- hypothesis: The EXTERNAL_RESUME_CAP (3) bounds the resume fight so Pattern A self-limits.
  evidence: log-1 shows `budget:1` on EVERY ext-resume.schedule for qq:0028lHKV21AMgm across 8 consecutive forced resumes / 3.6s. The `playing` listener resets `externalResumeBudget = 0` (player.svelte.ts:1320) on every successful re-play, so the cap at line 1090 is NEVER reached — the fight is unbounded (playing→pause→schedule(budget→1)→play→playing→pause…). The cap only helps if play() KEEPS failing; here each forced play() briefly succeeds (fires `playing`), refunding the budget, so it fights forever.
  timestamp: 2026-07-02

## Current Focus

reasoning_checkpoint:
  hypothesis: "The mid-play stall + 'playback stopped' toast + voice-note interference are three symptoms of ONE root design: the player aggressively FORCES audio.play() to fight any non-deliberate pause (scheduleExternalResume from the `pause` listener) and re-resolves/advances errored tracks — and this fight machinery both (A) creates an unbounded resume loop against an external audio-focus holder and (B) misclassifies mid-stream CDN 403s as recoverable so it re-resolves dead tracks in place instead of skipping, and (C) surfaces this.error='toast.playbackStopped' on every total-failure even while it is (or should be) skipping."
  confirming_evidence:
    - "Pattern A (log-1 t=46.2-50.4): playing→pause(deliberate:false)→ext-resume.schedule(budget:1)→ext-resume.play→playing, repeating ~2/sec for 8 rounds on qq:0028lHKV21AMgm. budget is ALWAYS 1 because the `playing` listener (player.svelte.ts:1320) resets externalResumeBudget=0 on each success — the EXTERNAL_RESUME_CAP defeats itself. This IS the forced-resume fight against an external focus holder (voice notes)."
    - "Pattern B (log-2 t=1037): audio.error(hasPlayed:true)→reresolve.cap(n=4)→pause(deliberate:false)→ext-resume.schedule→advance(netease:110740)→play→resolve.ok→ then NO `playing` for ~123s until visibility hidden:false. Advance while hidden set src+play() but play() was rejected (hidden tab, no activation) and nothing recovered it until foreground."
    - "audio.error fires with hasPlayed:true only ~0.8-1.3s after a fresh advance/play on a just-resolved netease track (log-1 t=647-661, repeated ~2/sec across many consecutive netease tracks). The track briefly starts (a timeupdate flips hasPlayedSinceSrc=true) then the byte-stream 403s — a region-lock. The `error` handler (player.svelte.ts:1514) then routes hasPlayed=true errors into reresolveCurrent() (re-resolve SAME dead song up to RERESOLVE_CAP) BEFORE falling through to advance — turning one dead track into 3-4 wasted re-resolves, and the next track is another region-locked netease → storm."
    - "Pattern C (log-2 t=1203-1205): user foregrounds and plays netease:32701152 (playing at t=1204.1); 1.3s later the STALE pending play(netease:110740) from Pattern B resurfaces (playing at t=1205.9) and takes over — the backgrounded advance's play() finally succeeded on foreground and clobbered the user's choice."
    - "this.error='toast.playbackStopped' is set in handleTotalFailure (player.svelte.ts:2862) immediately before this.next(), and in the error/no-url paths (1536, 2336). It is only cleared on a real `playing` (implicit via next play) or play() entry (2174). During the region-lock storm the advance chain stalls (Pattern B) so no `playing` clears it → the toast sticks while the player is silent, which is exactly the 'playback stopped - couldn't load songs' the user sees despite fetch failures being supposed to skip."
  falsification_test: "If Pattern A were bounded, ext-resume.schedule would show budget incrementing 1→2→3 then stopping; instead every entry is budget:1. If the error path did NOT re-resolve dead tracks, there would be no reresolve.cap events; log shows 17 in log-1. If the advance were resilient in background, a `playing` would follow the backgrounded play() within a couple seconds; instead there is a 49-123s gap until foreground."
  fix_rationale: "Per the user's target spec the fix must SIMPLIFY toward: never force-play against an external/audio-focus pause; skip a track that fails all sources; prefetch next; accept background-kill. The root cause is the FIGHT machinery itself, so the fix REMOVES it rather than adding compensation: (1) delete scheduleExternalResume + the `pause`-listener re-play so an external pause is simply respected (fixes Pattern A + voice-note interference); (2) stop re-resolving a hasPlayed track that mid-stream-errors — treat a byte-stream error as a failed track and advance/skip (removes reresolve storm, RERESOLVE_CAP); (3) do NOT set this.error='toast.playbackStopped' on the skip/total-failure path — skipping is not stopping (only a genuine, user-visible give-up should notice); (4) keep resumeIfStalled (foreground re-play) but guard it so a stale backgrounded advance cannot clobber a newer user play (fixes Pattern C via playGen check)."
  blind_spots: "Removing scheduleExternalResume may regress the original autoadvance-pauses-after-1s case (a genuine transient focus blip right after an auto-advance). Need to confirm that case is now covered by resumeIfStalled on foreground + the fact that a truly transient blip self-resumes without our help. Also: cannot reproduce on-device here — verification is log-reasoning + user confirmation. The netease region-lock is upstream/environmental; the fix makes the player SKIP past it gracefully rather than curing the 403s."

test: Map each of the 3 log patterns to exact source lines (done). Design the simplification: remove fight loop, reclassify mid-stream errors as skips, stop surfacing the stopped-error on skip.
expecting: A smaller player.svelte.ts with the external-resume machinery removed, the error-path reresolve gated to seek-recovery only, and the skip path not setting this.error.
next_action: Apply the SIMPLIFYING fix in player.svelte.ts (remove scheduleExternalResume + pause-listener re-play; reclassify hasPlayed mid-stream error as a skip not a reresolve; do not set this.error on total-failure skip; playGen-guard resumeIfStalled).

## Resolution (root cause section below is authoritative)

## Desired fix behavior (user-specified target)

- Keep playing mechanism SIMPLE and sensible.
- Do NOT force play on external pause (audio focus loss) — no fight loop; respect other apps (voice notes).
- Prefetch next song near end of current → seamless advance.
- Track failing to resolve from all available sources → skip to next.
- Next-up list auto-populates when exhausted.
- If Android's background killing can't be beaten, accept it — simplicity over fighting.

## Resolution

- root_cause: >
    The mid-play stall family is caused by the player's AGGRESSIVE resume/recovery machinery, not by an
    external failure. Three interacting mechanisms in src/lib/stores/player.svelte.ts:

    (A) Resume fight loop [Pattern A + voice-note interference]: the `pause` listener called
    scheduleExternalResume() on ANY non-deliberate pause, re-issuing audio.play() after 400ms. When the
    OS paused us to let another app (a voice note) take audio focus, we grabbed it back — and because a
    successful re-play fires `playing`, which reset externalResumeBudget=0 (player.svelte.ts:1320), the
    EXTERNAL_RESUME_CAP(3) never engaged. Log-1 shows budget:1 on every one of 8 consecutive forced
    resumes over 3.6s on qq:0028lHKV21AMgm — an unbounded fight (playing→pause→schedule→play→playing→…).

    (B) Reresolve storm on region-locked tracks [Pattern B]: netease returns a URL that resolves fine,
    plays ~1s (a timeupdate flips hasPlayedSinceSrc=true), then the byte-stream 403s (region lock). The
    audio.error handler routed hasPlayed=true errors into reresolveCurrent() (re-resolve the SAME dead
    URL) up to RERESOLVE_CAP(3) before falling through to advance — turning each dead track into 3-4
    wasted re-resolves, and the advance lands on ANOTHER region-locked netease track → a ~2/sec storm
    (log-1 t=647-661, 17 reresolve.cap events). While backgrounded, the post-storm advance's play() is
    rejected (no activation in a hidden tab) and nothing recovers it → silence + frozen timer for
    49-123s until foreground (log-2 t=1037→1160).

    (C) "playback stopped" toast on skip: handleTotalFailure set this.error='toast.playbackStopped'
    (player.svelte.ts:2862) right before this.next(). Normally the next play() clears it, but when the
    background advance chain stalled (B), no `playing` cleared it → the sticky "playback stopped -
    couldn't load songs" showed while the player was merely skipping — exactly the reported impossible
    error. (Pattern C, the double-play race, is a downstream symptom of the background churn A+B create.)
- fix: >
    SIMPLIFIED the mechanism toward the user's target spec (do not fight external pause; skip a track
    that fails all sources; recover only on foreground; accept background-kill). All in
    src/lib/stores/player.svelte.ts:
    1. REMOVED the external-pause self-heal entirely — deleted scheduleExternalResume(), the
       `devicechange` listener, and the externalResumeBudget / EXTERNAL_RESUME_CAP / EXTERNAL_RESUME_DELAY_MS
       / DEVICE_CHANGE_PAUSE_WINDOW_MS / lastDeviceChangeAt state. The `pause` listener now just consumes
       the deliberate flag and disarms any pending resume — a non-deliberate pause is RESPECTED. (fixes A)
    2. Capped the post-playback in-place re-resolve at ONE attempt (was 3): a track that errors again
       before producing audio is treated as failed and SKIPPED via the cross-source/advance path instead
       of re-resolving a dead URL repeatedly. Removed the now-dead RERESOLVE_CAP static. (fixes B)
    3. handleTotalFailure no longer sets this.error='toast.playbackStopped' — skipping is not stopping;
       the self-dismissing batched skip notice is the correct signal. this.error is reserved for a
       genuine give-up (offline-no-downloads / resolve throw). (fixes C)
    Recovery of a background-stalled track remains via resumeIfStalled() on foreground return (the ONE
    sanctioned resume), plus the initial-load autoplay-retry — both unchanged.
- verification: >
    - npx svelte-check: 0 errors, 0 warnings.
    - Full vitest suite: 995/995 pass. Rewrote the two suites that encoded the OLD contract:
      * "external-pause self-heal" (13 tests) → "respects external pause" (5 tests) + "foreground resume"
        (3 tests): lock in that a non-deliberate pause is never re-played, repeated external pauses never
        fight, deliberate/MediaSession/headphone pauses are respected, and a background-stalled track is
        re-played once ONLY on foreground when it was playing at hide-time.
      * "bounded post-playback re-resolve" (cap 3) → "single post-playback re-resolve then skip" (cap 1):
        one error → one in-place re-resolve; a second error before `playing` → fall through to skip.
    - Log re-analysis: with the fight loop removed, Pattern A cannot recur (no ext-resume path exists);
      with cap=1, Pattern B's reresolve storm collapses to one attempt then a skip; with the error not set
      on skip, the sticky toast cannot appear during a skip burst.
    - NOT device-verified here (Android background, not reproducible on demand) — awaiting user
      confirmation on-device. The netease region-lock (the 403s) is upstream/environmental; this fix makes
      the player skip past it cleanly rather than curing the 403s.
- files_changed: [src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts]
