import { describe, expect, it } from 'vitest';
import { centeredScrollTop } from '$lib/services/lyric-center';

// quick-261123-lyricspin: failing-if-broken regression pin for the middle-pin invariant —
// the active lyric line's centre lands on the visible band's centre:
//   scrollTop = activeLineCenter − viewportHeight / 2, clamped to [0, maxScrollTop].
describe('centeredScrollTop (lyric middle-pin)', () => {
	it('centres a mid-song line: scrollTop = lineCenter − viewportHeight/2', () => {
		// Line top 1000, height 40 → centre 1020; band 600 tall → target 1020 − 300.
		expect(
			centeredScrollTop({ lineTop: 1000, lineHeight: 40, viewportHeight: 600, maxScrollTop: 5000 })
		).toBe(720);
	});

	it('centres relative to the VISIBLE band, not the raw scroller (half-sheet offset)', () => {
		// Band starts 200px into the container and is 400 tall → band centre at 400.
		// Line centre 1020 → target 620.
		expect(
			centeredScrollTop({
				lineTop: 1000,
				lineHeight: 40,
				viewportHeight: 400,
				viewportTopOffset: 200,
				maxScrollTop: 5000
			})
		).toBe(620);
	});

	it('clamps the first lines to 0 (centre above the band centre cannot scroll negative)', () => {
		expect(
			centeredScrollTop({ lineTop: 20, lineHeight: 40, viewportHeight: 600, maxScrollTop: 5000 })
		).toBe(0);
		expect(
			centeredScrollTop({ lineTop: 0, lineHeight: 30, viewportHeight: 600, maxScrollTop: 5000 })
		).toBe(0);
	});

	it('clamps the last lines to maxScrollTop', () => {
		// Line centre 5020 − 300 = 4720, but the scroller can only reach 4400.
		expect(
			centeredScrollTop({ lineTop: 5000, lineHeight: 40, viewportHeight: 600, maxScrollTop: 4400 })
		).toBe(4400);
	});

	it('initial load mid-playback: positions at the CURRENT active line centre immediately', () => {
		// Lyrics finish loading at ~90s into a song whose active line sits deep in the
		// scroll space (top 2600, height 36 → centre 2618; band 520 → target 2358).
		// The pane's first scroll for a fresh line set must be exactly this target —
		// not 0 (top-anchored) with a later correction.
		expect(
			centeredScrollTop({ lineTop: 2600, lineHeight: 36, viewportHeight: 520, maxScrollTop: 4000 })
		).toBe(2358);
	});

	it('never returns NaN or a negative for degenerate measurements', () => {
		expect(
			centeredScrollTop({ lineTop: NaN, lineHeight: NaN, viewportHeight: NaN, maxScrollTop: NaN })
		).toBe(0);
		expect(
			centeredScrollTop({ lineTop: -50, lineHeight: 40, viewportHeight: 600, maxScrollTop: -10 })
		).toBe(0);
	});
});
