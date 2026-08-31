---
gsd_debug_version: 1.0
slug: bg-lockscreen-stall-noskip
status: awaiting_human_verify
trigger: "Track stuck showing 'fail to fetch' on the lock screen; never advances until the user manually presses next then prev (same song then plays fine in ~600ms). Music should never stop: retry the failed song ONCE, then skip to next if it still fails. Action log shows a bg advance→play with NO resolve.ok and NO playing for ~33s while hidden; no audio.error fired."
created: 2026-07-09
updated: 2026-08-31
---

# Debug: background/lockscreen load stall pins playback (no error → no auto-skip)

## Symptoms (user + action log)

- Locked/backgrounded: a track advance→play HANGS — no `resolve.ok`, no `playing`, no `audio.error` —
  for ~33s until the user opens/interacts. The nowbar/lock screen shows "fail to fetch."
- Manual NEXT then PREV recovers: the SAME song then plays in ~600ms (transient bg load hang, not a
  dead URL).
- Desired: retry the failed song ONCE, then skip to next if still failing → music never stops.

## Log evidence

- t=…537982 kuwo:335142159 `ended` (played ~8.6min, all while `hidden` since …136556) → advance→play
  joox:Z9FB2C10318D01 (fresh:false). NO resolve.ok (consistent with a pre-resolved short-circuit),
  NO `playing`, NO `audio.error` for ~33s.
- t=…571019 visibility hidden:false → t=…586299 user NEXT → joox:ZF9F20B64AEAD9 resolve.ok→playing →
  t=…588401 user PREV → joox:Z9FB2C10318D01 resolve.ok(~600ms)→playing. The stuck song is fine on fg.
- Contrast (self-heal worked): t=…316353 audio.error netease:1989842743 (hidden) → bg-error-skip →
  advance→joox → playing. bg-error-skip fires ONLY when `audio.error` fires; the stuck case fires no
  error (silent load hang), so nothing rescues it.

## Suspects

1. REGRESSION from this session: removing the f7c2580 zero-fetch blob pre-buffer (nowbar-frozen-audius-
   spam) removed the bg-stall mitigation — the next song's BYTES were prebuffered so the bg src-swap
   played LOCAL bytes (no network load that can hang). Also removed the eager prefetch/depth-2 warm.
   Net: a bg advance now does a cold audio-load of a remote URL → hangs while locked.
2. armStall (the load watchdog → runFallback) is a `setTimeout`, THROTTLED/suspended while hidden, so
   the 15s rescue never fires in the background. No bg-tolerant recovery exists for a SILENT load hang
   (only audio.error → bg-error-skip works, and no error fired here).
3. The hang is a transient bg byte-load stall (same URL plays 600ms later on fg), NOT a dead URL.

## Evidence

- timestamp: 2026-07-09
  checked: armStall (player.svelte.ts:1037) + STALL_TIMEOUT_MS (:619=15000) + keepAliveOn (:1171,
    called at play() top :2330) + the audio.error bg-error-skip branch + the `ended`→next path.
  found: the ONLY load-stall rescue is `armStall()` = a single `setTimeout(15s)` → on no `playing`:
    if bytes-present+paused → autoplay retry, else → `runFallback` (cross-source). Mobile browsers
    THROTTLE hidden-tab timers to >=1/min AFTER ~5min hidden. In the log the page was hidden ~6.6min
    (since …136556) before kuwo ended at …537967 → the 15s armStall armed at …537982 was throttled and
    had NOT fired by the time the user opened at …571019 (~33s). The WebAudio keep-alive (bg-resolve-
    gap-stall) did NOT keep the timer un-throttled on this device. So NO timely rescue.
  implication: a SILENT bg load stall (byte-load hangs, fires NO `audio.error`) has no bg-reliable
    rescue — `audio.error`→bg-error-skip only fires on an ERROR, and the timer-based armStall is
    throttled. And there is NO "retry the same song once then skip" — armStall goes straight to
    cross-source runFallback, not the user's requested retry-same-once → skip.

