import { describe, it, expect } from 'vitest';
import { nextScrollLeft, canScroll, gridColumns, GRID_ROWS_PER_PAGE } from './shelf-scroll';

// quick-260919-et3: the step maths behind the desktop shelf chevrons, extracted pure so the one
// branchy bit of that component is testable without a DOM (this project's Vitest is node-only).
// Mirrors dragScroll.ts's exported shouldSuppressClick + co-located test — the established shape
// here for "leave one runnable check behind" on a non-trivial helper.

describe('nextScrollLeft — one chevron press', () => {
	it('steps forward by 80% of the viewport width', () => {
		expect(nextScrollLeft(0, 1000, 5000, 'next')).toBe(800);
	});

	it('steps backward by the same amount', () => {
		expect(nextScrollLeft(800, 1000, 5000, 'prev')).toBe(0);
	});

	it('never scrolls past the end', () => {
		// 4500 + 800 would be 5300; the maximum offset is scrollWidth - clientWidth = 4000.
		expect(nextScrollLeft(4500, 1000, 5000, 'next')).toBe(4000);
	});

	it('never scrolls before the start', () => {
		expect(nextScrollLeft(200, 1000, 5000, 'prev')).toBe(0);
	});

	it('returns 0 both ways when the content already fits', () => {
		expect(nextScrollLeft(0, 1000, 600, 'next')).toBe(0);
		expect(nextScrollLeft(0, 1000, 600, 'prev')).toBe(0);
	});

	it('returns the input untouched for an unmeasured element (no crash, no jump)', () => {
		expect(nextScrollLeft(120, 0, 5000, 'next')).toBe(120);
		expect(nextScrollLeft(120, Number.NaN, 5000, 'prev')).toBe(120);
	});
});

describe('canScroll — chevron enabled state', () => {
	it('is false backward at the start and false forward at the end', () => {
		expect(canScroll(0, 1000, 5000, 'prev')).toBe(false);
		expect(canScroll(4000, 1000, 5000, 'next')).toBe(false);
	});

	it('is true in both directions mid-shelf', () => {
		expect(canScroll(2000, 1000, 5000, 'prev')).toBe(true);
		expect(canScroll(2000, 1000, 5000, 'next')).toBe(true);
	});

	it('is false both ways when the content fits', () => {
		expect(canScroll(0, 1000, 600, 'prev')).toBe(false);
		expect(canScroll(0, 1000, 600, 'next')).toBe(false);
	});

	it('treats a sub-pixel remainder as "at the end" (fractional scrollLeft is normal)', () => {
		// Browsers report fractional scrollLeft on zoomed/HiDPI displays; without a tolerance the
		// forward chevron would stay enabled forever at the right-hand end and do nothing on click.
		expect(canScroll(3999.6, 1000, 5000, 'next')).toBe(false);
		expect(canScroll(0.4, 1000, 5000, 'prev')).toBe(false);
	});

	it('is false for an unmeasured element', () => {
		expect(canScroll(0, 0, 5000, 'next')).toBe(false);
		expect(canScroll(0, Number.NaN, 5000, 'prev')).toBe(false);
	});
});

// The grid pager's responsive column count. The load-bearing assertion is the MOBILE one: the
// user asked for a wide desktop grid, and the acceptance condition was that phones keep the exact
// 3×3 they have today. That is a property of this function alone, so it is checked here.
describe('gridColumns — responsive grid-pager columns', () => {
	it('stays at 3 columns for every phone-width track', () => {
		// 320px (iPhone SE) through 430px (Pro Max), minus the page's 16px side padding.
		for (const w of [288, 343, 358, 398, 430]) {
			expect(gridColumns(w)).toBe(3);
		}
	});

	it('stays at 3 columns through tablet portrait, so nothing below the desktop rail changes', () => {
		expect(gridColumns(736)).toBe(3); // 768px viewport
		expect(gridColumns(749)).toBe(3); // last width that still fits only 3
	});

	it('adds columns once tiles would otherwise exceed the minimum size', () => {
		expect(gridColumns(750)).toBe(4);
		expect(gridColumns(888)).toBe(4); // 1024px viewport minus the 88px rail and padding
		expect(gridColumns(1684)).toBe(8); // ~1820px desktop, the width in the report
	});

	it('falls back to 3 for an unmeasured track rather than collapsing to one column', () => {
		expect(gridColumns(0)).toBe(3);
		expect(gridColumns(Number.NaN)).toBe(3);
	});

	it('derives an honest page size from the columns (this is what the dots count)', () => {
		expect(gridColumns(343) * GRID_ROWS_PER_PAGE).toBe(9); // unchanged 3x3 on mobile
		expect(gridColumns(1684) * GRID_ROWS_PER_PAGE).toBe(24);
	});
});
