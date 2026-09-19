// quick-260919-et3: geometry maths for the desktop shelves — the chevron step (<ShelfChevrons />)
// and the responsive grid-pager column count (<HomeGridPager />).
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

// --- grid-pager column maths (quick-260919-et3 follow-up) ----------------------------------
//
// <HomeGridPager /> used to be a hardcoded 3×3: three columns and nine tiles per snap page. At
// 1820px that left two thirds of the window empty. The grid now fits as many columns as the
// track is wide, which means the PAGE SIZE is no longer a constant — it is `cols × rows`, so the
// dot indicator keeps counting real pages instead of describing a 3×3 that no longer exists.

/** Rows per snap page. Unchanged from the original 3×3 — only the column count went responsive. */
export const GRID_ROWS_PER_PAGE = 3;

/**
 * Floor on the column count, and the value every phone resolves to. It is ALSO the mobile
 * guarantee: a tile needs GRID_TILE_MIN + GRID_GAP = 190px, so the formula below cannot reach 4
 * columns until the track is 750px wide. No phone gets there, so mobile stays at exactly the 3
 * columns it has always had — without this file knowing anything about the 1024px breakpoint.
 */
const GRID_MIN_COLS = 3;
/** Narrowest a cover tile is allowed to get before we stop adding columns. */
const GRID_TILE_MIN = 180;
/** Must match the `.page` grid-gap in HomeGridPager.svelte. */
const GRID_GAP = 10;

/** How many columns fit in a `width`px grid track. Never fewer than GRID_MIN_COLS. */
export function gridColumns(width: number): number {
	if (unmeasured(width)) return GRID_MIN_COLS;
	return Math.max(GRID_MIN_COLS, Math.floor((width + GRID_GAP) / (GRID_TILE_MIN + GRID_GAP)));
}
