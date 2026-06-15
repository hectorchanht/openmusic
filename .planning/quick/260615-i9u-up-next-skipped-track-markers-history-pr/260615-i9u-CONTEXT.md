# Quick Task 260615-i9u: Up-Next skipped-track markers + history-preserving click-enqueue - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Task Boundary

Two deferred Up-Next/queue features, both building on the EXISTING player queue infra in
`src/lib/stores/player.svelte.ts` (do NOT add a parallel queue system). Ship together (one plan,
planner may split into subtasks/commits).

**Feature A — ✗ skipped-track markers.** The playback-resilience fix (commit `a019f3c`) added a
private plain `Set<string> unplayableUids` (probe/resolve-confirmed-dead track uids) that
`nextPlayableIndex`/`next()` silently route past. Make skipped tracks visible in the Up-Next list.

**Feature B — history-preserving "click enqueues into next-up".** Today a fresh user play
(`opts.fresh` in `play()` → `regenerate()`) does `this.queue = queueWithAnchor([seed, ...manual, ...auto], seed)`,
REPLACING the whole queue and discarding the prior current + all history before it (prev() can't
revisit). New model preserves history and inserts the clicked song after the prior current.
</domain>

<decisions>
## Implementation Decisions

### A. Marker behavior — visible ✗, tap-to-retry
- Keep the skipped row IN the Up-Next list (it already stays in the `queue` array — `nextPlayableIndex`
  just skips it by index). Render it dimmed with a leading ✗ "skipped" affordance.
- The ✗ row is TAPPABLE TO RETRY: tapping clears that uid from `unplayableUids` and attempts to play
  it (`player.play(track, { fresh: false })` — a retry of that exact track, not a fresh regenerate),
  so a transient failure can recover. (A definitively-dead track will just re-skip via the resilience
  chain — acceptable.)
- **Reactive set:** `unplayableUids` must become reactive so the Up-Next list repaints when a track is
  marked/unmarked. Use a `SvelteSet` (from `svelte/reactivity`) or a `$state`-wrapped set. Update the
  existing writers (`prefetchNext` marks dead; `recoverFromStop`/`clearQueue` clear) and the test
  reset in `player.svelte.test.ts` accordingly. Keep it session-only (NOT persisted) — matches today.
- Up-Next row rendering lives in `NowPlaying.svelte` (sheet/up-next rows + any row component). Add the
  ✗/dimmed state + the retry handler there, reading the reactive set.

### B. History-preserving queue — insert after current, capped history
- On a fresh user play (the click), DO NOT wipe history. New queue shape:
  `[...history (bounded), priorCurrent, clickedSong (new current), ...clickedSong's-next-up]`
  i.e. the clicked song inserts immediately AFTER the prior current; the prior current and earlier
  played tracks stay BEFORE it and remain revisitable via `prev()`.
- **History cap:** retain at most the last ~50 played entries before the new current (bound queue
  growth across many clicks). Drop the oldest beyond the cap. (Exact constant = Claude's discretion,
  default 50; expose as a private static for tunability.)
- **Clicked song's next-up tail** = RESPECT the per-context up-next mode via
  `settings.effectiveUpnextMode(context)`: `generated` → similar-to-clicked (the existing
  `buildSimilarQueue` path); `same-list` → the remainder of the list the song was clicked from
  (the existing setListQueue/same-list path). Reuse the existing mode resolution — do not hardcode.
- Must reconcile with `regenerate()`, `ensureAhead()`, `queueWithAnchor()`, `manualUids`,
  `removedUids`, `queueGen` (bump on the explicit re-install so in-flight regenerate/grow discard),
  and `playGen` supersedence. `prev()` already walks the queue array backwards — preserving history
  in the array is what makes it work; verify `prev()` needs no change beyond that.
- Interactions: shuffle pins current + history (only the auto tail shuffles, as today); repeat-one
  unaffected (no advance). The new current must be re-anchored into the queue (like queueWithAnchor)
  so `indexOf(current)` is valid.

### C. Tests
- Keep `player.svelte.test.ts` green; UPDATE the tests that assert the OLD wipe-on-fresh-play contract
  (queue == [seed, ...auto]) to the NEW history-preserving contract, and add coverage for:
  history retained + capped, clicked-song inserted after prior current, prev() revisits prior current,
  per-context tail (generated vs same-list), and the reactive unplayableUids skip+✗+retry.

### Claude's Discretion
- History cap constant (default ~50) and whether duplicates in history are de-duped on re-click of an
  already-played song (suggest: moving a re-clicked song to the new-current position rather than
  duplicating it — planner/executor's call, keep it sane).
- Exact ✗ affordance styling (dim + leading ✗ glyph/icon), consistent with existing Up-Next row CSS.
</decisions>

<specifics>
## Specific Ideas

- Key functions in `src/lib/stores/player.svelte.ts`: `play()` (~1489, opts.fresh), `regenerate()`
  (~1738), `queueWithAnchor()` (~1048), `setQueue/setListQueue` (~1085/~1063 area), `ensureAhead()`,
  `next()`/`nextPlayableIndex()`/`prev()` (~1802), `unplayableUids`/`manualUids`/`removedUids`/
  `queueGen`/`playGen`. `effectiveUpnextMode` lives in `settings.svelte.ts`.
- Up-Next UI: `src/lib/components/NowPlaying.svelte` (sheet panel → up-next rows; queue-row reorder via
  gripDrag, swipeRemove already present on rows — the ✗/retry must not fight those gestures).
- Reactive set import: `import { SvelteSet } from 'svelte/reactivity'`.

## Verification
- `npm run check` 0 errors; full suite green (update the queue-contract tests as noted).
</specifics>

<canonical_refs>
## Canonical References

Lineage: Phase 16 (Playback Resilience — `unplayableUids` added in fix `a019f3c`), Phase 17 (Up-Next
Sourcing — `effectiveUpnextMode`, manualUids/removedUids, regenerate/setListQueue), Phase 20
(Now-Playing surface — the sheet/up-next UI). This task extends those. No external specs.
</canonical_refs>
