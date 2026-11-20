import type { Action } from 'svelte/action';

// use:dragScroll — pointer/mouse drag-to-scroll for a horizontal shelf (quick-260606-rvy FIX-B).
//
// The discovery shelves (.albumrow, the CompactPager track, the HomeGridPager track) already
// scroll natively on TOUCH. On a DESKTOP/MOUSE the only scroll affordance was the scrollbar (and,
// since quick-260919-et3, the chevrons on .albumrow); this action makes the row grabbable so a
// click-drag pans it horizontally — additive for mouse, leaving touch's native momentum scroll
// untouched (so we deliberately do NOT set touch-action:none, unlike dragClose).
//
// WHY IT LOOKED DEAD ON DESKTOP CHROME (quick-260919-et3 follow-up). Three separate things were
// eating the gesture, and each had to go:
//
//  1. NATIVE HTML5 DRAG-AND-DROP — the real killer. Every shelf tile contains an <img> cover, and
//     in Chrome a mousedown on an image followed by movement starts an image DnD. The moment it
//     does, the browser CANCELS the pointer stream (pointercancel), so the pan died a few pixels
//     in and the row snapped back to where it started. Nothing in this app supports dragging a
//     cover out of a shelf, so `dragstart` is simply cancelled.
//  2. TEXT SELECTION — the tile labels are real text, so a pan that began on one highlighted its
//     way across the shelf. pointerdown fires BEFORE mousedown, so switching the node to
//     user-select:none there stops the selection from ever starting.
//  3. `pointerleave` ENDED THE DRAG — the node only saw pointermove while the cursor was still
//     over it, and the shelves are short. Sliding a few px above or below the row (or off the
//     window entirely) aborted mid-pan and left the cursor stuck on 'grabbing'. The move/up
//     listeners now live on `window` for the duration of the gesture, so the drag follows the
//     pointer anywhere and a release outside the window still lands.
//
// Pointer CAPTURE would also solve (3) and is the more usual answer, but capture retargets the
// compatibility mouse events — including `click` — to the capturing element, which would stop the
// tile buttons' onclick from ever firing. Window listeners keep the click path exactly as it is.
//
// SCROLL SNAP: the two pager tracks are `scroll-snap-type: x mandatory`. A snap container re-snaps
// after every programmatic scrollLeft write, so setting scrollLeft in a drag loop fights the
// gesture. Snap is switched off for the duration of the drag and restored on release, which is
// also what makes the release land on a whole page. A shelf with no snap is unaffected.
//
// THE TAP-VS-DRAG GUARD (the load-bearing bit): each shelf tile is a <button> whose onclick
// plays a song / navigates. Without a guard, releasing a drag over a tile would also fire that
// click → a shelf-pan would accidentally play a song. So we accumulate the total |dx| during a
// drag and, if it exceeds `threshold` (default 6px = a deliberate drag, not a jittery tap), we
// arm a one-shot CAPTURE-PHASE click suppressor: the very next `click` on the node is
// preventDefault()+stopPropagation()'d BEFORE it reaches the child tile button, then disarmed.
// A genuine tap (|dx| ≤ threshold) never arms it, so tile clicks fire normally. This mirrors
// dragClose's dy/velocity tap-preserving release contract.

/**
 * Pure helper: does a release that moved `totalDx` px horizontally count as a DRAG (suppress
 * the trailing click) rather than a TAP? True when |totalDx| strictly exceeds `threshold`
 * (default 6). Exported for unit testing the threshold in isolation.
 */
export function shouldSuppressClick(totalDx: number, threshold = 6): boolean {
	return Math.abs(totalDx) > threshold;
}

export interface DragScrollOpts {
	/** px of horizontal movement past which a release suppresses the trailing click. Default 6. */
	threshold?: number;
	/** When false the action is inert (no grab cursor, no drag). Default true. */
	enabled?: boolean;
}

export const dragScroll: Action<HTMLElement, DragScrollOpts | undefined> = (node, opts) => {
	let threshold = opts?.threshold ?? 6;
	let enabled = opts?.enabled ?? true;

	let dragging = false;
	let startX = 0;
	let startScrollLeft = 0;
	let totalDx = 0; // accumulated |dx| this gesture — decides drag vs tap on release
	let suppressNextClick = false; // armed when a drag exceeded threshold; eats the next click
	let prevSnap = ''; // the node's own inline scroll-snap-type, restored on release

	function applyCursor() {
		node.style.cursor = enabled ? 'grab' : '';
	}
	applyCursor();

	/** Suppress selection for the duration of a pan (see reason 2 in the header). */
	function setNoSelect(on: boolean) {
		node.style.userSelect = on ? 'none' : '';
		// Safari still wants the prefix, and this app ships to desktop Safari too.
		node.style.setProperty('-webkit-user-select', on ? 'none' : '');
	}

	function bindWindow(on: boolean) {
		// Bound, not destructured — a detached window.addEventListener throws Illegal invocation.
		const fn = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window);
		fn('pointermove', move);
		fn('pointerup', up);
		fn('pointercancel', up);
		// Alt-tab / OS drag off the window: never leave the shelf stuck mid-pan.
		fn('blur', up);
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// Only hijack mouse/pen drags; let touch keep its native momentum scroll.
		if (e.pointerType === 'touch') return;
		// Primary button only — a right-click (context menu) or middle-click is not a pan.
		if (e.button !== 0) return;
		dragging = true;
		startX = e.clientX;
		startScrollLeft = node.scrollLeft;
		totalDx = 0;
		node.style.cursor = 'grabbing';
		setNoSelect(true);
		prevSnap = node.style.scrollSnapType;
		node.style.scrollSnapType = 'none';
		bindWindow(true);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		const dx = e.clientX - startX;
		// Track the largest distance reached this gesture: a quick out-and-back drag is still a
		// drag (suppress the click) even if it ends near where it began.
		if (Math.abs(dx) > Math.abs(totalDx)) totalDx = dx;
		node.scrollLeft = startScrollLeft - dx;
	}
	function up() {
		bindWindow(false);
		if (!dragging) return;
		dragging = false;
		node.style.cursor = enabled ? 'grab' : '';
		setNoSelect(false);
		// Restoring the stylesheet's `mandatory` re-snaps the track to the nearest page, which is
		// exactly the release behaviour a pager wants.
		node.style.scrollSnapType = prevSnap;
		// Arm the one-shot click suppressor only when this was a real drag, so a tap still plays.
		if (shouldSuppressClick(totalDx, threshold)) suppressNextClick = true;
	}
	// CAPTURE phase so we intercept before the child tile button's bubble-phase onclick.
	function clickCapture(e: MouseEvent) {
		if (suppressNextClick) {
			e.preventDefault();
			e.stopPropagation();
			suppressNextClick = false;
		}
	}
	// Reason 1 in the header — the single most important line in this file on desktop.
	function dragStart(e: Event) {
		if (enabled) e.preventDefault();
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('dragstart', dragStart);
	node.addEventListener('click', clickCapture, true);

	return {
		update(next: DragScrollOpts | undefined) {
			threshold = next?.threshold ?? 6;
			enabled = next?.enabled ?? true;
			applyCursor();
		},
		destroy() {
			up(); // unbinds the window listeners if the node is torn down mid-drag
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('dragstart', dragStart);
			node.removeEventListener('click', clickCapture, true);
			node.style.cursor = '';
		}
	};
};
