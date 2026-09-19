// quick-260919-et3: step maths for the desktop shelf chevrons (<ShelfChevrons />).
//
// Pure, DOM-free and dependency-free so it runs under this project's node-only Vitest, in the
// same shape as dragScroll.ts's shouldSuppressClick: the branchy part lives here with a test, the
// component stays a thin caller that reads scrollLeft/clientWidth/scrollWidth off an element.

/** Which chevron was pressed. Names match the i18n keys the buttons reuse (D-10). */
export type ShelfDir = 'prev' | 'next';

/** One press moves 80% of a viewport-width — a page-ish jump that leaves a column of context. */
const STEP_RATIO = 0.8;

/**
 * Sub-pixel tolerance for "am I at an end?". Browsers report fractional scrollLeft on zoomed and
 * HiDPI displays, so an exact comparison leaves the forward chevron enabled forever at the
 * right-hand end, clickable and inert.
 */
const EDGE_EPSILON = 1;

/** Furthest scrollLeft the element can reach, or 0 when the content already fits. */
function maxScrollLeft(clientWidth: number, scrollWidth: number): number {
	return Math.max(0, scrollWidth - clientWidth);
}

/** An element that has not been laid out yet (width 0, or NaN from an unmounted read). */
function unmeasured(clientWidth: number): boolean {
	return !Number.isFinite(clientWidth) || clientWidth <= 0;
}

/**
 * Clamped target offset for one chevron press. Returns `scrollLeft` unchanged when the element is
 * unmeasured, so an early click can never jump a shelf to a nonsense position.
 */
export function nextScrollLeft(
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
	dir: ShelfDir
): number {
	if (unmeasured(clientWidth)) return scrollLeft;
	const step = clientWidth * STEP_RATIO;
	const target = dir === 'next' ? scrollLeft + step : scrollLeft - step;
	return Math.min(Math.max(0, target), maxScrollLeft(clientWidth, scrollWidth));
}

/** Is there anywhere left to go in `dir`? Drives the chevron's `disabled` state. */
export function canScroll(
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
	dir: ShelfDir
): boolean {
	if (unmeasured(clientWidth)) return false;
	const max = maxScrollLeft(clientWidth, scrollWidth);
	if (max <= 0) return false;
	return dir === 'next' ? scrollLeft < max - EDGE_EPSILON : scrollLeft > EDGE_EPSILON;
}
