---
slug: playback-skip-and-autoplay
status: resolved
trigger: "Two playback bugs. (1) Songs get marked unplayable/skipped too easily — they are often playable when clicked again later, but the probe/skip logic skips them prematurely. (2) Sometimes a playable next song becomes the current track but does NOT start playing automatically — the user must press play, which interrupts the continuous/endless music flow."
created: 2026-06-15
updated: 2026-06-15
---

# Debug: playback skip-too-easily + next-song-no-autoplay

## Symptoms

**Bug 1 — over-aggressive skip / false-unplayable**
- Expected: a track is only marked unplayable/skipped when it genuinely cannot be played; transient failures should not permanently skip it.
- Actual: tracks get marked unplayable/skipped too easily during auto-advance. The same tracks are frequently playable when the user clicks them again later, proving the skip was premature (transient probe/fetch failure treated as permanent dead).
- Errors: none surfaced to user (silent skip).
- Timeline: existing resilience/probe behavior; recent quick task 260615-i9u added the ✗ skipped-track markers + `unplayableUids` (SvelteSet) + `retryUnplayable`.
- Repro: let the queue auto-advance across several tracks (esp. mixed sources / JOOX probing); observe tracks routed past as "skipped" that play fine on manual re-click.

**Bug 2 — next song becomes current but does not auto-play**
- Expected: when the queue advances to a playable next track, it starts playing automatically — uninterrupted "endless flow".
- Actual: sometimes the next (playable) track becomes the current track but playback does not start; the user must press the play button to resume, breaking continuous listening.
- Errors: none reported.
- Timeline: existing auto-advance behavior.
- Repro: allow auto-advance (track-end) repeatedly; intermittently the new current track is loaded/displayed but paused.

## Investigation scope (orchestrator hints)

- Core file: `src/lib/stores/player.svelte.ts` — contains the skip/probe/unplayable detection, `unplayableUids` / `isUnplayable` / `retryUnplayable`, `nextPlayableIndex` skip-loop routing, and the auto-advance + auto-play seam.
- Component: `src/lib/components/NowPlaying.svelte` renders the ✗ skipped Up-Next row and tap-to-retry.
- Sources: `src/lib/sources/joox.ts` (HEAD/range URL probing — likely the premature-dead source), `src/lib/sources/jamendo.ts`.
- Tests: `src/lib/stores/player.svelte.test.ts` (854-suite contract; player 98→107).

## Evidence

- timestamp: 2026-06-15 — `prefetchNext()` (player.svelte.ts:1309-1318) marks a uid PERMANENTLY (session) dead in `unplayableUids` on the FIRST definitive signal: (a) a resolve that returns `audioUrl === null` (line 1310), or (b) a single `error` event from the silent `probePlayable` muted-audio probe (line 1318). There is NO strike count / confirmation — one failure = dead-for-the-session. `nextPlayableIndex()` (line 1866) then routes EVERY future advance past it silently.

- timestamp: 2026-06-15 — `unplayableUids` is session-scoped and only cleared by `clearQueue()` (line 1178), `recoverFromStop()` (line 2116), or `retryUnplayable()` (line 1892). Auto-advance never clears it. So a single transient blip permanently sidelines a track until the user manually clears the queue or taps the ✗ row.