- timestamp: 2026-07-09
  checked: play() audio-load + this session's removals (blob pre-buffer f7c2580, eager/depth-2 prefetch).
  found: removing the f7c2580 zero-fetch blob pre-buffer removed the mitigation that made a bg src-swap
    play LOCAL bytes (no network load that can hang). Now every bg advance does a cold REMOTE audio-load
    → exactly the class that hangs while locked. The prefetch still pre-RESOLVES the URL (so no
    resolve.ok is a warm short-circuit), but the URL's byte-load is what stalls in bg.
  implication: the reliable-recovery signal in bg must be MEDIA EVENTS (`stalled`/`waiting`/`suspend`
    fire in a hidden tab, unlike throttled timers) OR local bytes (prebuffer). A timer-only fix cannot
    be bg-reliable.

- timestamp: 2026-08-31
  checked: round 2 — player.svelte.ts recoverLoadStall (:1243), the `stalled` listener (:1689),
    armStall (:1215, STALL_TIMEOUT_MS=15000 :685), the `playing` handler (:1599, resets stallRetried),
    the visibilitychange handler (:1546, clearAllStrikes('foreground') on visible), against
    bg-stall-burndown-log-1.json.
  found: the `stalled` listener calls recoverLoadStall() on the FIRST `stalled` event before first
    audio, with no document.hidden check, no debounce, no elapsed-since-src floor. Log timing (retry at
    +3.3–3.5s = the ~3s `stalled` spec threshold, not 15s) proves the event listener drove the cascade.
    qq resolved hasUrl:true and was skipped 7.7s after play; strike.clear-all n:2 confirms 2 healthy
    strikes. /api fetches DO complete while hidden (qq resolve.ok in 3.4s) — only the MEDIA element's
    byte-load is deferred, so a skip lands on a track facing the identical deferral: burn-down by
    construction. stallRetried resets per src → each skipped-to track gets a fresh budget → nothing
    bounds the cascade except queue exhaustion.
  implication: the applied fix inverted the bug exactly as hypothesized. `stalled` while hidden with no
    audible playback this hide-stint is the platform's NORMAL state, not a fault signal. The rescue must
    PARK there and resume on foreground; it may stay live while hidden WITH audible playback (July
    capture: 8.6min locked playback — loads work then, so a stall is track-specific).

## Eliminated

- hypothesis: The URL was dead / region-locked.
  evidence: the SAME joox:Z9FB2C10318D01 resolved+played in ~600ms on foreground (…588401) right after.
    Transient bg byte-load stall, not a dead URL.
  timestamp: 2026-07-09

- hypothesis: bg-error-skip is broken.
  evidence: it worked earlier (…316353 audio.error hidden → bg-error-skip → advance→playing). It only
    fires on `audio.error`; the stuck case fires no error (silent load hang), so it never engaged.
  timestamp: 2026-07-09

## Root Cause (CONFIRMED)

A backgrounded/locked advance→play does a cold REMOTE audio byte-load that HANGS (transient bg network
stall). It fires NO `audio.error` (so bg-error-skip never triggers) and NO `playing`. The only load-stall
rescue, `armStall`, is a `setTimeout(15s)` — THROTTLED to >=1/min in a long-hidden tab — so it fires ~1
min late (after the user already intervened). There is thus no bg-reliable, timely recovery, and no
"retry the same song once then skip" (armStall jumps straight to cross-source runFallback). This session
removed the blob pre-buffer that used to sidestep the bg network dependency, aggravating it.

## Fix (user chose BOTH: bounded prebuffer + media-event retry→skip)

`src/lib/stores/player.svelte.ts`:
1. **Bounded next-song blob PRE-BUFFER (primary — local bytes, no bg network to hang).** Reintroduced
   `prebufferNext` (removed this session as the f7c2580 flood). BOUNDED so it can't flood: `prebufferedUid`
   is CLAIMED before the fetch and left set on BOTH success AND failure/abort → a URL is fetched at most
   ONCE per uid, never re-fetched on churn; single in-flight (abort prior); fired ONLY from the ≥5s
   timeupdate prefetch gate (prewarmNextAssets), never on the never-stop churn; skipped for downloads.
   play() consumes it (`else if prebufferedUid===resolved.uid`) so a backgrounded/locked src-swap plays
   LOCAL bytes. Cleaned up on clearQueue. Raw fetch of media bytes (not apiFetch — media is never governed).
