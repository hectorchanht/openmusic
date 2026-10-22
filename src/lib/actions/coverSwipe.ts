import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';
import { createSpringSnap } from '$lib/gestures/springSnap';

// use:coverSwipe — finger-drag-SIDEWAYS to change track (Phase 20, NP-01 cover carousel / NP-05
// nowbar slide). A structural X-axis MIRROR of swipeRemove.ts: same arm-on-down /
// commit-axis-after-slop / capture-only-in-move / trailing-click-suppressor idiom, reused so the
// load-bearing Pitfall-7 invariant is shared verbatim across every horizontal gesture in the repo.
//
// LOAD-BEARING INVARIANT (ROADMAP Pitfall 7 — the single highest-risk interaction in v1.2):
//   Never `setPointerCapture` on `pointerdown`. Arm on down; commit axis in `pointermove` after
//   the 8px slop + axis-dominance check; capture only then. Sub-slop movement must still reach
//   `onclick` (the host's tap-to-collapse / tap-to-expand keeps firing).
//
// Three deltas from the swipeRemove.ts analog, pinned by the 20-UI-SPEC:
//  1. Proportional commit (D-08): the distance commit is `0.28 × measuredWidth` (measured at
//     down() via getBoundingClientRect, mirroring NowPlaying's measure-at-drag-start idiom),
//     NOT a flat 96px. maxPull for the boundary rubber-band is `0.18 × measuredWidth`.
//  2. prev/next + live dx (D-03): exposes `onprev`/`onnext` (drag RIGHT = onprev, drag LEFT =
//     onnext — reuse player.prev()/next(), NO new advance logic) plus a per-frame `ondrag(dx)`
//     so a host can drive a 3-cover carousel strip (1:1 lockstep, UI-SPEC §1) or a nowbar slide.
//  3. iOS rubber-band at a true boundary (D-02 / UI-SPEC §2): when the relevant neighbor is
//     absent (prev gesture && hasPrev:false, or next gesture && hasNext:false) the live translate
//     is clamped to `sign(dx)·maxPull·(1 − e^(−|dx|/maxPull))`, flick is IGNORED, and the gesture
//     ALWAYS springs back to translateX(0) over 0.32s (the heavier cover-reflow settle).
//
// Shared with the analog byte-for-byte: SLOP = 8, FLICK_V = 0.5 px/ms, settle curve
// cubic-bezier(.22,1,.36,1), pan-y touch-action on attach, the capture-phase one-shot
// suppressClick armed in up() only when captured, and a destroy() that drops the suppressor +
// resets inline styles + clears touchAction.
export interface CoverSwipeOpts {
	onprev: () => void;
	onnext: () => void;
	/** Live per-frame running dx (px) during a committed horizontal drag — host drives its strip. */
	ondrag?: (dx: number) => void;
	/** False = no prev neighbor → a prev (drag-right) gesture rubber-bands and never fires. Default true. */
	hasPrev?: boolean;
	/** False = no next neighbor → a next (drag-left) gesture rubber-bands and never fires. Default true. */
	hasNext?: boolean;
	enabled?: boolean;
}

