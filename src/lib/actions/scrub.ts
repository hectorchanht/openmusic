import type { Action } from 'svelte/action';

// use:scrub — press-and-drag horizontal seek (plan 002). The node is the FULL control (the
// `.scrubber` rail), so unlike coverSwipe/dragClose this DOES setPointerCapture on pointerdown:
// there is no child click to preserve, and capturing immediately gives 1:1 tracking even when the
// finger leaves the thin rail vertically. pointerdown also stopPropagation()s so the ancestor
// `.np-top` vertical-collapse handler never arms mid-scrub.
//
// Contract:
//  - pointerdown: capture, emit onScrubStart + onPreview(frac) synchronously (immediate feedback),
//    where frac = clamp((clientX - rect.left) / rect.width, 0, 1).
//  - pointermove (while down): emit onPreview(frac) every move — the host paints the preview.
//  - pointerup/cancel: emit onSeek(frac) (the single audio commit) then onScrubEnd. A pure tap
//    (down→up, no move) therefore still seeks to the tapped fraction.
//  - `enabled:false` makes it inert. update() swaps callbacks + enabled. destroy() releases a held
//    capture and detaches.
export interface ScrubOpts {
	/** Commit the seek (release / tap). frac is clamped 0..1. */
	onSeek: (frac: number) => void;
	/** Live preview during press+drag (also fires on the initial pointerdown). */
	onPreview?: (frac: number) => void;
	onScrubStart?: () => void;
	onScrubEnd?: () => void;
	enabled?: boolean;
}

export const scrub: Action<HTMLElement, ScrubOpts> = (node, opts) => {
	let onSeek = opts.onSeek;
	let onPreview = opts.onPreview;
	let onScrubStart = opts.onScrubStart;
	let onScrubEnd = opts.onScrubEnd;
	let enabled = opts.enabled ?? true;

	let dragging = false;
	let pointerId: number | null = null;

	function fracFrom(clientX: number): number {
		const r = node.getBoundingClientRect();
		if (r.width <= 0) return 0;
		const f = (clientX - r.left) / r.width;
		return f < 0 ? 0 : f > 1 ? 1 : f;
	}

	function down(e: PointerEvent) {
		if (!enabled) return;
		// Own the gesture: stop the ancestor .np-top collapse-drag from arming, capture so moves
		// keep flowing if the finger drifts off the thin rail, and emit immediate feedback.
		e.stopPropagation();
		dragging = true;
		pointerId = e.pointerId;
		try {
			node.setPointerCapture(e.pointerId);
		} catch {
			/* older UA — fine */
		}
		const f = fracFrom(e.clientX);
		onScrubStart?.();
		onPreview?.(f);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		onPreview?.(fracFrom(e.clientX));
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (pointerId !== null) {
			try {
				node.releasePointerCapture(pointerId);
			} catch {
				/* already released */
			}
			pointerId = null;
		}
		onSeek(fracFrom(e.clientX)); // single audio commit (tap or release)
		onScrubEnd?.();
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);

	return {
		update(next: ScrubOpts) {
			onSeek = next.onSeek;
			onPreview = next.onPreview;
			onScrubStart = next.onScrubStart;
			onScrubEnd = next.onScrubEnd;
			enabled = next.enabled ?? true;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			if (pointerId !== null) {
				try {
					node.releasePointerCapture(pointerId);
				} catch {
					/* fine */
				}
				pointerId = null;
			}
		}
	};
};
