import type { Action } from 'svelte/action';
import { settings } from '$lib/stores/settings.svelte';

// use:dragReorder — pointer/TOUCH vertical drag-to-REORDER for a list container
// (quick-260606-w87). Mirrors dragScroll's shape (typed Action, returns {update,destroy},
// NO npm dep), but where dragScroll preserves native touch scroll, the reorder HANDLE owns
// the gesture: each row carries `data-reorder-index`, the grab affordance inside it carries
// `data-reorder-handle` and gets `touch-action:none` so a vertical drag reorders rather
// than scrolls the page. On release the action fires `onReorder(from, to)`; the page mutates
// settings.homeSectionOrder + saves.
//
// Reduced motion: any row-glide transform/transition is gated on settings.reduceMotion OR
// the prefers-reduced-motion media query — when reduced, the drag still works, just without
// the animated lift/glide.
//
// The DOM-bound part is intentionally thin; the LOAD-BEARING, unit-tested logic is the pure
// index math in computeDropIndex (see dragReorder.test.ts).

/**
 * Pure: given the live pointer Y (relative to the same coordinate space as `rowTops`), each
 * row's top offset + height, and the index being dragged, return the target drop index.
 * Compares the pointer against each row's span and clamps to [0, n-1]. A pointer resting in
 * the dragged row's own span returns `from` (a no-op move). Degrades to `from` for empty
 * geometry (never NaN). Exported for unit testing the threshold math in isolation.
 */
export function computeDropIndex(
	pointerY: number,
	rowTops: number[],
	rowHeights: number[],
	from: number
): number {
	const n = rowTops.length;
	if (n === 0) return from;
	// Above the first row → first slot.
	if (pointerY < rowTops[0]) return 0;
	// Within some row's span → that row's slot.
	for (let i = 0; i < n; i++) {
		const top = rowTops[i];
		const bottom = top + (rowHeights[i] ?? 0);
		if (pointerY >= top && pointerY < bottom) return i;
	}
	// Below the last row → last slot.
	return n - 1;
}

export interface DragReorderOpts {
	/** Fired on a release that lands on a different index. `from`/`to` are list indices. */
	onReorder: (from: number, to: number) => void;
	/** When false the action is inert (no drag). Default true. */
	enabled?: boolean;
}

/** Does the user (setting OR OS) want reduced motion? Browser-guarded. */
function reduced(): boolean {
	if (settings.reduceMotion) return true;
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

export const dragReorder: Action<HTMLElement, DragReorderOpts> = (node, opts) => {
	let onReorder = opts.onReorder;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let fromIndex = -1;
	let draggedRow: HTMLElement | null = null;

	/** Read each direct child row's top/height in the SAME coordinate space (viewport). */
	function measure(): { tops: number[]; heights: number[]; rows: HTMLElement[] } {
		const rows = Array.from(
			node.querySelectorAll<HTMLElement>('[data-reorder-index]')
		);
		const tops: number[] = [];
		const heights: number[] = [];
		for (const r of rows) {
			const rect = r.getBoundingClientRect();
			tops.push(rect.top);
			heights.push(rect.height);
		}
		return { tops, heights, rows };
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		const handle = (e.target as HTMLElement | null)?.closest('[data-reorder-handle]');
		if (!handle || !node.contains(handle)) return;
		const rowEl = handle.closest('[data-reorder-index]') as HTMLElement | null;
		if (!rowEl) return;
		const idxAttr = rowEl.getAttribute('data-reorder-index');
		if (idxAttr === null) return;
		fromIndex = Number(idxAttr);
		if (!Number.isInteger(fromIndex)) {
			fromIndex = -1;
			return;
		}
		dragging = true;
		draggedRow = rowEl;
		// Capture the pointer so move/up fire even if the finger leaves the handle.
		try {
			handle.setPointerCapture?.(e.pointerId);
		} catch {
			/* setPointerCapture can throw on some engines — non-fatal */
		}
		// Visual lift, unless reduced motion (drag still works either way).
		if (!reduced()) {
			draggedRow.style.opacity = '0.6';
		}
		e.preventDefault();
	}

	function move(e: PointerEvent) {
		if (!dragging) return;
		e.preventDefault(); // we own the vertical gesture (touch-action:none on the handle)
	}

	function up(e: PointerEvent, commit = true) {
		if (!dragging) return;
		dragging = false;
		const { tops, heights } = measure();
		const to = computeDropIndex(e.clientY, tops, heights, fromIndex);
		if (draggedRow) {
			draggedRow.style.opacity = '';
			draggedRow = null;
		}
		const from = fromIndex;
		fromIndex = -1;
		// quick-261102-u05 (DECISIONS.md §12): a cancel never reorders (it used to commit with the cancel event's coordinates).
		if (commit && from >= 0 && to !== from) onReorder(from, to);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	const cancel = (e: PointerEvent) => up(e, false);
	node.addEventListener('pointercancel', cancel);

	return {
		update(next: DragReorderOpts) {
			onReorder = next.onReorder;
			enabled = next.enabled ?? true;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
		}
	};
};
