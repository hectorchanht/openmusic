import { describe, it, expect } from 'vitest';
import { shouldSuppressClick } from './dragScroll';

// dragScroll is a pointer drag-to-scroll Svelte action (quick-260606-rvy FIX-B). Only the
// pure tap-vs-drag threshold helper is unit-tested here (the DOM pointer drag itself is
// exercised manually). shouldSuppressClick decides whether a release counts as a DRAG (so
// the following click is suppressed and a shelf-drag never plays a song) vs a TAP (let the
// tile onclick through). Mirrors the velocity.test.ts / identity.test.ts node style.
describe('shouldSuppressClick — drag-vs-tap threshold (FIX-B)', () => {
	it('a zero-movement release is a tap → no suppression', () => {
		expect(shouldSuppressClick(0)).toBe(false);
	});

	it('movement at/under the default 6px threshold is a tap → no suppression', () => {
		expect(shouldSuppressClick(5)).toBe(false);
		expect(shouldSuppressClick(6)).toBe(false); // equal = not past threshold
	});

	it('movement past the default threshold is a drag → suppress the click', () => {
		expect(shouldSuppressClick(7)).toBe(true);
	});

	it('uses absolute distance (a leftward drag suppresses too)', () => {
		expect(shouldSuppressClick(-20)).toBe(true);
	});

	it('respects a custom threshold', () => {
		expect(shouldSuppressClick(15, 20)).toBe(false);
		expect(shouldSuppressClick(25, 20)).toBe(true);
	});
});
