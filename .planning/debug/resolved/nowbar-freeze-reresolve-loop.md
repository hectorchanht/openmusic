---
gsd_debug_version: 1.0
slug: nowbar-freeze-reresolve-loop
status: resolved
trigger: "Nowbar stuck showing the loading running-line. Tapping nowbar won't expand, tapping songs won't play, tapping the settings button gives no feedback — app not reactive to any click, page switches take very long or don't show the page clicked. User suspects the prefetch-next-song feature (bg-resolve-gap-stall rounds 1-3, just implemented) broke the app. Action log = a tight loop of audio.error(uid=qq:000ybVWz3FP6fu, hasPlayed:true, reresolve:true) alternating with reresolve.cap(n:3..354+), all inside ~130ms."
created: 2026-07-09
updated: 2026-07-09
---

# Debug: nowbar loading-line stuck, whole app frozen (runaway synchronous reresolve/error storm)

## Symptoms
- Nowbar loading running-line spins forever. Tap nowbar → no expand. Tap song → no play. Tap settings → no feedback. Page switches very slow / don't render. App unresponsive to all clicks.
- Action log: ~350 events in ~128ms (t 1783578936676 → 1783578936804), strictly alternating:
  `audio.error {uid:"qq:000ybVWz3FP6fu", hasPlayed:true, reresolve:true}` ↔ `reresolve.cap {uid:"qq:...", n:N}` with N climbing 3→354+ monotonically, **never resetting**.
- Classic main-thread-pegged signature: a synchronous loop starves the event loop → Svelte can't flush reactive updates → UI frozen.
- User theory: the just-shipped prefetch-next-song / blob-prebuffer work broke it.

## Evidence gathered (orchestrator pre-investigation of own recent code)
File: `src/lib/stores/player.svelte.ts`.

