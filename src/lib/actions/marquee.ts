import type { Action } from 'svelte/action';

// use:marquee — marquee-bounce a label whose text overflows its box (quick-260606-rvy FIX-C).
//
// Discovery tile titles/artists (.al-name / .al-count) are nowrap+ellipsis clipped boxes. When
// the text is wider than the box this action reveals the hidden tail by bounce-scrolling it
// (a CSS keyframe in the consuming component, keyed off the `.marquee-on` class this action
// adds + the `--marquee-dx` custom property it sets to the exact overflow distance). When the
// text fits, the class is removed → the default static ellipsis stays.
//
// SSR-SAFE: all DOM/observer/matchMedia access is guarded behind `typeof` checks so the action
// is a no-op on the server. REDUCED-MOTION: when the user prefers reduced motion we never add
// the class (static ellipsis), as defense-in-depth alongside the component's @media gate.
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

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

// Marquee tuning. MIN_OVERFLOW_PX: below this much clipping, don't animate (static ellipsis —
// a 2-3px crawl reads as a twitch). The CSS owns the scroll timing (a fixed 8s loop).
export const MIN_OVERFLOW_PX = 8;

export interface MarqueeState {
	/** true → add `.marquee-on` and scroll; false → static ellipsis. */
	on: boolean;
	/** exact overflow distance the text must travel to reveal its tail (px). 0 when off. */
	dx: number;
}

/**
 * Pure core of the measure step. Given the clip element's content width (`scrollWidth`) and
 * visible box width (`clientWidth`), decide whether to marquee and by how far. A MEANINGFUL
 * overflow (> MIN_OVERFLOW_PX) turns the marquee on with `dx` = the exact overflow distance; a
 * fit, a sub-threshold clip, or reduced-motion keeps it off (static ellipsis). Exported so the
 * decision is unit-testable without a DOM — in particular the quick-260712-mkq regression where
 * a late content change widens the text past a FIXED box (box width never changes, only the
 * text) must still flip `on` true.
 */
export function marqueeState(scrollWidth: number, clientWidth: number, reducedMotion: boolean): MarqueeState {
	// Reduced-motion users always get the static ellipsis.
	if (reducedMotion) return { on: false, dx: 0 };
	const overflow = scrollWidth - clientWidth;
	// Only animate a MEANINGFUL overflow. A few px of clipping is not worth a marquee and reads
	// as a twitch; below the threshold keep the static ellipsis.
	return overflow > MIN_OVERFLOW_PX ? { on: true, dx: overflow } : { on: false, dx: 0 };
}

export const marquee: Action<HTMLElement> = (node) => {
	let resizeObs: ResizeObserver | null = null;
	let mutationObs: MutationObserver | null = null;

	function measure() {
		const { on, dx } = marqueeState(node.scrollWidth, node.clientWidth, prefersReducedMotion());
		if (on) {
			node.style.setProperty('--marquee-dx', `${dx}px`);
			node.classList.add('marquee-on');
		} else {
			node.classList.remove('marquee-on');
			node.style.removeProperty('--marquee-dx');
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
