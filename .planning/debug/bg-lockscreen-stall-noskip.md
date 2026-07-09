---
gsd_debug_version: 1.0
slug: bg-lockscreen-stall-noskip
status: fix-applied-pending-device-verify
trigger: "Track stuck showing 'fail to fetch' on the lock screen; never advances until the user manually presses next then prev (same song then plays fine in ~600ms). Music should never stop: retry the failed song ONCE, then skip to next if it still fails. Action log shows a bg advance→play with NO resolve.ok and NO playing for ~33s while hidden; no audio.error fired."
created: 2026-07-09
updated: 2026-07-09
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

## Current Focus

- hypothesis: A backgrounded advance→play does a cold remote audio-load that HANGS while locked; no
  `audio.error` fires so bg-error-skip never triggers, and armStall (setTimeout) is bg-throttled so the
  load watchdog never rescues → playback pinned until manual next/prev. Worsened by this session
  removing the blob pre-buffer + eager/depth-2 prefetch that used to pre-warm the next song for bg.
- test: read the play/resolve/armStall/ended paths; confirm no bg-tolerant rescue for a silent
  (error-less, playing-less) load hang; design a retry-once-then-skip that fires even backgrounded
  without reintroducing the flood/reresolve/freeze classes.
- next_action: gather initial evidence — read player.svelte.ts play() audio-load + armStall + ended.
- reasoning_checkpoint:
- tdd_checkpoint:
