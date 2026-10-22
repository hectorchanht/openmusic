import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';
import { createSpringSnap } from '$lib/gestures/springSnap';

// use:swipeRemove — finger-drag-SIDEWAYS to remove a row (Phase 17, QUEUE-05 / D-06/D-07).
// A structural X-axis MIRROR of dragClose.ts, sharing the Up-Next row with the vertical
// GripVertical reorder, so it adds one axis-arbitration step (Pitfall 2 / RESEARCH Pattern 3):
//
// Contract:
//  - The row follows the finger via inline translateX (transition off) the moment a
//    HORIZONTAL drag is committed — a live finger-following slide + fade (D-07), never a
//    tap-then-snap.
//  - On release: dragged past `threshold` (default 96px) OR a fast horizontal flick
//    (|velocity| > FLICK_V with |dx| > SLOP) → call onremove() so the host removes the row;
//    below threshold and no flick → spring back to translateX(0) (snap-back).
//  - TAP-PRESERVING: we never preventDefault / setPointerCapture on pointerdown, and only
//    capture once an actual horizontal drag begins (in move()). A tap (sub-slop on BOTH
//    axes) NEVER captures and NEVER removes, so the row's onclick (tap-to-play) keeps firing.
//  - VERTICAL-YIELDS: if the gesture is vertical-dominant past slop (|ddy| > |ddx|) the action
//    goes passive (dragging cancelled, no capture) so the row's GripVertical reorder / scroll
//    runs — the horizontal swipe never hijacks a vertical drag.
//  - touch-action: pan-y is set on attach (KEY difference from dragClose's `none`): vertical
//    panning/scroll stays with the browser, only the horizontal axis is yielded to this action.
//  - Reactive update(opts) swaps onremove / toggles `enabled`. enabled:false → inert.
//    destroy() removes listeners + resets inline styles + clears touchAction.
export interface SwipeRemoveOpts {
	onremove: () => void;
	threshold?: number;
	enabled?: boolean;
}

export const swipeRemove: Action<HTMLElement, SwipeRemoveOpts> = (node, opts) => {
	let onremove = opts.onremove;
	let threshold = opts.threshold ?? 96;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let captured = false;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	const SLOP = 8; // px before a press becomes a drag (dragClose's DRAG_START)
	const FLICK_V = 0.5; // px/ms — a fast horizontal flick removes even when not dragged far
	const FADE_DISTANCE = 120; // px of travel that fades the row fully to opacity 0 (D-07)
	const vel = createVelocityTracker();

	// pan-y: keep vertical scroll/pan with the browser, yield the horizontal axis to this action.
	node.style.touchAction = 'pan-y';

	function resetTransform() {
		node.style.transform = '';
		node.style.transition = '';
		node.style.opacity = '';
	}

	// quick-261022-spring: the snap-back settles with a real damped spring instead of the old
	// fixed 0.28s ease-out. The pump drives BOTH translateX and the drag's opacity fade (the
	// same 1 − |v|/FADE_DISTANCE mapping as the live drag, D-07) every frame; onSettled clears
	// all three inline styles.
	const snap = createSpringSnap(
		(v) => {
			node.style.transform = `translateX(${v}px)`;
			node.style.opacity = String(1 - Math.min(1, Math.abs(v) / FADE_DISTANCE));
		},
		{ onSettled: resetTransform }
	);

	// WR-01: swallow the trailing click after a COMMITTED horizontal drag. setPointerCapture
	// retargets the click to this node, and on mouse input a click fires after every
	// mousedown→mouseup regardless of travel — without this, a committed drag would remove the
	// row and then immediately fire its tap-to-play onclick. Armed in up() only when the
	// gesture captured; self-removes after one click; disarmed on the next pointerdown so a
	// touch release that never produces a click can't swallow a LATER genuine tap.
	function suppressClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		node.removeEventListener('click', suppressClick, true);
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// A new gesture starts clean: drop a stale suppressor from a prior committed drag whose
		// trailing click never fired (touch input suppresses it natively).
		node.removeEventListener('click', suppressClick, true);
		// quick-261022-spring: interrupt an in-flight spring settle so the pump can't fight the finger.
		snap.cancel();
		dragging = true;
		captured = false;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		vel.reset();
		vel.sample(e.clientX, e.timeStamp); // velocity tracker seeded on X (axis-agnostic helper)
		// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click
		// to THIS node, so a tap on the row never reaches its onclick (tap-to-play "did nothing").
		// Capture only once an actual horizontal drag begins (in move()).
		node.style.transition = 'none';
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		const ddx = e.clientX - startX;
		const ddy = e.clientY - startY;
		if (!captured) {
			// Below slop on BOTH axes → still a tap; leave the click to the row (no slide yet).
			if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;
			// Vertical wins → go passive so the GripVertical reorder / scroll runs (no capture).
			if (Math.abs(ddy) > Math.abs(ddx)) {
				dragging = false;
				return;
			}
			// Horizontal commit: capture HERE (not on down) so the gesture keeps flowing past the
			// node edge while a tap (never reaching slop) leaves the click to the row.
			node.setPointerCapture(e.pointerId);
			captured = true;
		}
		dx = e.clientX - startX;
		vel.sample(e.clientX, e.timeStamp);
		node.style.transform = `translateX(${dx}px)`; // slide following the finger (D-07)
		node.style.opacity = String(1 - Math.min(1, Math.abs(dx) / FADE_DISTANCE)); // fade out
	}

	function up() {
		if (!dragging) return;
		dragging = false;
		// WR-01: a gesture that committed (captured) must NOT let its trailing click reach the
		// row's onclick — neither after a remove (remove-then-replay) nor after a spring-back
		// (the user clearly dragged, not tapped). Capture-phase, one-shot.
		if (captured) node.addEventListener('click', suppressClick, true);
		captured = false;
		// Remove on a far drag OR a fast horizontal flick. The |dx| > SLOP guard keeps the tap
		// contract intact: a tap (sub-slop, low velocity) never removes.
		const v = vel.velocity();
		if (Math.abs(dx) > threshold || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP)) {
			onremove();
		} else {
			// quick-261022-spring: spring snap-back from the live release point (pump drives
			// translateX + the fade mapping; onSettled clears the inline styles).
			snap.snap(dx, 0);
		}
		dx = 0;
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: SwipeRemoveOpts) {
			onremove = next.onremove;
			threshold = next.threshold ?? 96;
			enabled = next.enabled ?? true;
		},
		destroy() {
			snap.cancel(); // quick-261022-spring: never leave the pump writing to a dead node
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', suppressClick, true); // WR-01: drop an armed suppressor
			resetTransform();
			node.style.touchAction = '';
		}
	};
};
