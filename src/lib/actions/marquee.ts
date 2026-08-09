import type { Action } from 'svelte/action';

// use:marquee — marquee-bounce a label whose text overflows its box (quick-260606-rvy FIX-C).
//
// Discovery tile titles/artists (.al-name / .al-count) are nowrap+ellipsis clipped boxes. When
// the text is wider than the box this action reveals the hidden tail by bounce-scrolling it
// (a CSS keyframe in the consuming component, keyed off the `.marquee-on` class this action
// adds + the `--marquee-dx` custom property it sets to the exact overflow distance). When the
// text fits, the class is removed → the default static ellipsis stays.
//
// SSR-SAFE: all DOM/observer access is guarded behind `typeof` checks so the action is a no-op on
// the server. REDUCED-MOTION: the marquee is deliberately EXEMPT (quick-260809-mvz). It used to
// bail on `prefers-reduced-motion: reduce`, which froze every clipped title on Android — the OS
// reports `reduce` for battery saver and for Developer Options → animation scale off, neither of
// which is an accessibility request. A static clipped title is unreadable, so the scroll is
// functional, not decoration. app.css keeps it running under the app's own reduce-motion setting too.
//
// RE-MEASURE TRIGGERS: a ResizeObserver re-measures on box-WIDTH changes (container resize,
// orientation, font-size setting) and a MutationObserver re-measures on TEXT changes — see the
// wiring below for why both are needed (quick-260712-mkq).

/**
 * Pure helper: is the content (`scrollWidth`) wider than the visible box (`clientWidth`)?
 * Strict `>` so an exact fit does NOT marquee. Exported for unit testing in isolation.
 */
export function isOverflowing(scrollWidth: number, clientWidth: number): boolean {
	return scrollWidth > clientWidth;
}

// Marquee tuning. MIN_OVERFLOW_PX: below this much clipping, don't animate (static ellipsis —
// a 2-3px crawl reads as a twitch).
export const MIN_OVERFLOW_PX = 8;

// quick-260712-5ll: the scroll duration is now PROPORTIONAL to the overflow so every title
// travels at a constant, READABLE speed (a fixed 8s loop made a long title fly past too fast to
// read — the full text technically scrolled by but you couldn't take it in). The keyframe spends
// half the cycle scrolling (25%→75%) and a quarter holding at each end, so a full cycle that
// scrolls `overflow` px at SCROLL_SPEED_PX_PER_S is `2 * overflow / SPEED`. Clamped so short
// overflows are not jittery-fast and very long ones do not crawl forever.
const SCROLL_SPEED_PX_PER_S = 120;
const MIN_DURATION_MS = 5000;
const MAX_DURATION_MS = 20000;

/** Full-cycle animation duration (ms) for a given overflow — constant scroll speed, clamped. */
export function marqueeDurationMs(overflow: number): number {
	const cycleMs = (2 * overflow) / SCROLL_SPEED_PX_PER_S * 1000;
	return Math.round(Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, cycleMs)));
}

export interface MarqueeState {
	/** true → add `.marquee-on` and scroll; false → static ellipsis. */
	on: boolean;
	/** exact overflow distance the text must travel to reveal its tail (px). 0 when off. */
	dx: number;
	/** full-cycle animation duration in ms (constant scroll speed); 0 when off. */
	durationMs: number;
}

/**
 * Pure core of the measure step. Given the clip element's content width (`scrollWidth`) and
 * visible box width (`clientWidth`), decide whether to marquee and by how far. A MEANINGFUL
 * overflow (> MIN_OVERFLOW_PX) turns the marquee on with `dx` = the exact overflow distance; a fit
 * or a sub-threshold clip keeps it off (static ellipsis). Overflow is now the ONLY input — the
 * reduced-motion argument was dropped in quick-260809-mvz (see the header note). Exported so the
 * decision is unit-testable without a DOM — in particular the quick-260712-mkq regression where
 * a late content change widens the text past a FIXED box (box width never changes, only the
 * text) must still flip `on` true.
 */
export function marqueeState(scrollWidth: number, clientWidth: number): MarqueeState {
	const overflow = scrollWidth - clientWidth;
	// Only animate a MEANINGFUL overflow. A few px of clipping is not worth a marquee and reads
	// as a twitch; below the threshold keep the static ellipsis.
	return overflow > MIN_OVERFLOW_PX
		? { on: true, dx: overflow, durationMs: marqueeDurationMs(overflow) }
		: { on: false, dx: 0, durationMs: 0 };
}

export const marquee: Action<HTMLElement> = (node) => {
	let resizeObs: ResizeObserver | null = null;
	let mutationObs: MutationObserver | null = null;

	function measure() {
		const { on, dx, durationMs } = marqueeState(node.scrollWidth, node.clientWidth);
		if (on) {
			node.style.setProperty('--marquee-dx', `${dx}px`);
			node.style.setProperty('--marquee-dur', `${durationMs}ms`);
			node.classList.add('marquee-on');
		} else {
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
			node.style.removeProperty('--marquee-dur');
		}
	}

	function remeasure() {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
		else measure();
	}

	// Initial measure (after the current frame so layout/fonts have settled when possible).
	remeasure();

	// Re-measure on box-WIDTH change (container resize, orientation, font-size setting), but ONLY
	// when the box width actually changed. Re-measuring on every observer callback (incl.
	// sub-pixel/height churn while the animation runs) would remove+re-add .marquee-on and restart
	// the animation → a visible twitch. The transform-based scroll animation changes no layout
	// width, so it never trips this guard.
	if (typeof ResizeObserver !== 'undefined') {
		let lastWidth = -1;
		resizeObs = new ResizeObserver((entries) => {
			const w = Math.round(entries[0]?.contentRect?.width ?? node.clientWidth);
			if (w === lastWidth) return;
			lastWidth = w;
			measure();
		});
		resizeObs.observe(node);
	}

	// quick-260712-mkq: re-measure when the label's TEXT changes. names.dnTitle/dnArtist return
	// the ORIGINAL name synchronously, then swap in the translated name ~200-800ms later (the
	// names store bumps `rev`; the text node inside .marquee-inner is replaced WITHOUT a {#key}
	// remount, since the track uid is unchanged), which widens/narrows the content while the box
	// width stays fixed. The width-gated ResizeObserver above never fires for a content-only
	// change, so on mobile — where the narrow box makes the post-translation name overflow far
	// more often than on desktop — the marquee stayed OFF ("not running when text longer than the
	// view width"). A MutationObserver on the text catches every content change. It only watches
	// childList/characterData (NOT attributes), so measure()'s own class/style writes to `node`
	// never re-trigger it (no loop); and a text swap is never mid-animation, so it cannot cause a
	// restart twitch.
	if (typeof MutationObserver !== 'undefined') {
		mutationObs = new MutationObserver(remeasure);
		mutationObs.observe(node, { childList: true, characterData: true, subtree: true });
	}

	return {
		destroy() {
			resizeObs?.disconnect();
			mutationObs?.disconnect();
			resizeObs = null;
			mutationObs = null;
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
		}
	};
};
