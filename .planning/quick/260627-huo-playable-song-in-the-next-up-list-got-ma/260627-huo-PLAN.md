---
phase: quick-260627-huo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
autonomous: true
requirements: [HUO-RETRY, HUO-PREFETCH, HUO-NONSTOP]
must_haves:
  truths:
    - "A genuinely-playable next-up song hit by a transient resolve/probe blip recovers automatically without the user tapping Retry"
    - "A definitive next-up failure schedules a delayed fresh re-resolve before the uid is ever promoted to permanently-dead (unplayableUids)"
    - "Delayed retries are bounded (capped attempt count + backoff) and respect the existing abort/dedupe guards — no unbounded retry loop and no resolve-burst"
    - "The single immediate-next song is reliably pre-resolved + probe-verified before the current track ends, including for short tracks / fast skips that never crossed the 5s prefetch gate"
    - "track-ended → next() always lands on a playable track using the prefetched result, with no dead-air gap and no spurious stop"
  artifacts:
    - path: "src/lib/stores/player.svelte.ts"
      provides: "Delayed re-resolve scheduler for transient next-up failures + an immediate (ungated) prefetch trigger on play() entry"
      contains: "scheduleRetryResolve"
    - path: "src/lib/stores/player.svelte.test.ts"
      provides: "Fake-timer unit tests for delayed-retry recovery, retry bounding, and the eager immediate-next prefetch"
      contains: "delayed re-resolve"
  key_links:
    - from: "strikeUnplayable / prefetchNext definitive-failure branch"
      to: "scheduleRetryResolve"
      via: "before promoting a uid to unplayableUids, arm a delayed fresh re-resolve"
      pattern: "scheduleRetryResolve"
    - from: "play() entry"
      to: "prefetchNext"
      via: "eager one-shot prefetch of the immediate-next, independent of the 5s timeupdate gate"
      pattern: "prefetchNext"
---

<objective>
Fix the user-reported bug: a genuinely-playable song in the Next-up list gets marked non-playable (promoted into `unplayableUids`) because two quick transient upstream blips reach `STRIKE_CAP`. Replace "strike → promote to dead" with "strike → schedule a delayed fresh re-resolve → only promote to dead after delayed retries are exhausted". Also make the immediate-next song prefetch fire eagerly (not only after the ~5s `timeupdate` gate) so short tracks / fast skips still have the next song pre-resolved for gapless, non-stop advance.

Purpose: A real song must never be permanently sidelined this session by a transient proxy/probe hiccup, and playback must keep advancing end-to-end with the next song ready.
Output: Extended `player.svelte.ts` (delayed-retry scheduler + eager prefetch trigger) and new fake-timer unit tests in `player.svelte.test.ts`.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<orientation>
CLAUDE.md is STALE — ignore its `index.html` description. The LIVE app is SvelteKit under `src/`. ALL player logic is the single `Player` class in `src/lib/stores/player.svelte.ts` (~2511 lines). Tests are `src/lib/stores/player.svelte.test.ts` (~3110 lines). This area is real-device-sensitive; many behaviors are device-only human UAT, so the new logic MUST be fake-timer unit-testable.
</orientation>

<existing_primitives>
Reuse — do NOT duplicate — these existing pieces (line numbers approximate, verify by reading):

