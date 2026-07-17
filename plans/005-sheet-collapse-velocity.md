# 005 — Page-Collapse Flick Velocity (Domain 3, MEDIUM)

**Severity:** MEDIUM
**Depends on:** nothing new (`createVelocityTracker` already imported at NowPlaying.svelte:51)
**Edited file:** `src/lib/components/NowPlaying.svelte` only.

## Goal
The whole-overlay "drag the top half down to dismiss" path commits on **distance only**
(`dragY > 120`, line 779) — a fast short downward flick does not dismiss, inconsistent with every
other gesture in the app (sheet snap machine, `coverSwipe`, `dragClose` all honor flick velocity).
Add a velocity path so a deliberate flick collapses even below the distance threshold. The internal
closed/half/full snap machine is already velocity-aware and is NOT touched.

## Entry points
The `npTopDown` / `npTopMove` / `npTopUp` handlers (lines 696-781) and the collapse constants.

## Part A — add a velocity tracker for the collapse path

Add beside the existing page-collapse drag state (after line 685, `const DRAG_SLOP = 8;`):

```ts
	// plan 005: flick-to-collapse. The page-collapse path was distance-only (dragY > 120); add a
	// velocity tracker so a fast downward flick dismisses too, matching the sheet snap machine and
	// the coverSwipe/dragClose gestures. Reuses the shared pure tracker (no Date.now — WR-safe).
	const collapseVel = createVelocityTracker();
	const COLLAPSE_FLICK_V = 0.5; // px/ms — same flick threshold as gripVel / coverSwipe FLICK_V
```

## Part B — seed + sample the tracker

In `npTopDown` (line 696-702), reset + seed the tracker. **Replace** the body:

```ts
	function npTopDown(e: PointerEvent) {
		dragArmed = true;
		dragging = false;
		npTopDeleg = 'none';
		startY = e.clientY;
		startX = e.clientX;
		collapseVel.reset();
		collapseVel.sample(e.clientY, e.timeStamp);
	}
```

In `npTopMove`, sample on every move so the release reading is fresh. Add the sample call at the
top of the collapse branch. **Replace** the `else if (npTopDeleg === 'collapse')` tail (lines
742-744):

```ts
		} else if (npTopDeleg === 'collapse') {
			collapseVel.sample(e.clientY, e.timeStamp);
			dragY = Math.max(0, dy);
		}
```

## Part C — honor velocity on release

In `npTopUp` (lines 764-781), the `deleg === 'collapse'` branch. **Replace** the tail:

```ts
		// deleg === 'collapse' — closed-state downward drag: distance OR a fast downward flick.
		dragging = false;
		const v = collapseVel.velocity(); // px/ms; > 0 = moving DOWN
		if (dragY > 120 || (v > COLLAPSE_FLICK_V && dragY > 8)) player.collapse();
		dragY = 0;
	}
```

*(The `dragY > 8` guard keeps a tap from ever collapsing — same contract the distance path had via
the slop-thresholded commit.)*

## Invariants preserved
- The snap-delegated path (`deleg === 'snap'`) is untouched — the sheet's own flick logic still
  owns open-sheet gestures.
- No capture/axis-arbitration change: velocity is only *read* at release; commit still requires a
  real downward drag (`dragY > 8`).
- `player.collapse()` remains the sole dismiss path (history/overlay balance unchanged).

## Note (documented, not changed)
The overlay *open* animation (`transition:fly={{ y:600, duration:320, easing: cubicOut }}`, line
1144) stays a time-based Svelte transition — mount/unmount transitions are not gesture-interruptible
by nature, and `cubicOut` already reads as a soft decel. Converting it to a spring store would add
risk for little gain; left as-is and noted in the summary's deferred list.

## Verification
`pnpm check`. In app: a short fast downward flick on the (closed-sheet) cover/meta area now
collapses to the Nowbar; a slow short drag under 120px still springs back; taps still fire clicks.