2. **Media-event retry-once-then-skip (backstop — bg-reliable).** New `recoverLoadStall()` shared by the
   `armStall` timer AND a new `stalled` media-event listener (`stalled` FIRES in a hidden/locked tab,
   unlike the throttled setTimeout — the root gap). First stall on a src → re-resolve + re-attach the
   SAME song ONCE (`reresolveCurrent`, via the braked driveSrc); a SECOND stall with still no `playing`
   → strike + `next()` (SKIP) so music never stops. `stallRetried` one-shot flag resets on a new src +
   real `playing`. armStall no longer goes straight to runFallback (matches the user's "skip to next").

## Verification

- `pnpm check` 0/0. `pnpm test` 69 files, **1086** pass. Updated/added tests: bounded-prebuffer (fetches
  once, dedupes a second prewarm — the flood-safety proof); watchdog now RETRIES-once then SKIPs (not
  runFallback); a second stall advances to the next track.
- DEVICE-ONLY (per memory bg-playback-resolve-gap-freeze): a bg timer-throttle cannot be reproduced in a
  desktop tab, so on-device verify via Settings → Activity log: reproduce the lock-screen stall and
  confirm the log shows `stall.retry` then (if still stuck) `stall.skip` → advance → playing, instead of
  a silent 30s+ hang. Confirm no `src.redrive-brake` / api storm regression.

## Current Focus (round 2 — 2026-08-31 burn-down inversion)

- hypothesis: CONFIRMED — the `stalled` listener (player.svelte.ts:1689) fires `recoverLoadStall()` on
  the FIRST `stalled` event with no `document.hidden` awareness. On a hidden Android tab with no audible
  playback, media byte-loading is deferred by the platform, so `stalled` fires ~3s after every src-attach
  by construction → retry (+3.3s) → second `stalled` → strike+skip (+3–4s) → advance to another track
  that equally cannot load → queue burn-down.
- next_action: FIX APPLIED + gates green (check 0 errors, 1737 tests pass). Awaiting on-device verify
  via Settings → Activity log: locked-screen load gap must show NO stall.retry/skip cascade, and unlock
  must show stall.fg-recheck → resolve.ok → playing. On confirm: archive + commit.
- reasoning_checkpoint:
    hypothesis: "The stalled-event listener converts the NORMAL hidden-tab deferred-load state into
      retry-then-skip because it acts on the first `stalled` with no hidden/audible discriminator."
    confirming_evidence:
      - "Timing: stall.retry at +3.5s/+3.3s after hide/play — matches the spec's ~3s stalled threshold,
        NOT the 15s armStall timer (STALL_TIMEOUT_MS=15000 at :685). Only the event listener can fire
        that fast."
      - "qq:0018RG3d1lBjKR resolve.ok hasUrl:true at +3.4s, then stall.retry +3.3s, stall.skip +4.4s —
        a healthy resolvable track struck and skipped 7.7s after play, while hidden."
      - "strike.clear-all reason:foreground n:2 — two tracks struck during an 18s hidden stint; no
        `playing`, no `pause`, no `audio.error` anywhere in the capture."
      - "Code read: recoverLoadStall's only guards are hasPlayedSinceSrc / deliberatePause / the
        bytes-present autoplay branch; nothing checks document.hidden; stallRetried resets per src so
        every skipped-to track gets a fresh retry-then-skip budget — unbounded cascade."
    falsification_test: "If armStall's timer were the driver, retry would appear >=15s after src-attach;
      it appeared at ~3.3s. If the URLs were dead, resolve.ok hasUrl:true would not appear; it did.
      If skipping while hidden restored audio, a `playing` event would follow an advance; none did."
    fix_rationale: "Root cause is acting on `stalled` while the platform is DEFERRING loads (hidden +
      not audible), not the retry-then-skip mechanism itself. Fix: park the rescue while
      document.hidden && !audibleThisHide (set flag, return); re-run it on visibilitychange→visible with
      a fresh retry budget (foreground un-defers loads — the manual next/prev recovery proved a fg
      re-drive plays in ~600ms). Keep retry-then-skip live while hidden WITH audible playback this
      hide-stint (the July capture played 8.6min locked — loads demonstrably work there, so a stall IS
      track-specific); bound residual bg cascades by clearing audibleThisHide on a bg stall.skip (one
      bg skip per audible streak)."
    blind_spots: "Whether the July silent-hang case (audible bg session, advance stalls) still gets
      rescued in time relies on audibleThisHide=true there — device-only to confirm. Whether `stalled`
      re-fires reliably for the second stall after a bg reresolve is browser-dependent; armStall's
      timer remains the fg backstop. The fg recheck re-drives a load that might have completed on its
      own ~600ms later — wasteful but correct. Not reproducible in node/vitest; device verify required."
