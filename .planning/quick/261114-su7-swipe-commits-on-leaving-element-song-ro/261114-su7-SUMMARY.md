---
quick_id: 261114-su7
status: complete
---
# Quick 261114-su7 Summary

**Root causes**
- Row swipes (`swipeAction`) fired their action only when the underdamped spring settled (up to ~1s),
  so the haptic/toast lagged, and a row unmounted / spring cancelled before settling dropped it.
- Every swipe treated `pointercancel` / lost capture as "cancel, never commit" (quick-261102-u05).
  Android ends a fast, slightly diagonal flick in `pointercancel` (scroll takeover), so quick swipes
  were dropped while slow ones worked.
- `coverSwipe` called `setPointerCapture` bare; a throw aborted `move()` every frame and the cover
  swipe silently failed. It also had no window net if capture was lost.

**Fix** — one rule, `shouldCommitOnEnd` in `src/lib/gestures/swipeCommit.ts`, used by swipeAction,
coverSwipe and dragClose: past the commit distance = commit on any end; release inside = cancel.
swipeAction fires at release. While a swipe owns the axis, a non-passive touchmove preventDefault
stops the scroll takeover. coverSwipe got guarded capture + a window safety net.

**Not changed** — TrackMenu edit grid, RowActionsConfig, chipReorder, dragReorder, scrub, NpUpNext
grip (collision/position-based, per user). NowPlaying collapse/sheet grips already route
pointercancel through their normal release logic.

**Verification** — `pnpm exec vitest --run src/lib/actions src/lib/gestures`: 162 passed (+ helper
tests). Full `pnpm test`: 5 failures in settings-persist / track-menu-order, identical on pristine
HEAD (pre-existing). `pnpm check`: 0 errors. Device feel (Android flick) not verified here.
