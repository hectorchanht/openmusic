---
gsd_debug_version: 1.0
slug: playback-stalls-unplayable
status: resolved
trigger: "Playback stops when a track is unplayable — this should never happen. The currently-playing track ends or the next-up track fails to load/play, and playback halts instead of advancing. Expected: next-up resilience should skip unplayable tracks automatically and fall through to the next playable one."
created: 2026-06-15
updated: 2026-06-15
---

# Debug Session: playback-stalls-unplayable

## Symptoms

- **Expected:** When the current track ends (or the next-up track fails to load/resolve/play), playback should automatically advance to the next *playable* track. An unplayable track should be skipped, never halt playback. Ideally next-up should be probed (silent ~1s test play) so a known-good track is always queued; on probe failure, prefetch+probe the track after, chaining until a playable one is found.
- **Actual:** Playback stops/stalls when it hits an unplayable track instead of skipping to the next playable one.
- **Errors:** (none reported yet — capture console/network on a stall repro)
- **Timeline:** Phases 16 (Playback Resilience Core) and 17 (Up-Next Sourcing) shipped 2026-06-10. Resilience was supposed to cover this. Adjacent resolved sessions: `next-end-swipe-prefetch-queue` (grow-in-flight no-op on track-end advance), `search-next-up-wrong-mode` (wrong up-next sourcing). Neither covered unplayable-track skip.
- **Reproduction:** Play through a queue containing a track whose audio URL fails to resolve or fails to play (404 / dead CDN / unsupported). Observe playback halt instead of skip.

## Current Focus

- hypothesis: The Phase-16 reactive skip chain (audio `error` → `runFallback` → `handleTotalFailure` → `next()`) survives, but its proactive companion — `prefetchNext`'s bounded forward-resolve walk that skipped past unplayable up-next entries — was reverted to a single-song lookahead in commit `76b3e6f` (2026-06-14). With no forward walk, an unplayable next-up is no longer skipped *before* it becomes current, and the only remaining skip path is reactive (after the `<audio>` element errors), which has fragile end-of-queue / ping-pong gaps.
- next_action: confirm with stakeholder which fix path to take (restore forward-resolve walk vs. probe-based next-up).
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-15 | type: code-trace | src/lib/stores/player.svelte.ts:1189-1253 — `prefetchNext` is now an explicit SINGLE-SONG lookahead. Line 1221-1222 comment: "resolve ONLY the immediate-next. A reject or a no-audioUrl result is abandoned for this invocation — we never advance to a further candidate." Line 1227 `return` on resolve-reject; line 1233 `if (!resolved.audioUrl) return;`. So an unplayable up-next is NOT pre-skipped; the queue is left with a dead next-up.
- timestamp: 2026-06-15 | type: git-history | `git show 76b3e6f` (feat 260614-1rt) explicitly "drop the bounded forward-resolve walk and remove PREFETCH_MAX_CANDIDATES"; "a rejecting / no-audioUrl immediate-next is abandoned for this invocation ... never walks on." The prior commit `642f4f5` (quick-260613-fhw-01) had hardened prefetchNext INTO that bounded forward-resolve loop. The walk that made next-up resilient was therefore intentionally removed one day after the Phase-16/17 ship.
- timestamp: 2026-06-15 | type: code-trace | reactive skip chain intact but loop-guard disabled: audio `error` handler (player.svelte.ts:926-976) → `runFallback` (1719) → on all-sources-exhausted → `handleTotalFailure` (1801) → `emitSkipNotice` + `this.next()` (1817-1818). The `errorBurst >= FAILURE_CAP` break (962-974) and `consecutiveFailures >= FAILURE_CAP` break (1812-1815) and `tripLoopGuard` (1828-1839) are ALL commented out (commits `157d616`/`eb8a450`/`ef2c751`). Intent: never hard-stop, always skip. That is consistent with the desired behavior, so the commented guard is NOT the bug.
- timestamp: 2026-06-15 | type: code-trace | end-of-queue stall window: `next()` (player.svelte.ts:1647-1661). When current is the last queue entry, the advance is `ensureAhead().then(() => { if (j+1 < length) play(queue[j+1]) })`. If `ensureAhead` cannot grow the queue (sources dry — caught+swallowed at 1141-1142; or an in-flight `growPromise` resolves without adding) the `.then` finds no next track and play() is never called → silent stall. Test player.svelte.test.ts:762-780 asserts this exact no-advance as "correct" for the dry-sources case, so a dead LAST track currently halts by design.
- timestamp: 2026-06-15 | type: code-trace | no silent probe exists anywhere. `preloadNextAudio` (1260-1277) creates a muted `new Audio()` and `.load()`s the next URL to warm the byte cache, but it never listens for `error`/`canplay` and never disqualifies a candidate or feeds the skip chain. There is no ~1s silent test-play probe; "playable" is only ever discovered reactively when the real element errors after the track becomes current.