- `prefetchNext()` (~1462) — bounded forward-resolve-and-probe walk over up to `PREFETCH_MAX_CANDIDATES` (4) entries starting at `indexOf(current)+1`. Dedupe via `prefetchingUid`; supersede/abort via `prefetchController` (single shared AbortController, `sig`); stale-guard `seedUid` re-checked after every await. On a definitive failure it calls `strikeUnplayable(cand.uid)`; on a transient reject / probe timeout it just `continue`s. Best-effort: never throws, never bumps `playGen`, never calls `next()`/`runFallback`.
- `prefetchArmedForSrc` (~162) — reset to `false` in play() on each new src; flipped `true` the first time the `timeupdate` gate fires `prefetchNext()` for that src. The gate (in the `timeupdate` listener, ~1043) fires only AFTER `currentTime >= PREFETCH_PLAYBACK_DELAY_MS/1000` (5s). THIS is why short tracks / fast skips never prefetch in time.
- `strikeUnplayable(uid): boolean` (~699) — increments `unplayableStrikes` Map; at `STRIKE_CAP` (2) promotes uid into the reactive `unplayableUids` SvelteSet and returns true. THIS is the over-promotion the user hit.
- `clearStrike(uid)` (~712), `unplayableStrikes` Map (~686), `STRIKE_CAP` (~689).
- `unplayableUids` SvelteSet (~668) — reactive dead set; `nextPlayableIndex()` (~2131) routes past it; component dims a ✗ row via `isUnplayable()` (~2144); cleared in `clearQueue` (~1365) + `recoverFromStop` (~2382), per-uid via `retryUnplayable()` (~2156).
- `probePlayable(url)` (~1559) — muted offscreen Audio probe; `{ok}` on canplay/loadeddata, `{ok:false,errored:true}` on hard error, `{ok:false,errored:false}` on `PROBE_TIMEOUT_MS` (1500ms) timeout. Timeout does NOT strike.
- `next()` (~2162) / `ended` listener (~1116) → `nextPlayableIndex()` → `play()` → (after src set) re-arms `prefetchArmedForSrc=false`.
- `indexOf(current)`, `ensureTrackDetails(track, sig)` (mocked in tests), `prewarmNextAssets`, `preloadNextCover`.

Test scaffolding already present (reuse verbatim):
- `internals` cast block (~225-257) resets `prefetchingUid`, `prefetchController`, `unplayableUids`, `unplayableStrikes`, `autoplayRetryArmed` in `beforeEach`. ADD any new timer/state field here so it cannot leak across tests.
- `stub(source,id,artist,title)` / `mk(...)`, `mockEnsure = vi.mocked(ensureTrackDetails)`, `flush = () => new Promise(r => setTimeout(r,0))`, `deferred<T>()`.
- Fake-timer pattern: `vi.useFakeTimers()` / `vi.advanceTimersByTime(ms)` / `vi.useRealTimers()` (see the `probePlayable` timeout test ~948).
- `prefetch = () => (player as unknown as {...})['prefetchNext']()` bracket-access driver (~384).
- The `Audio` ctor is stubbed; `probePlayable` degrades to `{ok:true}` when `Audio.prototype.addEventListener` is absent — so in node the probe always reports playable unless a test installs an event-capable stub (see the `probePlayable` suite ~894).
</existing_primitives>

