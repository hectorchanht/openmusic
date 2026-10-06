// list-grow — pure arithmetic for "auto grow on scroll to bottom" lists.
//
// The shelf see-all pages (/charts/shelf/[kind]/[id]) fetch the WHOLE pool up front (up to
// POOL_CAP = 50 rows) and used to paint every row at once — 50 heavy SongRows mounting ~50
// swipe/marquee/tapBounce setups in one frame, which janks low-end phones. Instead the page
// paints the first LIST_GROW_PAGE rows and a sentinel at the list end appends one more page each
// time it scrolls into view (see use:growOnScroll in src/lib/actions/growOnScroll.ts), until the
// pool is exhausted. Nothing is ever fetched on grow — the data is already in memory; growth is
// render-only, so it also costs zero requests.
//
// Pure and DOM-free so it runs under this project's node-only Vitest, in the same shape as
// shelf-scroll.ts: the branchy part lives here with a test, the component stays a thin caller.

/** Rows painted on first paint; each scroll-to-bottom appends one more page of this size. */
export const LIST_GROW_PAGE = 20;

/** A count that survives garbage input: non-finite → 0, then floored. */
function safeCount(v: number): number {
	return Number.isFinite(v) ? Math.floor(v) : 0;
}

/**
 * Rows visible after one grow step: one more page, never past the total. `current` is clamped
 * into [0, total] first so a stale count can never overshoot the list or go negative; `page`
 * floors at 1 so a zero/negative page size still makes progress instead of stalling the sentinel.
 */
export function nextVisibleCount(current: number, total: number, page = LIST_GROW_PAGE): number {
	const safeTotal = Math.max(0, safeCount(total));
	const safeCurrent = Math.max(0, Math.min(safeCount(current), safeTotal));
	const safePage = Math.max(1, safeCount(page));
	return Math.min(safeTotal, safeCurrent + safePage);
}

/** Anything left to reveal? Drives the sentinel's presence (and the action's `enabled` flag). */
export function hasMore(current: number, total: number): boolean {
	return safeCount(current) < Math.max(0, safeCount(total));
}
