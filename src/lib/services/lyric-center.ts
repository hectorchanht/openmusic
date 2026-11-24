/**
 * quick-261123-lyricspin (Hector 2026-11-23 21:36): PIN THE ACTIVE LYRIC LINE AT THE MIDDLE.
 *
 * Pure scroll-target maths for the Now Playing lyrics pane (NpLyrics.svelte). The pane's
 * invariant is that the active line's CENTRE sits on the visible band's CENTRE:
 *
 *   scrollTop = activeLineCenter − viewportHeight / 2   (clamped to the scrollable range)
 *
 * where `activeLineCenter` is the line's centre in container scroll-space and
 * `viewportHeight` is the VISIBLE band height (the `.panel` slice intersecting the
 * viewport, below the sticky sync row). `viewportTopOffset` is that band's top in
 * container-local coords, so the target is the band centre, not the raw scroller centre —
 * in the HALF sheet the container spans the full viewport while only its lower slice is
 * visible, and centring on the raw scroller would park the line below the fold.
 *
 * Clamping is the browser's own range: [0, maxScrollTop]. The head/tail padding the pane
 * writes (lyricAnchorMetrics at 50%) makes the first/last lines REACHABLE at the centre,
 * but the clamp stays as the guard for any geometry where they cannot (short lyric,
 * mid-transition measurements, a band taller than the content).
 *
 * DOM-free and store-free so the maths is node-testable (lyric-center.test.ts), following
 * the repo's pure-function extraction convention. Every input is sanitised to a finite,
 * non-negative value first: these are live DOM measurements, and a mid-transition read
 * must never produce NaN or a negative scroll target.
 */
export function centeredScrollTop(m: {
	/** Line top in container scroll-space (offsetWithin). */
	lineTop: number;
	/** The line's own height (offsetHeight). */
	lineHeight: number;
	/** Visible band height (visHeight). */
	viewportHeight: number;
	/** Visible band top in container-local coords (visTopWithin). Default 0. */
	viewportTopOffset?: number;
	/** Maximum legal scrollTop: scrollHeight − clientHeight. */
	maxScrollTop: number;
}): number {
	const fin = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
	const lineCenter = fin(m.lineTop) + fin(m.lineHeight) / 2;
	const bandCenter = fin(m.viewportTopOffset ?? 0) + fin(m.viewportHeight) / 2;
	const max = fin(m.maxScrollTop);
	return Math.min(max, Math.max(0, lineCenter - bandCenter));
}