<hard_constraints>
From project memory — violate these and mobile breaks:
- Do NOT gate UI swap or playback start on the audio `playing` event. Drive state from `play()` entry + `loadeddata`/`canplay`/`timeupdate`. (A prior "displayed-defer" change waited on `playing` and froze iOS — reverted.)
- iOS Safari background-audio: keep changes resilient to backgrounding/tab-refocus. Delayed-retry timers must not assume foreground; they are best-effort recovery, never the sole path.
- Do NOT just bump `STRIKE_CAP` — the user explicitly asked for a TIME-DELAYED re-resolve path.
- Bound everything: cap delayed-retry attempts per uid, back off, and respect `prefetchController`/abort + existing dedupe guards so endless playback never fires an unbounded resolve burst that reads as bot traffic.
</hard_constraints>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add bounded, backed-off delayed re-resolve before promoting a next-up uid to dead</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    - A first definitive failure (no-url resolve OR hard probe `error`) on a next-up candidate arms a DELAYED fresh re-resolve for that uid instead of marching straight toward permanent death. The candidate is NOT in `unplayableUids` immediately after the first failure (current behavior already holds at STRIKE_CAP=2 — preserve it).
    - After the delay elapses, the scheduler clears that uid's strike and re-runs the prefetch walk so the candidate gets a FRESH upstream re-resolve + re-probe. A genuinely-playable track recovers: it resolves with an audioUrl, probes ok, lands in its queue slot, and is NOT in `unplayableUids`.
    - A candidate that stays definitively dead across all delayed attempts is eventually promoted into `unplayableUids` (so `nextPlayableIndex()` still routes past a truly dead track and the ✗ row still renders) — recovery must not become an infinite skip-stall.
    - Delayed retries are BOUNDED: at most a small cap of scheduled attempts per uid, with backoff between attempts; a superseding prefetch / current-track change / `clearQueue` / `recoverFromStop` / explicit `retryUnplayable` cancels any pending delayed retry for affected uids (no orphan timers, no leak across tracks).
    - A probe TIMEOUT continues to NOT strike and NOT schedule (it is already transient-skip-this-round). Only definitive failures arm the delayed path.
  </behavior>
  <action>
    In `src/lib/stores/player.svelte.ts`:

    1. Add private static tunables near `STRIKE_CAP` (~689): `RETRY_RESOLVE_MAX` (e.g. 2 — max delayed re-resolve attempts per uid before giving up) and `RETRY_RESOLVE_DELAY_MS` (e.g. 4000 — "a few seconds later" per the user; back off on later attempts, e.g. `RETRY_RESOLVE_DELAY_MS * (attempt+1)`).

    2. Add private session state alongside `unplayableStrikes` (~686): `retryResolveTimers = new Map<string, ReturnType<typeof setTimeout>>()` (pending timer per uid, for cancellation) and `retryResolveAttempts = new Map<string, number>()` (delayed-attempt budget per uid).

    3. Add a private `scheduleRetryResolve(uid: string): void`. It: returns early if a timer is already pending for that uid (dedupe) OR if `retryResolveAttempts.get(uid) >= RETRY_RESOLVE_MAX` (budget exhausted — caller will promote to dead). Otherwise bumps the attempt count, computes a backed-off delay, and `setTimeout`s a callback that: deletes its own entry from `retryResolveTimers`, clears the uid's strike via `clearStrike(uid)` (so the fresh attempt starts clean), then fires `void this.prefetchNext()` ONLY if the uid is still ahead of `indexOf(current)` in the queue and is NOT already in `unplayableUids` (best-effort; if the track was passed/removed, drop silently). The timer callback must be self-guarded: re-read `this.current`/queue at fire time, never close over a stale index.

    4. Add a private `cancelRetryResolve(uid: string): void` that `clearTimeout`s + deletes the uid's pending timer; and a `cancelAllRetryResolves(): void` that clears every pending timer and empties both maps. Call `cancelAllRetryResolves()` wherever `unplayableStrikes.clear()` is already called: `clearQueue` (~1365/1366) and `recoverFromStop` (~2382/2383). Call `cancelRetryResolve(track.uid)` inside `retryUnplayable()` (~2156) right next to `clearStrike(track.uid)` (a manual retry supersedes any pending delayed retry).

    5. Rework the promote-to-dead decision in `prefetchNext()`'s two definitive-failure branches (no-url ~1506-1512 and hard probe error ~1517-1524). Replace the bare `this.strikeUnplayable(cand.uid)` calls with logic that: calls `strikeUnplayable(cand.uid)` (keep the strike accounting); if it returned `true` (reached STRIKE_CAP) AND the uid still has delayed-retry budget left (`retryResolveAttempts.get(uid) ?? 0) < RETRY_RESOLVE_MAX`), then UNDO the premature promotion (`this.unplayableUids.delete(cand.uid)`) and `scheduleRetryResolve(cand.uid)` instead — i.e. a few seconds later we try a fresh re-resolve before giving up. If `strikeUnplayable` returned `true` AND no budget remains, leave it promoted (genuinely dead). The probe-timeout branch is UNCHANGED (still `continue` with no strike, no schedule). Preserve all existing `sig.aborted` / `seedUid` stale-guards and the `continue`/walk-advance behavior.

    6. Drop `cancelRetryResolve(this.current.uid)` (or clear attempts for the current uid) at the existing real-`playing` recovery point where `clearStrike(this.current.uid)` is called (~998) — a track that actually started playing has recovered, so cancel any stale pending retry and reset its budget.

    Keep `scheduleRetryResolve` best-effort: it never throws, never bumps `playGen`, never calls `next()`/`runFallback`. It only re-arms the existing `prefetchNext()` walk — reusing all of prefetch's abort/dedupe/probe machinery rather than duplicating any resolve logic. Do NOT raise `STRIKE_CAP`.

    In `src/lib/stores/player.svelte.test.ts`:
    Add the new fields to the `internals` reset block (~225-257) — at minimum reset `retryResolveTimers` (clear each timer then the map) and `retryResolveAttempts` — and add a `describe('player delayed re-resolve — transient next-up failure recovers without permanent skip', ...)` suite (place near the existing prefetch unplayable suite ~620). Use `vi.useFakeTimers()`. Cases:
    - "a no-url definitive failure schedules a delayed re-resolve instead of immediately marking dead; after the delay a fresh resolve returns a url + the candidate is NOT in unplayableUids": queue [cur, bad, good]; `mockEnsure` returns `{...bad, detailsLoaded:true, audioUrl:null}` on the FIRST call(s) for `bad` then `{...bad, detailsLoaded:true, audioUrl:'https://cdn/bad-now.mp3'}` after; run prefetch (drives bad to its definitive-failure path twice → strike → schedule, NOT dead); assert `unplayable().has(bad.uid)===false` and a timer is pending; `vi.advanceTimersByTime(RETRY_RESOLVE_DELAY_MS_backoff)`; `await flush()`; assert the delayed `prefetchNext` ran, bad now resolved (`player.queue[1].audioUrl==='https://cdn/bad-now.mp3'` after it lands, or at minimum `unplayable().has(bad.uid)===false` and a fresh `mockEnsure` call for bad occurred).
    - "a candidate that stays dead across all RETRY_RESOLVE_MAX delayed attempts is eventually promoted into unplayableUids": `mockEnsure` always returns no-url for `bad`; drive prefetch + advance fake timers through all retry rounds; assert `unplayable().has(bad.uid)===true` at the end and that no further timer remains pending (bounded — `retryResolveAttempts.get(bad.uid) === RETRY_RESOLVE_MAX`).
    - "clearQueue / recoverFromStop cancels pending delayed-retry timers (no leak)": arm a pending retry, call `player.clearQueue()` (or recoverFromStop via its public seam), assert no pending timers remain and `retryResolveAttempts` is empty.
    - "retryUnplayable cancels a pending delayed retry for that uid": arm a pending retry for `bad`, call `player.retryUnplayable(bad)`, assert that uid's timer is cancelled.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -25</automated>
  </verify>
  <done>New delayed-retry suite passes; existing strike/prefetch/unplayable suites still green; a no-url/probe-error candidate is no longer promoted to dead until delayed re-resolves are exhausted; all delayed-retry timers are cancellable + reset between tests.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Prefetch the immediate-next eagerly so short tracks / fast skips stay gapless and non-stop</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    - The single immediate-next song is pre-resolved + probe-verified shortly AFTER a track starts loading, NOT only after ~5s of real playback. A track shorter than the 5s gate (or a fast user skip) still has its next song ready before it ends.
    - The eager trigger is one-shot per loaded src (reuses `prefetchArmedForSrc`) and is fully deduped with the existing timeupdate-gated trigger — a track that DOES cross 5s does not run a second redundant walk.
    - The eager prefetch remains best-effort: never blocks `play()`, never throws, never bumps `playGen`, and is superseded/aborted by `prefetchController` exactly like today. The non-stop chain (ended → next() → nextPlayableIndex → play) is unchanged; this only ensures the prefetched result is ready in time.
  </behavior>
  <action>
    In `src/lib/stores/player.svelte.ts`:

    1. In `play()`, at BOTH src-set points where `this.prefetchArmedForSrc = false` is currently set after the new src is attached (~1812 and ~1912), add an eager one-shot prefetch kick AFTER the audio src is set: set `this.prefetchArmedForSrc = true` and fire `void this.prefetchNext()` (fire-and-forget, generation-guarded by prefetch's own seedUid/abort — do NOT await). This guarantees the immediate-next begins resolving as soon as the current track loads, independent of the 5s `timeupdate` gate. Because `prefetchArmedForSrc` is now already `true`, the timeupdate gate (~1043) will NOT fire a duplicate walk for the same src — the existing `!this.prefetchArmedForSrc` condition already dedupes this.

       IMPORTANT: do NOT gate this on the `playing` event (memory: that froze iOS). Fire it on the `play()` src-set path. Keep it AFTER the src assignment so `prefetchNext`'s `indexOf(current)` sees the correct current track.

    2. Verify `prefetchNext()` already covers exactly the immediate-next (`firstIndex = indexOf(current)+1`) — it does; no change needed beyond confirming the eager trigger reaches it. Do NOT change `PREFETCH_PLAYBACK_DELAY_MS` or remove the timeupdate gate (it is the backstop for long tracks / re-arm after the eager run, and keeping it preserves existing tests). The change is purely: arm eagerly at src-set so the gate becomes a no-op-when-already-armed backstop rather than the sole trigger.

    Reconcile with the existing timeupdate-gate test "does NOT prefetch before ~5s of playback; arms once at the threshold" (~714): that test currently asserts no prefetch before 5s. With eager-on-play(), `play()` itself now arms+fires. Adjust that test so it drives the timeupdate gate in ISOLATION (e.g. set `prefetchArmedForSrc=false` and current/src directly WITHOUT going through `play()`, as it already manipulates `prefetchArmedForSrc` at ~724) — keep its assertion about the GATE'S behavior (no fire below 5s, one fire at the threshold, no re-fire) intact for the timeupdate path. Do NOT delete that test; it still guards the backstop gate.

    In `src/lib/stores/player.svelte.test.ts`:
    Add a `describe('player eager prefetch — immediate-next ready before short tracks / fast skips end', ...)` suite. Cases:
    - "play() eagerly prefetches the immediate-next without waiting for the 5s timeupdate gate": queue [cur, next]; `mockEnsure` resolves `next` with an audioUrl; call `player.play(cur)` (or the appropriate fresh-play seam used elsewhere in the test file); `await flush()`; assert `mockEnsure` was called for `next` (the eager walk ran) BEFORE any `timeupdate`/currentTime advance, and `prefetchArmedForSrc===true`.
    - "the timeupdate gate does NOT fire a SECOND walk for the same src after the eager prefetch already armed it": after the eager play() above, drive `el.currentTime` past 5s and dispatch `timeupdate`; assert `mockEnsure` call count for `next` did not increase (dedupe via prefetchArmedForSrc holds).
    Keep all existing prefetch tests green (adjust only the one timeupdate-gate test per the action above so it exercises the gate without play()).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/stores/player.svelte.test.ts 2>&1 | tail -25</automated>
  </verify>
  <done>play() eagerly fires a one-shot prefetch of the immediate-next at src-set (not gated on 5s or on `playing`); the timeupdate gate no longer double-fires for the same src; the immediate-next is pre-resolved + probe-verified in time for short tracks/fast skips; all prefetch + eager suites green.</done>
</task>

<task type="auto">
  <name>Task 3: Full suite + type check, and flag device-only verification</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <action>
    Run the FULL test suite and the type checker to confirm no regression across the player engine and the rest of the app (this is a hot, widely-depended-on file):
    - `pnpm vitest run` (entire suite)
    - `pnpm check` (svelte-check / tsc)
    Fix any fallout from Tasks 1-2 (e.g. a sibling test that asserted old strike-immediately-dead timing, or a prefetch-call-count assertion now affected by the eager trigger). Do NOT weaken assertions to pass — adjust them to the new, correct behavior and document why in the test comment.

    Then record, in the SUMMARY, the iOS/device-only behaviors that CANNOT be unit-verified and need human UAT on a real device:
    - A real song that was intermittently failing in Next-up now recovers and plays after a few seconds without tapping Retry (the original complaint), on iOS Safari + Android Chrome.
    - Gapless / no-dead-air advance between a short track and its (eagerly prefetched) next song.
    - Non-stop playback across many consecutive tracks with the screen locked / app backgrounded (delayed-retry timers + eager prefetch must survive backgrounding/tab-refocus; if a timer is throttled while backgrounded, the reactive never-stop chain still backstops).
    - Confirm no regression of the previously-fixed "plays ~3s then auto-advances" and "displayed-defer froze playback" bugs.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run 2>&1 | tail -15 && pnpm check 2>&1 | tail -15</automated>
  </verify>
  <done>Full vitest suite green; `pnpm check` reports 0 errors; device-only UAT items explicitly listed in the SUMMARY as human-verify-required.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → upstream proxy (`ensureTrackDetails`) | Untrusted/flaky upstream: returns no-url or transient 5xx/CORS that the retry path re-attempts |
| client → CDN audio bytes (`probePlayable` + `<audio>`) | Untrusted: signed-URL expiry / region-lock / codec quirk drive probe `error` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-huo-01 | Denial of Service (self-inflicted resolve-burst that reads as bot traffic) | `scheduleRetryResolve` delayed re-resolve | mitigate | Bound per-uid attempts via `RETRY_RESOLVE_MAX`; backoff between attempts; dedupe pending timer per uid; reuse `prefetchController` abort + `prefetchingUid` dedupe — no unbounded loop |
| T-huo-02 | Tampering (orphan timers firing against a stale/changed track) | delayed-retry timer callbacks | mitigate | Self-guarded callbacks re-read `current`/queue at fire time (never closed-over index); `cancelRetryResolve`/`cancelAllRetryResolves` on clearQueue/recoverFromStop/retryUnplayable/real-playing |
| T-huo-03 | Denial of Service (eager prefetch double-firing per src) | eager `prefetchNext` on play() entry | mitigate | One-shot via `prefetchArmedForSrc` set true at src-set; existing `!prefetchArmedForSrc` timeupdate gate becomes a no-op backstop — single walk per src |
| T-huo-NS | (no new packages) | npm installs | accept | No new dependencies added — pure logic change in an existing file |
</threat_model>

<verification>
- `pnpm vitest run src/lib/stores/player.svelte.test.ts` — all player suites green (existing + new delayed-retry + new eager-prefetch).
- `pnpm vitest run` — full suite green (no cross-file regression from the hot player file).
- `pnpm check` — 0 type errors.
- Manual code audit: no `STRIKE_CAP` bump; every `setTimeout` armed by `scheduleRetryResolve` has a matching cancel path; no new dependency on the `playing` event; delayed-retry + eager prefetch never bump `playGen` / call `next()` / `runFallback`.
</verification>

<success_criteria>
- A no-url / probe-`error` next-up candidate is NOT promoted to `unplayableUids` until `RETRY_RESOLVE_MAX` delayed fresh re-resolves are exhausted; a genuinely-playable track recovers automatically after the delay (unit-proven with fake timers).
- The immediate-next song is pre-resolved + probe-verified eagerly at play() src-set, so short tracks / fast skips advance gaplessly; no duplicate walk per src.
- track-ended → next() → play() continues to land on a playable track with the prefetched result; no spurious stop, no dead air.
- Delayed retries are bounded + backed-off + fully cancellable; no timer leak across tracks or tests.
- All automated tests + type check pass; device-only behaviors flagged for human UAT.
</success_criteria>

<output>
Create `.planning/quick/260627-huo-playable-song-in-the-next-up-list-got-ma/260627-huo-SUMMARY.md` when done.
</output>