- tdd_checkpoint:

## Round 2 Root Cause (CONFIRMED 2026-08-31)

The round-1 `stalled` listener acts on the FIRST `stalled` event with no `document.hidden` awareness.
On a hidden Android tab with no audible playback, the platform DEFERS media byte-loads entirely, so
`stalled` fires ~3s after every src-attach by construction (log: retry at +3.3–3.5s, far below the 15s
timer) → retry → second `stalled` → strike + skip → advance to a track facing the identical deferral →
queue burn-down. Skipping while hidden-and-silent can never restore audio (no `playing` anywhere in the
capture; /api resolves DO complete — only media byte-loads are deferred). stallRetried resets per src,
so nothing bounded the cascade.

## Round 2 Fix

`src/lib/stores/player.svelte.ts` (all tagged `bg-lockscreen-stall-noskip (round 2)`):
1. New plain fields `audibleThisHide` (has audio been audible this hidden stint — snapshotted from
   `this.playing` at hide-time, set true by a real `playing` event) and `stallRecheckOnVisible`.
2. `recoverLoadStall()`: when `document.hidden && !audibleThisHide`, PARK — set the recheck flag and
   return (no retry, no strike, no skip). Retry-then-skip stays live while hidden WITH audible playback
   (the July silent-hang case: 8.6min locked playback proves bg loads work there → stall is
   track-specific).
3. The skip branch clears `audibleThisHide` — ONE bg skip per audible streak; the skipped-to track must
   itself produce audio before another hidden skip is allowed (bounds any residual cascade to one hop).
4. visibilitychange(visible): after clearAllStrikes, a parked rescue re-runs with a FRESH retry budget
   (`stall.fg-recheck` action-log event) — foreground un-defers loading, mirroring the manual next/prev
   recovery that played the same song in ~600ms. Guarded: only when the src never produced audio and
   never on a deliberate pause (NOT the quick-260703-i7e auto-resume).

## Round 2 Verification

- `pnpm check` 0 errors. `pnpm test` 95 files, 1737 pass. New regressions in player.svelte.test.ts
  (stall watchdog suite): hidden+silent parks (no retry/skip/advance, recheck armed); hidden+audible
  keeps retry-then-skip but the skip spends the audible flag so the next hidden stall parks; foreground
  return resumes the parked rescue with a fresh budget via the captured visibilitychange handler.
- DEVICE-ONLY: lock the screen during a load gap; Activity log must show NO stall.retry/stall.skip
  cascade while locked, and on unlock a `stall.fg-recheck` → resolve.ok → playing. Also re-verify the
  July shape (long locked playback, then an advance) still recovers (stall.retry/skip allowed there).

## NEW DEVICE EVIDENCE (2026-08-31) — the applied fix appears to have INVERTED the bug

Log: `.planning/debug/bg-stall-burndown-log-1.json` (14 events, ~32s, Android Chrome, screen locked).