1. **Both runaway backstops are COMMENTED OUT** (the catastrophe amplifier):
   - `errorBurst >= Player.FAILURE_CAP` guard at **1548-1560** is commented. It was the absolute cap for the "URL resolves but `<audio>` 403s" ping-pong — count raw audio errors since last real `playing`, and at the cap trip the loop-guard STOP. Disabled in old commit **`ef2c751` "add gripHandledPointer guard"** (NOT this session's prefetch work — the dead guard predates it).
   - `tripLoopGuard()` itself (~**3036**) is also commented out.
   - Net: `this.errorBurst++` (1547) is now a no-op; every foreground already-played audio.error falls straight through to `runFallback(failed)` with NO ceiling.

2. **reresolveBurst climbs monotonically (never resets)** → confirms `play()` (resets at 2237) and a real `playing` event (resets at 1300-1302) NEVER fire during the storm. So `runFallback → play(swap, fromFallback)` is NOT completing between iterations, and the ~350 errors happen in ~128ms (≈0.37ms each) = SYNCHRONOUS, not network-bound. Something is re-attaching `audio.src` / re-`load()`ing hundreds of times per 100ms without any awaited resolve landing.

3. **Error-handler routing** (1456-1561): `audio.error` → (foreground, hasPlayedSinceSrc) → `reresolveBurst++`; at ==1 `reresolveCurrent()` (re-attaches fresh same-song src, 463-512), at >1 log `reresolve.cap` + fall through → `errorBurst++` (dead) → `void runFallback(failed)` (2926). `runFallback` has a per-gen re-entrancy guard (`fallbackGen===gen`) and a per-episode `fallbackAttempted` set; `play(fromFallback)` deliberately does NOT bump playGen.

## Leading hypothesis
The catastrophe = the two commented-out caps (FAILURE_CAP + tripLoopGuard) removed the ONLY ceiling on the resolve-but-unplayable storm, so a fast-re-erroring foreground track (`qq:000ybVWz3FP6fu`) loops unbounded and pegs the main thread → whole app frozen.

The NEW trigger (why now, after prefetch) is still UNCONFIRMED — candidates:
- (a) blob prebuffer sets `audio.src = blob:` for a track that errors instantly (revoked/invalid objectURL), producing a fast synchronous error the old (slower, network) path never produced;
- (b) a reactive `$effect` loop: the error handler mutates `this.current` (reresolveCurrent:479) / `this.playing`=false / `this.loading`, and some `$effect` watching those re-drives `audio.src`/`load()` synchronously → state→effect→src→error→handler→state…;
- (c) `prewarmNextAssets`/`prebufferNext` re-armed on every error.

## Open questions for the session
1. Trace the EXACT synchronous re-attacher (need the FULL unfiltered action log around the storm start — what event precedes the first `audio.error n:3`? a `play`? `fallback`? `prebuffer`? `grow`?).
2. WHY were FAILURE_CAP + tripLoopGuard commented out (commit `ef2c751`)? A blind re-enable may regress whatever false-positive STOP motivated disabling them. Check that commit + any linked debug session before restoring.
3. Confirm/deny prefetch/blob as the new fast re-trigger (bisect: does reverting `prebufferNext` consumption in `play()` stop the storm? does it reproduce without the blob path?).

## Verification constraint
The frozen-UI storm should be reproducible in dev (foreground, not the device-only bg freeze) by playing a region-locked / fast-403 track (netease/qq) that resolves-then-errors. Preview + console + action log usable here.

## Evidence (this session — empirical, deterministic repro against HEAD)

- Ran a repro test (real `play()`, fake `<audio>` whose src-setter fires `error` on the next
  microtask, `ensureTrackDetails`/`tryFallback` mocked to resolve instantly):
  1. **hasPlayed → runFallback fall-through path self-limits at `errorBurst=2` in HEAD.** The WR-01
     re-entrancy guard (`if (this.fallbackGen === gen) return`) blocks the nested `runFallback` while
     the outer one is still awaiting `play(swap)` (the swap's error microtask fires BEFORE the outer
     runFallback's `finally` releases `fallbackGen`). So the reported `reresolve.cap n:3..354` climbing
     signature is NOT reproducible against HEAD — it is from a PRIOR build (the deployed APK; the
     `reresolveBurst` cap was 3 before the midplay-stall fix set it to 1). reserveBurst cannot climb
     to 354 on HEAD because every fall-through swap either resets it (play()) or is guard-blocked.
  2. **SEEK-ERROR branch storms UNBOUNDED on HEAD.** With `lastSeekAt` recent, one `error` →
     `reresolveCurrent()` → re-attach src → error (still inside the 1.5s window) → `reresolveCurrent()`
     → … repro hit 2001 synchronous src-sets (my fake's 2000-fire safety cap). This branch
     (player.svelte.ts:1473-1477) has NO cap, NO counter, and does NOT go through `runFallback` (so no
     re-entrancy guard) or `play()` (so no `reresolveBurst`/`errorBurst`/`hasPlayedSinceSrc` reset).
     THIS is the genuinely-uncapped synchronous re-attacher present in HEAD.

- Candidate ruling (all three orchestrator candidates):
  - (a) blob-prebuffer: consumed only inside `play()` (line 2442), which resets counters + changes uid
    — cannot be the same-uid, no-reset storm. RULED OUT as the re-attacher (still hardened by the cap).
  - (b) reactive `$effect` loop: grep shows NO `$effect` drives `audio.src`; the 4 src writes are all
    imperative (444 restore, 499 reresolveCurrent, 2337 offline-blob play, 2467 network play). RULED OUT.
  - (c) prewarm/prebuffer/probe: use SEPARATE offscreen `Audio` elements, never touch `this.audio`. RULED OUT.

- ef2c751 read: it commented out the `errorBurst >= FAILURE_CAP` guard whose action was
  `tripLoopGuard()` — a hard STOP (pause + clearMedia + sticky `toast.playbackStopped` Retry notice).
  That STOP was the false-positive (stranded the player on transient CDN blips / region-lock churn —
  see midplay-stall-background root cause C, reresolve-loop-stops-playback). So the restored ceiling
  must SKIP, never STOP.

## Resolution

- root_cause: >
    Two compounding defects in the audio `error` listener (src/lib/stores/player.svelte.ts):
    (1) THE SYNCHRONOUS RE-TRIGGER — the seek-error branch (`if (sinceSeek < SEEK_ERROR_WINDOW_MS) {
    void this.reresolveCurrent(); return; }`) re-attaches `audio.src` on EVERY error within the 1.5s
    seek window with no cap/counter/guard; a stale-URL track that re-errors instantly loops
    `reresolveCurrent` synchronously (repro: 2000+ src-sets), pegging the main thread → the whole
    SvelteKit app freezes (nowbar stuck, no taps register). (2) NO ABSOLUTE CEILING — the
    `errorBurst >= FAILURE_CAP` guard AND `tripLoopGuard()` are both commented out (ef2c751), so
    `errorBurst++` is a dead no-op and the only thing bounding ANY error→recovery loop is the WR-01
    re-entrancy guard's incidental async timing (which does not cover the seek path at all).
- fix: >
    src/lib/stores/player.svelte.ts — a single explicit ceiling at the TOP of the audio `error`
    listener (checked before the seek / hasPlayed / fallback branches), so EVERY error path is bounded:
    - Added statics RAPID_ERROR_WINDOW_MS=400, RAPID_ERROR_CAP=3; fields lastAudioErrorAt, rapidErrorBurst.
    - (a) RAPID-FIRE BRAKE (stops the synchronous re-trigger at its source): errors firing <400ms apart
      with no intervening `playing` cannot be distinct network failures — they are a synchronous
      re-attach storm. At RAPID_ERROR_CAP consecutive rapid errors the handler STOPS re-driving recovery
      and skips. Refusing the synchronous re-attach is what actually kills the CPU peg (a cap alone would
      still spin synchronously up to it).
    - (b) ABSOLUTE CEILING (false-positive-safe): errorBurst >= FAILURE_CAP (5) raw errors since the last
      `playing`, regardless of spacing (the slow resolve-but-unplayable ping-pong across 3+ sources the
      per-episode `attempted` set cannot bound). Restored — was commented out in ef2c751.
    - BOTH bounds SKIP: strikeUnplayable(current) + next() (next() bumps playGen via play(), superseding
      the dead track's in-flight fallback/reresolve so it cannot re-enter). They do NOT call the
      ef2c751-disabled tripLoopGuard() STOP — no pause, no this.error='toast.playbackStopped', no sticky
      loop-guard Retry notice. That STOP was the false-positive that stranded the player on a transient
      CDN blip / region-lock churn (midplay-stall-background C, reresolve-loop-stops-playback). A genuine
      give-up still surfaces only via the offline / no-url paths.
    - errorBurst is now counted ONCE at the top for all paths; removed the dead trailing `errorBurst++` +
      the commented FAILURE_CAP/tripLoopGuard block. Counters reset on `playing`, play() entry, and
      recoverFromStop (errorBurst deliberately NOT reset on play() per CR-01 so a RUN of dead tracks still
      trips the absolute cap).
    - tripLoopGuard()/recoverFromStop STOP machinery left commented/present but unused by the error path —
      not reintroduced (avoids the false STOP).
- verification: >
    - Deterministic repro (temp test, since deleted): the seek-error reresolveCurrent loop produced 2001
      synchronous src-sets on HEAD; AFTER the fix it terminates at ~4 (bounded <12). The hasPlayed→
      runFallback path was already guard-bounded at errorBurst=2 (WR-01), so no regression there.
    - 3 permanent regression tests added to player.svelte.test.ts ("synchronous audio.error storm is
      bounded"): (1) real reresolveCurrent + self-erroring fake <audio> → src-sets bounded <12; (2) the
      ceiling SKIPS (strikeUnplayable called) and does NOT set this.error='toast.playbackStopped' or a
      'stopped' notice; (3) a real `playing` between errors refunds the brake so a genuine transient stall
      re-resolves in place every time and is never falsely skipped.
    - Also added the missing session-scoped counter resets (errorBurst/reresolveBurst/rapidErrorBurst/
      lastAudioErrorAt) to the test-file beforeEach so a ceiling read can't be tripped by a leaked burst.
    - pnpm check: 0 errors, 0 warnings. pnpm test: 1071/1071 pass (69 files). Player suite 172/172.
    - NOT browser-verified in dev: the freeze requires a track that resolves-then-errors (region-locked
      CDN 403), which is environmental and not reliably forceable in the dev preview — the deterministic
      test against the real Player class is stronger + repeatable. Device/foreground user confirmation
      pending.
- files_changed: [src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts]

## Current Focus

reasoning_checkpoint:
  hypothesis: "The app freeze is a synchronous audio.error storm. The genuinely-uncapped re-trigger in HEAD is the seek-error branch that calls reresolveCurrent() on every error within the 1.5s SEEK_ERROR_WINDOW with no cap/counter/guard; a re-attached stale src that errors again inside the window loops synchronously and pegs the main thread. Both absolute ceilings (errorBurst>=FAILURE_CAP, tripLoopGuard) are commented out, so nothing bounds it."
  confirming_evidence:
    - "Deterministic repro: seek-window error → reresolveCurrent loop produced 2001 synchronous src-sets (hit the fake's 2000-fire safety cap) with real play() untouched."
    - "grep: the only audio.src writers are imperative (restore/reresolveCurrent/play x2); no $effect drives src → the re-trigger is code, not reactivity."
    - "The hasPlayed→runFallback path self-limits at errorBurst=2 in the same harness (WR-01 guard), proving the uncapped path is the seek/reresolveCurrent one, not the fallback ping-pong."
    - "Lines 1548-1560 (errorBurst>=FAILURE_CAP) and 3036-3047 (tripLoopGuard) are commented out; errorBurst++ at 1547 is a no-op."
  falsification_test: "If the seek branch were bounded, the repro would stop at a small N; it hit 2001. If a cap already existed, errorBurst++ would gate the loop; it does not. If the fix is wrong, adding the rapid-brake+ceiling would NOT drop the repro to a small bounded count — it must."
  fix_rationale: "Two-part per requirement: (a) SOURCE — a rapid-fire brake at the top of the error handler refuses to synchronously re-drive recovery when errors fire < RAPID_ERROR_WINDOW_MS apart with no intervening `playing` (they cannot be distinct network failures) and skips at RAPID_ERROR_CAP; this stops the CPU peg at its source, which a cap alone cannot (it would still spin synchronously to the cap). (b) CEILING — restore the absolute errorBurst>=FAILURE_CAP ceiling but as a SKIP (strike current + next()), NOT the ef2c751 tripLoopGuard STOP, so no future fast-re-error can peg the thread and the false-positive `playback stopped` STOP never returns."
  blind_spots: "The user's captured reserve.cap-354 log is from a prior build, not HEAD (HEAD's fall-through is guard-bounded) — so I am fixing the equivalent uncapped path present in HEAD (seek/reresolveCurrent) plus restoring the absolute ceiling, rather than the exact historical trigger. Device-only bg specifics are out of scope; the freeze itself is foreground-reproducible and now covered by a deterministic test."

next_action: RESOLVED — user accepted the deterministic repro (2001 → ~4 synchronous src-sets) plus green gates (pnpm check 0/0, pnpm test 1071/1071) in lieu of a live region-locked device test. Fix committed as c902264 (src/lib/stores/player.svelte.ts + player.svelte.test.ts). Session archived to .planning/debug/resolved/.
