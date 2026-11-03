import type { Action } from 'svelte/action';
import { createVelocityTracker } from '$lib/gestures/velocity';
import { createSpringSnap } from '$lib/gestures/springSnap';

// use:swipeAction — DIRECTIONAL finger-drag-SIDEWAYS that commits a per-direction callback then
// ALWAYS springs the row back (Phase 23, UX-04 / D-01/D-02). A verbatim generalization of
// swipeRemove.ts: the load-bearing Phase 15/20 gesture invariants (slop, axis-arbitration,
// flick, tap-preservation, WR-01 click suppression) are inherited unchanged; ONLY the commit
// semantics differ — swipeRemove removed the row, swipeAction fires onSwipeRight/onSwipeLeft and
// the row is NEVER removed (iOS-Mail full-commit-then-spring-back, D-02).
//
// Contract:
//  - The row follows the finger via inline translateX (transition off) the moment a HORIZONTAL
//    drag is committed — a live finger-following slide (D-02), never a tap-then-snap. Unlike
//    swipeRemove there is NO opacity fade (the row stays fully opaque; it is never removed).
//  - On release: dragged past `threshold` (default 96px) OR a fast horizontal flick
//    (|velocity| > FLICK_V with |dx| > SLOP) → COMMIT: dx > 0 calls onSwipeRight() (queue, D-03),
//    dx < 0 calls onSwipeLeft() (like toggle, D-04). Then — committed or not — the row ALWAYS
//    springs back to translateX(0).
//  - TAP-PRESERVING: we never preventDefault / setPointerCapture on pointerdown, and only capture
//    once an actual horizontal drag begins (in move()). A tap (sub-slop on BOTH axes) NEVER
//    captures and NEVER commits, so the row's onclick (tap-to-play) keeps firing.
//  - VERTICAL-YIELDS: a vertical-dominant gesture past slop (|ddy| > |ddx|) goes passive (no
//    capture) so the row's scroll / use:longpress menu runs — the swipe never hijacks it.
//  - touch-action: pan-y on attach — vertical panning/scroll stays with the browser, only the
//    horizontal axis is yielded to this action.
//  - SETTLE IS UNCONDITIONAL (quick-261102-settle): the release used to be heard ONLY via
//    pointerup/pointercancel delivered to this node, with a bare setPointerCapture in move().
//    If capture is lost mid-gesture (browser implicit release, a competing surface capturing
//    the same pointer, release outside the window) NEITHER event reaches the node, up() never
//    runs, springSnap is never invoked and the row LATCHES at its drag offset — Hector's
//    desktop report "swiping a song row does not snap back when the mouse leaves" (reproduced
//    in headless Chromium by stealing capture mid-drag: lostpointercapture fires, no up/cancel
//    ever arrives, transform stays translateX(60px) forever). The fix routes EVERY abandonment
//    path into the same up(): lostpointercapture on the node, window-level pointerup /
//    pointercancel / pointermove / blur safety listeners armed at commit (dragScroll's
//    window-listener precedent), a try/catch around setPointerCapture with window tracking as
//    the fallback, and a buttons===0 move guard for a release that happened off-window.
//  - This action is a PURE DOM gesture: it does NOT fire haptics. The consuming component calls
//    haptics.tick() inside onSwipeRight/onSwipeLeft on commit (PATTERNS.md §3.3).
//  - Reactive update(opts) swaps callbacks / threshold / toggles `enabled`. enabled:false → inert.
//    destroy() removes listeners + resets inline styles + clears touchAction.
export interface SwipeActionOpts {
	onSwipeRight?: () => void;
	onSwipeLeft?: () => void;
	threshold?: number;
	enabled?: boolean;
}

