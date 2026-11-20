import { describe, it, expect } from 'vitest';
import { LIST_GROW_PAGE, nextVisibleCount, hasMore } from './list-grow';

// The grow maths behind the shelf see-all pages' "auto grow on scroll to bottom", extracted pure
// so the branchy bit is testable without a DOM (this project's Vitest is node-only). Mirrors the
// shelf-scroll.test.ts shape: one runnable check left behind on a non-trivial helper.

describe('nextVisibleCount — one grow step', () => {
	it('appends exactly one page', () => {
		expect(nextVisibleCount(20, 50)).toBe(40);
	});

	it('never grows past the total', () => {
		expect(nextVisibleCount(40, 50)).toBe(50);
		expect(nextVisibleCount(50, 50)).toBe(50);
	});

	it('clamps a stale current that overshoots the total', () => {
		expect(nextVisibleCount(80, 50)).toBe(50);
	});

	it('a non-positive page size still makes progress instead of stalling', () => {
		expect(nextVisibleCount(20, 50, 0)).toBe(21);
		expect(nextVisibleCount(20, 50, -5)).toBe(21);
	});

	it('honours a custom page size', () => {
		expect(nextVisibleCount(0, 100, 30)).toBe(30);
	});

	it('treats garbage input as empty rather than NaN-ing the count', () => {
		expect(nextVisibleCount(NaN, 50)).toBe(LIST_GROW_PAGE);
		expect(nextVisibleCount(20, NaN)).toBe(0);
		expect(nextVisibleCount(-3, 50)).toBe(LIST_GROW_PAGE);
		expect(nextVisibleCount(20, -10)).toBe(0);
	});
});

describe('hasMore — is there anything left to reveal', () => {
	it('true while rows remain hidden', () => {
		expect(hasMore(20, 50)).toBe(true);
	});

	it('false once the whole pool is shown', () => {
		expect(hasMore(50, 50)).toBe(false);
		expect(hasMore(0, 0)).toBe(false);
	});

	it('false when the current count overshoots a shrunk pool', () => {
		expect(hasMore(60, 50)).toBe(false);
	});
});