export const coverSwipe: Action<HTMLElement, CoverSwipeOpts> = (node, opts) => {
	let onprev = opts.onprev;
	let onnext = opts.onnext;
	let ondrag = opts.ondrag;
	let hasPrev = opts.hasPrev ?? true;
	let hasNext = opts.hasNext ?? true;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let captured = false;
	let resisting = false; // true once a committed gesture is pulling against a true boundary
	let pointerId: number | null = null; // set at capture so up()/destroy() can releasePointerCapture (WR-04)
	let suppressTimer: ReturnType<typeof setTimeout> | null = null; // self-expiry for the click suppressor (WR-05)
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let lastApplied = 0; // quick-261022-spring: the translate ACTUALLY applied on the last move
	// (rubber-banded at a boundary, 1:1 otherwise) — the spring re-seeds from THIS, not raw dx.
	let commitDist = 0; // 0.28 × measuredWidth, recomputed at each down()
	let maxPull = 0; // 0.18 × measuredWidth, the rubber-band asymptote
	const SLOP = 8; // px before a press becomes a drag (swipeRemove's SLOP / dragClose's DRAG_START)
	const FLICK_V = 0.5; // px/ms — a fast horizontal flick commits even when not dragged far
	const COMMIT_FRACTION = 0.28; // D-08 / UI-SPEC §3: distance commit = 28% of the element width
	const MAX_PULL_FRACTION = 0.18; // UI-SPEC §2: rubber-band asymptote = 18% of the element width
	const vel = createVelocityTracker();

	// pan-y: keep vertical scroll/collapse with the browser, yield the horizontal axis to this action.
	node.style.touchAction = 'pan-y';

	function resetTransform() {
		node.style.transform = '';
		node.style.transition = '';
	}

	// quick-261022-spring: both snap-backs (boundary + normal) settle with a real damped spring
	// instead of the old fixed 0.28s/0.32s ease-outs. The pump drives the inline transform every
	// frame AND reports each frame to ondrag (WR-02 parity: a host driving its own surface off
	// ondrag never visually disagrees with the node, even mid-spring). onSettled clears the
	// inline styles so the host's CSS resting state (e.g. NowPlaying's strip settle) returns.
	const snap = createSpringSnap(
		(v) => {
			node.style.transform = v === 0 ? '' : `translateX(${v}px)`;
			ondrag?.(v);
		},
		{ onSettled: resetTransform }
	);

	// Defensively release a held pointer capture (WR-04). Browsers auto-release on
	// pointerup/pointercancel, but an enabled:false update or a destroy() mid-drag can skip up();
	// without this the capture + dragging/captured flags dangle and the strip freezes mid-drag.
	function releaseCapture() {
		if (captured && pointerId !== null) {
			try {
				node.releasePointerCapture(pointerId);
			} catch {
				/* already released by the UA — fine */
			}
		}
		captured = false;
		pointerId = null;
	}

	// Drop the one-shot trailing-click suppressor AND its self-expiry timer together (WR-05).
	function disarmSuppressor() {
		node.removeEventListener('click', suppressClick, true);
		if (suppressTimer !== null) {
			clearTimeout(suppressTimer);
			suppressTimer = null;
		}
	}

	// Abort an in-flight gesture cleanly: enabled flipped false mid-drag, or destroy() during a
	// drag (NowPlaying unmounts on player.collapse()). Release capture, drop the live
	// transform/transition, clear state — NO prev/next fires (WR-03/WR-04).
	function cancelGesture() {
		releaseCapture();
		dragging = false;
		resisting = false;
		snap.cancel(); // quick-261022-spring: stop the settle pump too
		resetTransform();
	}

	// Swallow the trailing click after a COMMITTED horizontal drag. setPointerCapture retargets the
	// click to this node, and on mouse input a click fires after every mousedown→mouseup regardless
	// of travel — without this, a committed swipe would change the track AND then fire the host's
	// tap-to-collapse / tap-to-expand onclick. Armed in up() only when the gesture captured;
	// self-removes after one click, after a 350ms safety timeout (a touch commit often produces NO
	// trailing click, WR-05), or on the next pointerdown.
	function suppressClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		disarmSuppressor();
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// A new gesture starts clean: drop a stale suppressor (+ its timer) from a prior committed
		// drag whose trailing click never fired (touch input suppresses it natively).
		disarmSuppressor();
		dragging = true;
		captured = false;
		resisting = false;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		lastApplied = 0;
		// quick-261022-spring: a new press interrupts an in-flight spring settle — otherwise the
		// pump would keep writing the transform and fight the finger.
		snap.cancel();
		// Measure the element width at gesture start (like NowPlaying.measureOffsets reads the live
		// layout) so the commit + rubber-band scale with the actual cover/nowbar width, never hardcoded.
		const width = node.getBoundingClientRect().width;
		commitDist = COMMIT_FRACTION * width;
		maxPull = MAX_PULL_FRACTION * width;
		vel.reset();
		vel.sample(e.clientX, e.timeStamp); // velocity tracker seeded on X (axis-agnostic helper)
		// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click to
		// THIS node, so a tap never reaches the host's onclick (tap-to-collapse / tap-to-expand
		// "did nothing"). Capture only once an actual horizontal drag begins (in move()).
		node.style.transition = 'none';
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		// enabled can flip false mid-drag (Nowbar passes enabled:!resolving, and a track resolve can
		// start mid-swipe). Abort cleanly rather than keep dragging a now-disabled surface (WR-03).
		if (!enabled) {
			cancelGesture();
			return;
		}
		const ddx = e.clientX - startX;
		const ddy = e.clientY - startY;
		if (!captured) {
			// Below slop on BOTH axes → still a tap; leave the click to the host (no slide yet).
			if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;
			// Vertical wins → go passive so the host's vertical-collapse handler / scroll runs (no capture).
			if (Math.abs(ddy) > Math.abs(ddx)) {
				dragging = false;
				// up() early-returns once dragging is false, so clear the transition:none set in down()
				// HERE — otherwise a vertical-collapse gesture that STARTS on this node permanently
				// defeats the host's CSS settle + reduced-motion transition (CR-02).
				node.style.transition = '';
				return;
			}
			// Horizontal commit: capture HERE (not on down) so the gesture keeps flowing past the
			// node edge while a tap (never reaching slop) leaves the click to the host.
			node.setPointerCapture(e.pointerId);
			pointerId = e.pointerId; // remember so up()/destroy() can release it (WR-04)
			captured = true;
		}
		dx = e.clientX - startX;
		vel.sample(e.clientX, e.timeStamp);
		// A prev gesture (drag RIGHT, dx > 0) at hasPrev:false, or a next gesture (drag LEFT,
		// dx < 0) at hasNext:false, hits a true queue wall → rubber-band clamp + flick-ignored.
		resisting = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
		// The translate ACTUALLY applied: a damped rubber-band offset at a boundary (classic iOS
		// asymptote toward maxPull, never reaching it), else 1:1 lockstep follow (UI-SPEC §1).
		const applied = resisting
			? Math.sign(dx) * maxPull * (1 - Math.exp(-Math.abs(dx) / maxPull))
			: dx;
		lastApplied = applied; // quick-261022-spring: the spring re-seeds from the APPLIED value
		node.style.transform = `translateX(${applied}px)`;
		// Report the value APPLIED, not the raw dx, so a host driving its own surface off ondrag
		// never visually disagrees with the node at a boundary (WR-02).
		ondrag?.(applied);
	}

	function up() {
		if (!dragging) return;
		dragging = false;
		// A gesture that committed (captured) must NOT let its trailing click reach the host's
		// onclick — neither after a track change nor after a spring-back (the user clearly dragged,
		// not tapped). Capture-phase, one-shot; self-expires after 350ms when a touch commit produces
		// no trailing click (WR-05).
		const wasCaptured = captured;
		releaseCapture(); // explicit release (WR-04); also clears captured + pointerId
		if (wasCaptured) {
			node.addEventListener('click', suppressClick, true);
			suppressTimer = setTimeout(disarmSuppressor, 350);
		}
		// At a TRUE BOUNDARY: ignore flick entirely and ALWAYS spring back — a hard flick into a
		// wall must never commit (UI-SPEC §2). quick-261022-spring: real spring physics replace
		// the old fixed 0.32s ease-out; re-seeds from the rubber-banded applied value.
		if (resisting) {
			resisting = false;
			snap.snap(lastApplied, 0);
			dx = 0;
			return;
		}
		// Commit on a far drag (≥ proportional commit) OR a fast horizontal flick. The |dx| > SLOP
		// guard keeps the tap contract intact: a tap (sub-slop, low velocity) never commits.
		const v = vel.velocity();
		if (Math.abs(dx) >= commitDist || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
			// Direction → action (D-03): drag RIGHT = onprev, drag LEFT = onnext. No new advance
			// logic — these are the host's player.prev()/player.next().
			if (dx > 0) onprev();
			else onnext();
			// Unlike swipeRemove (whose node leaves the DOM on commit), the carousel strip / nowbar
			// content PERSISTS across the player.prev()/next() swap. Drop the live translateX(dx) +
			// transition:none left from the drag, or the freshly-swapped cover renders frozen
			// ~commitDist off-centre (CR-01). resetTransform() restores the host CSS resting state
			// (translateX(0)); the host's own transition animates the new cover into place.
			resetTransform();
		} else {
			// quick-261022-spring: spring snap-back from the live release point (pump drives the
			// transform + ondrag frames; onSettled restores the host CSS resting state).
			snap.snap(dx, 0);
		}
		dx = 0;
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: CoverSwipeOpts) {
			onprev = next.onprev;
			onnext = next.onnext;
			ondrag = next.ondrag;
			hasPrev = next.hasPrev ?? true;
			hasNext = next.hasNext ?? true;
			const wasEnabled = enabled;
			enabled = next.enabled ?? true;
			// Host disabled the action mid-drag (e.g. a resolve started) → abort the in-flight
			// gesture so it can't strand dragging/captured + a held capture (WR-03).
			if (wasEnabled && !enabled && dragging) cancelGesture();
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			disarmSuppressor(); // drop an armed suppressor + its self-expiry timer (WR-05)
			cancelGesture(); // release a still-held capture + reset state if unmounted mid-drag (WR-03/WR-04)
			node.style.touchAction = '';
		}
	};
};