export const swipeAction: Action<HTMLElement, SwipeActionOpts> = (node, opts) => {
	let onSwipeRight = opts.onSwipeRight;
	let onSwipeLeft = opts.onSwipeLeft;
	let threshold = opts.threshold ?? 96;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let captured = false;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let activePointerId = -1;
	let lastMoveEvent: PointerEvent | null = null;
	const SLOP = 8; // px before a press becomes a drag (swipeRemove's DRAG_START)
	const FLICK_V = 0.5; // px/ms — a fast horizontal flick commits even when not dragged far
	const vel = createVelocityTracker();

	// pan-y: keep vertical scroll/pan with the browser, yield the horizontal axis to this action.
	node.style.touchAction = 'pan-y';

	function resetTransform() {
		node.style.transform = '';
		node.style.transition = '';
	}

	// quick-261022-spring: the ALWAYS-spring-back (D-02, iOS-Mail full-commit-then-spring-back)
	// settles with a real damped spring instead of the old fixed 0.28s ease-out. The pump drives
	// the inline transform every frame; onSettled clears it so the host CSS resting state returns.
	// quick-261102-u05 (DECISIONS.md §12): the swipe's data commit waits for the SETTLE frame (the
	// shared settle discipline — chipReorder/TrackMenu). It used to fire at release, so a host that
	// removes the row (NpUpNext's swipe-remove) deleted it while it was still springing.
	let pendingCommit: (() => void) | null = null;
	const flushCommit = () => {
		const c = pendingCommit;
		pendingCommit = null;
		c?.();
	};
	const snap = createSpringSnap(
		(v) => {
			node.style.transform = v === 0 ? '' : `translateX(${v}px)`;
		},
		{
			onSettled: () => {
				resetTransform();
				flushCommit();
			}
		}
	);

	// WR-01: swallow the trailing click after a COMMITTED horizontal drag. setPointerCapture
	// retargets the click to this node, and on mouse input a click fires after every
	// mousedown→mouseup regardless of travel — without this, a committed drag would fire the
	// swipe callback and then immediately fire the row's tap-to-play onclick. Armed in up() only
	// when the gesture captured; self-removes after one click; disarmed on the next pointerdown so
	// a touch release that never produces a click can't swallow a LATER genuine tap.
	function suppressClick(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		node.removeEventListener('click', suppressClick, true);
	}

	// quick-261102-settle: window-level safety net, armed only while a drag is committed.
	// With pointer capture held, releases retarget to this node and the window copies of the
	// same event are deduped (move) / no-ops (up, via the dragging guard); when capture is
	// lost or refused, these become the ONLY path that can settle the gesture. Handlers are
	// pointerId-filtered so a second finger's release never settles this pointer's drag.
	const win = () => (typeof window !== 'undefined' ? window : null);
	const winMove = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) move(e);
	};
	const winUp = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) up();
	};
	// quick-261102-u05: cancel / blur / lost capture SPRING BACK and never commit (they used to route to
	// up(), which committed a past-threshold drag the user never released).
	const winCancel = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) cancel();
	};
	const winBlur = () => cancel();

	function armWindow() {
		const w = win();
		if (!w) return;
		w.addEventListener('pointermove', winMove);
		w.addEventListener('pointerup', winUp);
		w.addEventListener('pointercancel', winCancel);
		w.addEventListener('blur', winBlur);
	}

	function disarmWindow() {
		const w = win();
		if (!w) return;
		w.removeEventListener('pointermove', winMove);
		w.removeEventListener('pointerup', winUp);
		w.removeEventListener('pointercancel', winCancel);
		w.removeEventListener('blur', winBlur);
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// A new gesture starts clean: drop a stale suppressor from a prior committed drag whose
		// trailing click never fired (touch input suppresses it natively).
		node.removeEventListener('click', suppressClick, true);
		dragging = true;
		captured = false;
		activePointerId = e.pointerId;
		lastMoveEvent = null;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		vel.reset();
		vel.sample(e.clientX, e.timeStamp); // velocity tracker seeded on X (axis-agnostic helper)
		// Do NOT setPointerCapture here: capturing on pointerdown retargets the trailing click to
		// THIS node, so a tap on the row never reaches its onclick (tap-to-play "did nothing").
		// Capture only once an actual horizontal drag begins (in move()).
		// quick-261022-spring: interrupt an in-flight spring settle so the pump can't fight the finger.
		snap.cancel();
		flushCommit(); // quick-261102-u05: a superseded settle still lands the previous swipe's commit
		node.style.transition = 'none';
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		// The same event instance reaches both the node listener and the window safety listener
		// (capture retargets to the node, then it bubbles to window) — process it once.
		if (e === lastMoveEvent) return;
		lastMoveEvent = e;
		// quick-261102-settle: a move arriving with NO button pressed means the press ended
		// somewhere we never saw (released off-window / after a blur) — settle the gesture
		// instead of hover-dragging the row under a button-less cursor.
		if (e.buttons === 0) {
			up();
			return;
		}
		const ddx = e.clientX - startX;
		const ddy = e.clientY - startY;
		if (!captured) {
			// Below slop on BOTH axes → still a tap; leave the click to the row (no slide yet).
			if (Math.abs(ddx) < SLOP && Math.abs(ddy) < SLOP) return;
			// Vertical wins → go passive so scroll / the longpress menu runs (no capture).
			if (Math.abs(ddy) > Math.abs(ddx)) {
				dragging = false;
				return;
			}
			// Horizontal commit: capture HERE (not on down) so the gesture keeps flowing past the
			// node edge while a tap (never reaching slop) leaves the click to the row.
			// quick-261102-settle: capture can THROW (NotFoundError for an already-inactive
			// pointer) — the bare call used to abort this handler before the transform write and
			// leave the gesture untracked. On a throw the window safety net (armed just below)
			// tracks the rest of the gesture instead.
			try {
				node.setPointerCapture(e.pointerId);
			} catch {
				/* window listeners below keep tracking — non-fatal */
			}
			captured = true;
			armWindow();
		}
		dx = e.clientX - startX;
		vel.sample(e.clientX, e.timeStamp);
		node.style.transform = `translateX(${dx}px)`; // slide following the finger (D-02)
		// NOTE: no opacity fade — these rows are never removed (drop swipeRemove's FADE_DISTANCE).
	}

	function up(commit = true) {
		if (!dragging) return;
		dragging = false;
		disarmWindow();
		activePointerId = -1;
		// WR-01: a gesture that committed (captured) must NOT let its trailing click reach the
		// row's onclick — neither after a swipe-commit (commit-then-replay) nor after a spring-back
		// (the user clearly dragged, not tapped). Capture-phase, one-shot.
		if (captured) node.addEventListener('click', suppressClick, true);
		captured = false;
		// Commit on a far drag OR a fast horizontal flick. The |dx| > SLOP guard keeps the tap
		// contract intact: a tap (sub-slop, low velocity) never commits.
		const v = vel.velocity();
		const committed =
			commit && (Math.abs(dx) > threshold || (Math.abs(v) > FLICK_V && Math.abs(dx) > SLOP));
		if (committed) {
			// quick-261102-u05: committed at the settle frame (flushCommit in onSettled), not here.
			pendingCommit = dx > 0 ? (onSwipeRight ?? null) : (onSwipeLeft ?? null); // queue (D-03) / like (D-04)
		}
		// ALWAYS spring back to rest — the row is NEVER removed (D-02). The shared springSnap
		// settles with real spring physics (quick-261022-spring) regardless of whether we committed.
		snap.snap(dx, 0);
		dx = 0;
	}

	// quick-261102-settle: capture was taken from us mid-gesture (implicit browser release or
	// a competing surface) — pointerup/pointercancel may never be delivered here, so settle
	// exactly like a release at the current offset (pointercancel parity: an abandoned touch
	// swipe ends the same way). After a NORMAL pointerup this fires with dragging already
	// false and no-ops.
	function lostCapture() {
		if (dragging) cancel(); // quick-261102-u05: lost capture is an abandoned gesture — spring back, no commit
	}

	function cancel() {
		up(false);
	}

	function release() {
		up(true);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', release);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('lostpointercapture', lostCapture);

	return {
		update(next: SwipeActionOpts) {
			onSwipeRight = next.onSwipeRight;
			onSwipeLeft = next.onSwipeLeft;
			threshold = next.threshold ?? 96;
			enabled = next.enabled ?? true;
		},
		destroy() {
			snap.cancel(); // quick-261022-spring: never leave the pump writing to a dead node
			disarmWindow(); // quick-261102-settle: never leak the window safety net
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', release);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('lostpointercapture', lostCapture);
			node.removeEventListener('click', suppressClick, true); // WR-01: drop an armed suppressor
			resetTransform();
			node.style.touchAction = '';
		}
	};
};

export default swipeAction;