```
322613  visibility hidden:true
326168  stall.retry  netease:2749056424      (+3.5s after hide)
329495  stall.skip   netease:2749056424      (+3.3s)
329506  advance   -> qq:0018RG3d1lBjKR
329509  play         qq:0018RG3d1lBjKR (fresh:false)
332874  resolve.ok   qq  hasUrl:TRUE         (+3.4s)
336135  stall.retry  qq                      (+3.3s after a GOOD url)
340573  stall.skip   qq                      (+4.4s)
340574  advance   -> kuwo:similar-micahedwards|moments
340575  play         kuwo
341604  resolve.fail kuwo hasUrl:false
353857  visibility hidden:false
353858  strike.clear-all reason:foreground n:2
354526  visibility hidden:true
```

### What the log rules OUT

- **No `pause` event anywhere.** The external-pause / audio-focus-fight hypothesis
  (`autoadvance-pauses-after-1s`, `midplay-stall-background`) does not apply to this capture.
  Nothing paused us; nothing needed a resume discriminator.
- **No `playing` event anywhere.** No track ever produced audio. So this is not "plays 1s then dies" —
  it is "never starts, gets skipped".
- **Not a dead-URL problem.** qq resolved with `hasUrl:true` and was skipped anyway, 7.7s after `play`.
- **Not throttling.** The watchdog fired *promptly* while hidden — the opposite of the
  `background-autoadvance-stall` diagnosis that timers never fire.

### Primary hypothesis — the `stalled` listener burns the queue down

`STALL_TIMEOUT_MS = 15000` (player.svelte.ts:685), but retry fired **3.3s** after play. So the driver is
NOT `armStall`'s timer — it is the media **`stalled` event** listener added by THIS session's fix
(player.svelte.ts:1690):

```ts
el.addEventListener('stalled', () => {
    if (!this.hasPlayedSinceSrc) this.recoverLoadStall();
});
```

`stalled` fires whenever the element wants bytes and none arrive. **A hidden Android tab deliberately
does not load bytes** — so `stalled` is the NORMAL state there, not a fault signal. `recoverLoadStall()`
(1243) then runs:

- guard `el.paused && readyState >= HAVE_CURRENT_DATA` → autoplay retry (safe path) — but while hidden
  bytes are absent, so `readyState < HAVE_CURRENT_DATA` and this guard **does not catch the case**;
- first stall → `reresolveCurrent()` (re-attaches src → new load → hidden → `stalled` again);
- second stall → `strikeUnplayable()` + `emitSkipNotice()` + `next()`.

Result: every healthy track is struck and skipped ~7s after it becomes current, each skip advancing to
another track that cannot start either — a **cascade that eats the queue while locked**. `strike.clear-all
n:2` on foreground confirms 2 good tracks were struck. Intended to rescue a silent hang; instead it
converts the ordinary hidden-tab no-bytes state into an auto-skip.

Note there is **no debounce and no cross-track ceiling** on this path — `stalled` may fire repeatedly, and
`stallRetried` resets per src, so every new track gets a fresh retry-then-skip budget. Nothing bounds the
cascade except running out of queue.

### Questions for the investigation

1. Can `stalled` be distinguished from a genuine hang while hidden? Candidate discriminators:
   `readyState`, `networkState === NETWORK_LOADING`, `buffered.length`, elapsed-since-src, or requiring
   N consecutive `stalled` events over a real time window rather than acting on the first.
2. Should `recoverLoadStall` skip AT ALL while `document.hidden`? A hidden tab that cannot start is the
   expected platform state; striking a track for it is a false positive by construction.
3. Does the Web Audio keep-alive (1384) actually hold the page awake here? It was armed (play ran) yet
   bytes still never arrived — evidence it does not force byte loading, only prevents freeze.
4. Untested angle from the user: move `ensureTrackDetails`/queue resolution into a **Web Worker** so the
   cold resolve cannot be frozen mid-flight. Note the qq resolve DID complete here (3.4s), so the resolve
   is not the failing step in THIS log — the byte load after src-attach is.

### Explicitly out of scope

- Dual-`<audio>` gapless buffer / crossfade: tried and reverted (focus-steal, player.svelte.ts:1363).
- Re-adding `scheduleExternalResume`: removed in `e29ae66` for the voice-note resume-fight; no `pause`
  event appears in this log, so it is irrelevant here regardless.
