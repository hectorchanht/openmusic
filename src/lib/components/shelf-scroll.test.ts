import { describe, it, expect } from 'vitest';
import { nextScrollLeft, canScroll } from './shelf-scroll';

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