## Eliminated

- timestamp: 2026-06-15 | Commented-out loop-guard (FAILURE_CAP / tripLoopGuard) is NOT the cause. Disabling it makes the player skip indefinitely rather than stop, which matches the desired never-stop behavior. The stall is the absence of a proactive skip, not a premature stop.
- timestamp: 2026-06-15 | The reactive cross-source fallback (`runFallback` → `handleTotalFailure` → `next()`) is functional for a mid-queue dead track (covered by test at player.svelte.test.ts:814-831). It is not the primary regression; the regression is the lost proactive forward walk plus the end-of-queue advance gap.

## Resolution

- root_cause: Phase-16's proactive next-up resilience relied on `prefetchNext` being a BOUNDED FORWARD-RESOLVE walk that resolved successive queue candidates until one was actually playable (had an `audioUrl`), skipping rejecting / no-audioUrl entries. Commit `76b3e6f` (feat 260614-1rt, 2026-06-14) deliberately reverted it to a SINGLE-SONG lookahead: it now resolves only `queue[indexOf(current)+1]` and abandons the invocation on a reject or a no-audioUrl result, never advancing to a further candidate. Combined with (a) the disabled loop-guard and (b) the end-of-queue `next()` path that silently no-ops when `ensureAhead` cannot grow, an unplayable next-up (or an unplayable last track) is no longer skipped before/at the point it becomes current — the queue keeps a known-dead next-up and playback halts on reaching it. There is also no silent-probe mechanism at all (`preloadNextAudio` warms bytes but never detects un-playability), so "playable" is only discovered reactively after the live element errors.
- fix: Fix-path = "restore walk + keep lazy trigger + close end-of-queue gap + add silent probe" (user-selected). Implemented in `src/lib/stores/player.svelte.ts`:
  1. **Restored the bounded forward-resolve walk** in `prefetchNext` (re-added `PREFETCH_MAX_CANDIDATES = 4`), while KEEPING 76b3e6f's lazy 5s one-shot `timeupdate` trigger (untouched). The walk steps from the immediate-next through up to 4 entries, skipping any that reject (transient — not marked dead), resolve without an `audioUrl` (marked dead), or fail the probe, until one probes playable.
  2. **Added a silent probe** `probePlayable(url)` — a muted offscreen `Audio` that races `canplay`/`loadeddata` against a hard `error` and a `PROBE_TIMEOUT_MS = 1500` deadline. Returns `{ok}` true on canplay, `{ok:false, errored:true}` on error (→ mark dead), `{ok:false, errored:false}` on timeout (transient → skip, don't mark). Degrades to `{ok:true}` where no event-capable Audio exists (SSR / test stubs) so it never false-fails or perturbs asset-warming.
  3. **Proactive skip set** `unplayableUids` (plain Set, session-scoped, mirrors `removedUids`) records probe-confirmed-dead uids. New `nextPlayableIndex(from)` returns the first entry ahead that is NOT known-dead.
  4. **Closed the end-of-queue gap**: `next()` now picks `nextPlayableIndex(i)`; if none, it grows via `ensureAhead` then advances to the first PLAYABLE freshly-added track instead of silently no-oping on a dead/exhausted tail. Reset `unplayableUids` in `recoverFromStop` (manual retry re-arms) and `clearQueue`.
  Deferred (were the non-bug parts of the original /gsd:do ask, out of this bug-scope): the ✗ "skipped" marker in the Up-Next list (noted in the `unplayableUids` doc-comment — swap to a reactive set later) and the history-preserving "click queues into next-up" queue redesign.
- verification: `npx vitest --run` → 840 → 845 passing (62 files); rewrote the 2 tests that encoded the reverted single-song contract; added 5 tests (next() skips known-dead + grows on dead tail; probe canplay/error/timeout). `npm run check` (svelte-check) → 0 errors / 0 warnings. Live browser verification of the dead-URL skip path is not deterministically reproducible in preview (needs an injected failing audio URL) — covered by unit tests instead; the running dev server HMR'd the edits with no compile error.
- files_changed: src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts
