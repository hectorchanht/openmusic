import type { Action } from 'svelte/action';
import { createSpringSnap } from '$lib/gestures/springSnap';
import { settings } from '$lib/stores/settings.svelte';

// use:chipReorder — drag-to-reorder for a row of chips (the section dragReorder action is
// vertical-list-only). Attaches to the chips CONTAINER; only children carrying
// `data-chip-index` (the SELECTED chips, in order) are draggable. A drag past THRESHOLD lifts
// the chip to follow the pointer and, on release, reorders to the target index via
// onReorder(from, to). A drag also arms a one-shot capture-phase click suppressor so the
// chip's tap-to-toggle onclick does NOT fire after a reorder (mirrors dragScroll's
// tap-vs-drag guard). A plain tap (no movement past THRESHOLD) falls through to the click.
//
// quick-261102-chipflip — WHY THIS WAS REWRITTEN (Hector 2026-11-02: the drag felt 唔貼手 —
// not glued to the finger — and 唔會自然放低去適當位置 — no natural landing):
//  1. NO LIVE REFLOW: siblings never moved while dragging, so nothing showed where the chip
//     would land; on release the transform was cleared instantly and the Svelte re-render
//     TELEPORTED the chip into its new slot. Now the target index is tracked live (the same
//     nearest-center math the drop always used) and siblings GLIDE to their post-move slots
//     (transforms only — the data order does not change mid-drag, so the re-render can never
//     race the gesture), opening the gap the chip will land in.
//  2. NO DROP SETTLE: the release now SPRINGS the chip (shared springSnap, one pump per axis)
//     from its live pointer offset into the target slot's offset, and only THEN fires
//     onReorder — the re-render lands exactly on the visual state, so there is no jump.
//  3. CANCEL MEANT COMMIT: pointercancel used to run the same drop path and could reorder.
//     A cancelled drag (pointercancel / lost capture / window blur / button-less move) now
//     springs the chip back to its ORIGINAL slot and never fires onReorder — the same
//     abandonment parity as quick-261102-settle in swipeAction/swipeRemove.
// The dragged chip's own transform is ALWAYS the raw pointer delta with transition:none —
// any smoothing lives in the siblings' glide and the release spring, never in the tracking.

const THRESHOLD = 6; // px of movement before a press becomes a drag (not a tap)
const SIBLING_GLIDE = 'transform 180ms ease'; // sibling reflow glide while dragging

/** Pure: index of the chip center nearest (x,y); `fromIndex` if `centers` is empty. */
export function nearestChipIndex(
	x: number,
	y: number,
	centers: { index: number; cx: number; cy: number }[],
	fromIndex: number
): number {
	let best = fromIndex;
	let bestDist = Infinity;
	for (const c of centers) {
		const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = c.index;
		}
	}
	return best;
}

/**
 * Pure: the slot a chip ENDS UP in when the chip at `from` is moved to `to` (splice-move
 * semantics — remove at `from`, insert at `to`, matching the host's reorderList). The moved
 * chip takes slot `to`; every chip between the two slots shifts one slot toward the vacated
 * one; all others stay. Drives the live sibling reflow transforms.
 */
export function chipSlotForIndex(index: number, from: number, to: number): number {
	if (index === from) return to;
	if (from < index && index <= to) return index - 1;
	if (to <= index && index < from) return index + 1;
	return index;
}

export interface ChipReorderOpts {
	onReorder: (from: number, to: number) => void;
}

interface ChipSlot {
	el: HTMLElement;
	index: number;
	left: number;
	top: number;
	cx: number;
	cy: number;
}

export const chipReorder: Action<HTMLElement, ChipReorderOpts> = (node, opts) => {
	let onReorder = opts.onReorder;
	let chip: HTMLElement | null = null;
	let fromIndex = -1;
	let startX = 0;
	let startY = 0;
	let dragging = false;
	let activePointerId = -1;
	let lastMoveEvent: PointerEvent | null = null;

	// Drag geometry, measured ONCE at drag start (before any transform is written, so the
	// rects are true layout slots). `slots` is sorted by chip index and indices are the
	// contiguous 0..n-1 rendered by the host's {#each}, so slots[i] is chip index i's slot.
	let slots: ChipSlot[] = [];
	let siblingCenters: { index: number; cx: number; cy: number }[] = [];
	let targetIndex = -1;
	let curX = 0; // the dragged chip's live translate — also the settle's start point
	let curY = 0;

	// --- drop settle (springSnap per axis; BOTH axes settled → commit) ---
	let settling = false;
	let settleChip: HTMLElement | null = null;
	let axesSettled = 0;
	let pendingReorder: { from: number; to: number } | null = null;

	function writeSettle() {
		if (settleChip) settleChip.style.transform = `translate(${curX}px, ${curY}px)`;
	}
	function axisSettled() {
		axesSettled += 1;
		if (axesSettled >= 2) finishSettle();
	}
	const snapX = createSpringSnap(
		(v) => {
			curX = v;
			writeSettle();
		},
		{ onSettled: axisSettled }
	);
	const snapY = createSpringSnap(
		(v) => {
			curY = v;
			writeSettle();
		},
		{ onSettled: axisSettled }
	);

	function clearVisuals() {
		if (settleChip) {
			settleChip.style.transform = '';
			settleChip.style.transition = '';
			settleChip.classList.remove('chip-dragging');
			settleChip = null;
		}
		if (chip) {
			chip.style.transform = '';
			chip.style.transition = '';
			chip.classList.remove('chip-dragging');
		}
		for (const s of slots) {
			s.el.style.transform = '';
			s.el.style.transition = '';
		}
	}

	function finishSettle() {
		if (!settling) return;
		settling = false;
		snapX.cancel();
		snapY.cancel();
		clearVisuals();
		slots = [];
		siblingCenters = [];
		// Fire the reorder only NOW: the host's re-render puts the chip in the slot the spring
		// just landed it on, so data and visuals change in the same frame — no teleport.
		const p = pendingReorder;
		pendingReorder = null;
		if (p) onReorder(p.from, p.to);
	}

	function startSettle(landX: number, landY: number, reorder: { from: number; to: number } | null) {
		settling = true;
		settleChip = chip;
		pendingReorder = reorder;
		axesSettled = 0;
		// curX/curY still hold the live drag offset; each spring seeds from there.
		snapX.snap(curX, landX);
		snapY.snap(curY, landY);
	}

	// Window safety net (quick-261102-settle parity): capture is taken on the CONTAINER, and
	// if it is lost or refused the container stops hearing the gesture — these listeners keep
	// tracking/releasing it. pointerId-filtered; node+window copies deduped in onMove.
	const win = () => (typeof window !== 'undefined' ? window : null);
	const winMove = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) onMove(e);
	};
	const winUp = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) onUp();
	};
	const winCancel = (e: PointerEvent) => {
		if (e.pointerId === activePointerId) onCancel();
	};
	const winBlur = () => onCancel();

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

	function draggableChip(e: PointerEvent): HTMLElement | null {
		const el = (e.target as HTMLElement | null)?.closest('[data-chip-index]');
		return el instanceof HTMLElement ? el : null;
	}

	function onDown(e: PointerEvent) {
		if (e.button != null && e.button !== 0) return;
		// A press during a drop settle commits the landed reorder instantly, so the geometry
		// measured for the new gesture is clean (no half-sprung transforms).
		if (settling) finishSettle();
		const c = draggableChip(e);
		if (!c) return;
		chip = c;
		fromIndex = Number(c.dataset.chipIndex);
		startX = e.clientX;
		startY = e.clientY;
		dragging = false;
		activePointerId = e.pointerId;
		lastMoveEvent = null;
		curX = 0;
		curY = 0;
		// NOTE: do NOT setPointerCapture here. Capturing on pointerdown retargets the trailing
		// `click` to the container, so a plain TAP never reaches the chip's onclick → the chip
		// could not be toggled off. Capture only once a DRAG actually starts (below).
	}

	/** Glide every sibling to the slot it will occupy if the drag drops at `targetIndex`. */
	function applyReflow() {
		for (const s of slots) {
			if (s.el === chip) continue;
			const dest = chipSlotForIndex(s.index, fromIndex, targetIndex);
			const ox = slots[dest].left - s.left;
			const oy = slots[dest].top - s.top;
			s.el.style.transform = ox !== 0 || oy !== 0 ? `translate(${ox}px, ${oy}px)` : '';
		}
	}

	function onMove(e: PointerEvent) {
		if (!chip) return;
		if (e === lastMoveEvent) return; // node + window copies of one event — process once
		lastMoveEvent = e;
		// A button-less move means the press ended somewhere we never saw — cancel home.
		if (dragging && e.buttons === 0) {
			onCancel();
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!dragging && Math.hypot(dx, dy) > THRESHOLD) {
			dragging = true;
			chip.classList.add('chip-dragging');
			// Measure slots BEFORE the first transform write (rects are layout truth here).
			slots = ([...node.querySelectorAll('[data-chip-index]')] as HTMLElement[])
				.map((s) => {
					const r = s.getBoundingClientRect();
					return {
						el: s,
						index: Number(s.dataset.chipIndex),
						left: r.left,
						top: r.top,
						cx: r.left + r.width / 2,
						cy: r.top + r.height / 2
					};
				})
				.sort((a, b) => a.index - b.index);
			siblingCenters = slots
				.filter((s) => s.el !== chip)
				.map((s) => ({ index: s.index, cx: s.cx, cy: s.cy }));
			targetIndex = fromIndex;
			// The dragged chip tracks the pointer with NO transition (glued, 1:1); siblings
			// get the glide so reflow slides instead of jumping (dropped under reduce-motion).
			chip.style.transition = 'none';
			for (const s of slots) {
				if (s.el !== chip) s.el.style.transition = settings.reduceMotion ? 'none' : SIBLING_GLIDE;
			}
			// Capture now (mid-drag) so pointer events keep flowing even past the container edge;
			// the post-drag click is suppressed in onUp, so retargeting is harmless here. The
			// call can throw for an inactive pointer — the window net then tracks instead.
			try {
				node.setPointerCapture?.(e.pointerId);
			} catch {
				/* window listeners below keep tracking — non-fatal */
			}
			armWindow();
		}
		if (dragging) {
			e.preventDefault();
			curX = dx;
			curY = dy;
			chip.style.transform = `translate(${dx}px, ${dy}px)`;
			const t = nearestChipIndex(e.clientX, e.clientY, siblingCenters, fromIndex);
			if (Number.isInteger(t) && t !== targetIndex) {
				targetIndex = t;
				applyReflow();
			}
		}
	}

	/** End the pointer phase: spring the chip into its landing slot (or home, when cancelled). */
	function endDrag(commit: boolean) {
		disarmWindow();
		if (commit && targetIndex !== fromIndex) {
			startSettle(
				slots[targetIndex].left - slots[fromIndex].left,
				slots[targetIndex].top - slots[fromIndex].top,
				{ from: fromIndex, to: targetIndex }
			);
		} else {
			startSettle(0, 0, null);
		}
		chip = null;
		dragging = false;
		fromIndex = -1;
		targetIndex = -1;
		activePointerId = -1;
	}

	function onUp() {
		if (!chip) return;
		if (!dragging) {
			// Plain tap — leave the click to the chip's onclick (tap-to-toggle).
			chip = null;
			fromIndex = -1;
			activePointerId = -1;
			return;
		}
		// Suppress the click that fires after a drag so tap-to-toggle doesn't run on drop.
		const suppress = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
			node.removeEventListener('click', suppress, true);
		};
		node.addEventListener('click', suppress, true);
		setTimeout(() => node.removeEventListener('click', suppress, true), 0);
		endDrag(true);
	}

	function onCancel() {
		if (!chip) return;
		if (!dragging) {
			chip = null;
			fromIndex = -1;
			activePointerId = -1;
			return;
		}
		// Cancel NEVER reorders: the chip springs back to its original slot (chipSlotForIndex
		// with target = from leaves every sibling at offset 0, cleared by the settle).
		endDrag(false);
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onCancel);
	node.addEventListener('lostpointercapture', onCancel);

	return {
		update(next: ChipReorderOpts) {
			onReorder = next.onReorder;
		},
		destroy() {
			disarmWindow();
			snapX.cancel();
			snapY.cancel();
			settling = false;
			pendingReorder = null; // dropped, not fired — the host is gone
			clearVisuals();
			chip = null;
			slots = [];
			siblingCenters = [];
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onCancel);
			node.removeEventListener('lostpointercapture', onCancel);
		}
	};
};