- timestamp: 2026-06-15 — `src/lib/sources/joox.ts` `probeJooxAudioUrl()` (HEAD then range-GET, 3s timeout, lines 79-109) returns `false` on ANY transient failure (timeout, CORS, edge 403 on a signed URL, HEAD-not-allowed-AND-range-rejected). `pickJooxPlayUrl()` (line 139) then skips that tier and can return `url: null` for the whole track → `resolve()` leaves `audioUrl: null` → `ensureTrackDetails` resolves a track with no url → `prefetchNext` marks it dead (Bug-1 cause #1). The browser-side probe is a SEPARATE fetch from the actual `<audio>` byte fetch; a probe that fails (rate-limit / region edge) does not prove the `<audio>` GET would fail.

- timestamp: 2026-06-15 — `probePlayable()` (line 1355) is a muted offscreen `Audio` element racing canplay vs a single `error` vs a 1.5s timeout. A SINGLE `error` returns `{ok:false, errored:true}` → caller marks dead. Probe-element errors can be transient (signed-URL refresh, codec quirk on the offscreen element, network blip) yet are treated as definitive (Bug-1 cause #2).

- timestamp: 2026-06-15 — Bug 2: `play()` sets `this.audio.src = src` then `await this.audio.play().catch(() => {})` (lines 1699-1707 network path, 1609-1617 offline path). On AUTO-ADVANCE (`ended` → `next()` → `play()` with NO `fresh`/`fromFallback`), there is no fresh user gesture AND `ensureTrackDetails` is an async network round-trip (seconds) BEFORE `play()` — so the user-activation/gesture context from the long-ago tap is gone. On mobile (iOS Safari / Android Chrome) `audio.play()` then REJECTS (autoplay policy). The rejection is swallowed by `.catch`. No `play`/`playing` event fires → `current` is set + displayed but `playing` stays false and the track sits PAUSED — exactly the symptom.

- timestamp: 2026-06-15 — Bug 2 secondary: the only recovery for that swallowed rejection is the stall watchdog `armStall()` (line 692), which fires after STALL_TIMEOUT_MS = 15000ms and routes into `runFallback()` — a CROSS-SOURCE SWAP. That is the wrong recovery: the track is perfectly playable, it is just paused by autoplay policy. runFallback re-resolves another source and calls `play()` again → same autoplay rejection. Net effect: up to 15s of a paused-but-loaded track, then a pointless source swap, still paused. User must tap play.

- timestamp: 2026-06-15 — Confirmed the loop-guard / `tripLoopGuard` block is intentionally commented out (commits 157d616 "remove tripLoopGuard", eb8a450 "hide tripLoopGuard"). This is a prior deliberate decision and is NOT part of either bug; leave as-is.

- timestamp: 2026-06-15 — `npm run check` baseline: 0 errors / 0 warnings. Must stay 0/0.

## Root Cause

**Bug 1 (over-aggressive skip):** `prefetchNext` marks a track PERMANENTLY unplayable for the whole session on the FIRST definitive failure signal (no-audioUrl resolve OR a single muted-probe `error`), with no strike count and no auto-expiry. Because both the JOOX HEAD/range probe and the offscreen `probePlayable` element are SEPARATE fetches from the real `<audio>` byte fetch — and are subject to transient timeouts, edge 403s on signed URLs, CORS, and rate-limiting — a transient failure is misclassified as permanent death. `nextPlayableIndex` then silently routes past the track on every future advance, while a fresh resolve at manual click-time (new signed URL, different edge) succeeds — producing the "skipped but plays fine when re-clicked" symptom.

**Bug 2 (no auto-play on advance):** On auto-advance, `play()` performs an async `ensureTrackDetails` resolve and only THEN calls `audio.play()`. The await discards any residual user-activation, so on mobile `play()` is rejected by autoplay policy; the rejection is swallowed and there is NO retry — the track is left current-but-paused. The sole fallback (the 15s stall watchdog → `runFallback` cross-source swap) is both slow and the wrong remedy for an autoplay-policy pause.

## Suggested Fix Direction

**Bug 1 — require a confirmation strike before permanent marking:**
- Replace the one-shot `unplayableUids.add` in `prefetchNext` with a strike counter (`Map<uid, number>`); only promote a uid into `unplayableUids` after 2 confirmed definitive failures (no-url or hard probe error). A first definitive failure behaves like a probe timeout today: skip this walk, do NOT mark dead, retry on demand. This keeps the "next song is always playable" guarantee (the walk still advances past a once-failing candidate) while killing the false-permanent-skip.
- Optionally clear a uid's strike on a real successful `playing` of that track (already happens for the current track; extend to drop its strike entry).

**Bug 2 — retry play() once on auto-advance before failing over, and stop treating autoplay rejection as a load stall:**
- Capture whether `audio.play()` rejected in `play()`. On a non-fresh advance, if it rejected and the element is still paused with a valid src, attempt a single re-`play()` on the next macrotask (microtask drain often restores activation), before the watchdog escalates.
- Make the stall watchdog distinguish "loaded but paused (readyState ok, autoplay-rejected)" from "genuinely stalled (no bytes)". When the element has buffered/canplay but is paused, do NOT runFallback — just leave it paused (and the user/Media-Session play action resumes it), OR retry play() once. A cross-source swap should only fire on a true no-audio stall.

## Specialist hint

specialist_hint: typescript

## Specialist Review

Reviewer: typescript-expert (TypeScript / Svelte 5 idioms + media-element pitfalls). Verdict: LOOKS_GOOD with refinements.

- Bug 1 strike counter: use a plain `Map<string, number>` field (NOT `$state`/`SvelteSet`) — it is internal loop-guard budget, never read reactively, mirroring the existing `manualUids`/`removedUids`/strike-vs-`unplayableUids` discipline. Only `unplayableUids` (the SvelteSet) needs reactivity for the ✗ row. Clear the strike Map in the same three places `unplayableUids` is cleared (`clearQueue`, `recoverFromStop`, and on `retryUnplayable` for that uid) plus drop the uid's strike on a real `playing` event for the current track so a recovered track resets cleanly. Keep `STRIKE_CAP` a `private static` for tunability (suggest 2). Edge: on the 2nd strike, add to BOTH the strike map (idempotent) and `unplayableUids`.

- Bug 2 retry-once: prefer the existing event-driven seam over a blind `setTimeout` re-play. The cleanest mobile-correct approach: keep the swallowed `.catch`, but on a non-fresh advance record that play() did not start, and have the stall watchdog (or a short dedicated timer) re-invoke `audio.play()` ONCE only when `audio.paused && audio.readyState >= HAVE_CURRENT_DATA` (i.e. bytes are present, so it is an autoplay-policy pause, not a load stall). Gate the cross-source `runFallback` in `armStall` behind `readyState < HAVE_CURRENT_DATA` (or `networkState`/`buffered.length === 0`) so a loaded-but-autoplay-paused track NEVER triggers a pointless source swap. This is the idiomatic distinction (Pitfall: `play` event fires at HAVE_NOTHING and is not proof of audio — rely on `readyState`/`playing`, exactly as the existing CR-01 comment notes).

- Common pitfall to avoid: do not re-`play()` inside the `pause` listener (it would fight a genuine user pause). Drive the single retry only from the watchdog/timer path, generation-guarded by `playGen` like every other deferred action here.

- Test contract: extend `player.svelte.test.ts` rather than rewrite. New cases: (1) a single no-url/probe-error does NOT add to `unplayableUids` (strike 1), a second does (strike 2 → dead); (2) a real `playing` clears the strike; (3) auto-advance play() rejection with `readyState >= 2` retries play() once and does NOT call runFallback; (4) a true no-bytes stall still routes into runFallback. Keep `npm run check` at 0/0.

## Current Focus

- hypothesis: CONFIRMED + FIXED.
- next_action: none — resolved, committed (fec675b), awaiting human verification on device.

## Resolution

root_cause: |
  Bug 1 — prefetchNext marked a uid PERMANENTLY unplayable for the session on the FIRST definitive
  failure signal (no-audioUrl resolve OR a single muted-probe `error`), with no strike count. Because
  both the per-source URL probe and the offscreen probePlayable element are SEPARATE fetches from the
  real <audio> byte fetch (subject to transient timeouts, edge 403s on signed URLs, CORS,
  rate-limiting), a transient failure was misclassified as permanent death; nextPlayableIndex then
  routed past the track on every future advance while a fresh resolve at click-time succeeded.
  Bug 2 — on auto-advance, play() awaits ensureTrackDetails (seconds) BEFORE audio.play(), discarding
  the residual user activation; on mobile play() is rejected by autoplay policy, the rejection is
  swallowed, no `playing` event fires, and the track sits current-but-paused. The sole fallback (the
  15s stall watchdog → runFallback cross-source swap) was both slow and the wrong remedy.

fix: |
  Bug 1 — replaced the one-shot `unplayableUids.add` in prefetchNext with a plain `Map<string,number>`
  strike counter (`unplayableStrikes`, NOT $state — internal loop-guard budget) plus `STRIKE_CAP = 2`.
  New helpers `strikeUnplayable(uid)` (records a strike; promotes into the reactive `unplayableUids`
  SvelteSet only at the cap) and `clearStrike(uid)`. A FIRST definitive failure (no-url OR hard probe
  error) now behaves like a probe timeout: skip this walk, NOT marked dead, retryable on demand. A
  probe timeout still takes NO strike. Strikes cleared on a real `playing` for the current track and in
  lockstep with `unplayableUids` in clearQueue / recoverFromStop / retryUnplayable.
  Bug 2 — capture whether audio.play() rejected in play() (both network + offline-blob paths); on a
  NON-fresh advance with the element still paused, arm `autoplayRetryArmed` and call the new
  `maybeRetryAutoplay(gen)`. That re-invokes audio.play() ONCE only when paused + readyState >=
  HAVE_CURRENT_DATA (=2) + src present, generation-guarded by playGen, one-shot. Driven from a new
  `canplay` listener (and tried immediately after play()), NEVER from the `pause` listener (the `pause`
  + `playing` listeners CLEAR the arm). The stall watchdog `runFallback` is now gated: a paused element
  with readyState >= HAVE_CURRENT_DATA re-plays once instead of a cross-source swap; only a genuine
  no-bytes stall (readyState < 2) routes into runFallback.

verification: |
  Self-verified: `npm run check` 0 errors / 0 warnings (baseline preserved). Player suite 115/115
  (107 prior + 8 new). Full suite 862/862 (854 prior + 8 new). One prior prefetch test that asserted
  the OLD one-shot no-url mark was updated to the new strike contract (a single no-url is now a strike,
  not a permanent mark). New tests: single-failure-not-dead vs two-failures-dead, strike cleared on
  playing/clearQueue/retry, watchdog re-plays loaded-but-paused without runFallback, true no-bytes
  stall still fails over, canplay one-shot retry, pause clears the arm. Awaiting human verification on a
  real mobile device (auto-advance continuous playback + previously-skipped tracks playing on re-click).

files_changed:
  - src/lib/stores/player.svelte.ts: strike counter (unplayableStrikes/STRIKE_CAP/strikeUnplayable/clearStrike) replacing one-shot unplayableUids.add in prefetchNext; autoplayRetryArmed + maybeRetryAutoplay + HAVE_CURRENT_DATA; capture+arm in both play() paths; canplay listener + arm-clear in playing/pause listeners; readyState-gated runFallback in armStall; strike clears in clearQueue/recoverFromStop/retryUnplayable/playing.
  - src/lib/stores/player.svelte.test.ts: +8 tests across two new describe blocks (Bug 1 strike counter, Bug 2 autoplay retry + watchdog gating); one prior no-url test updated to the strike contract; reset unplayableStrikes/autoplayRetryArmed in beforeEach; readyState:0 on makeFakeAudio.
