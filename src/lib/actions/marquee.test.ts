import { describe, it, expect } from 'vitest';
import { isOverflowing, marqueeState, marqueeDurationMs, MIN_OVERFLOW_PX } from './marquee';

// marquee is an overflow-detecting, reduced-motion-aware bounce Svelte action
// (quick-260606-rvy FIX-C). Only the pure overflow predicate is unit-tested here (the
// ResizeObserver / MutationObserver / matchMedia DOM wiring is exercised manually / via device
// UAT). isOverflowing decides whether a label's text is wider than its clipping box (→
// marquee-bounce) or fits (→ static ellipsis). Node-runnable, mirroring velocity.test.ts.
describe('isOverflowing — label overflow detection (FIX-C)', () => {
	it('content wider than the box overflows → marquee', () => {
		expect(isOverflowing(100, 80)).toBe(true);
	});

	it('content narrower than the box fits → static ellipsis', () => {
		expect(isOverflowing(80, 100)).toBe(false);
	});

	it('content exactly equal to the box fits (no marquee for an exact fit)', () => {
		expect(isOverflowing(80, 80)).toBe(false);
	});
});

// marqueeState is the pure core of the action's measure step. It turns a (content width, box
// width, reduced-motion) triple into the on/off + travel-distance decision. Extracted so the
// mobile regression (quick-260712-mkq) is guarded without a DOM: when a late i18n name swap
// widens the text past a FIXED box, the state must flip on. Only a MEANINGFUL overflow
// (> MIN_OVERFLOW_PX) turns on — a few px of clipping reads as a twitch, so it stays a static
// ellipsis.
describe('marqueeState — measure decision (quick-260712-mkq)', () => {
	it('meaningful overflow → on, dx = exact overflow distance', () => {
		const s = marqueeState(200, 120, false);
		expect(s.on).toBe(true);
		expect(s.dx).toBe(80);
	});

	it('content fits the box → off, dx 0', () => {
		expect(marqueeState(100, 120, false)).toEqual({ on: false, dx: 0, durationMs: 0 });
	});

	it('an overflowing state carries a proportional duration', () => {
		const s = marqueeState(720, 120, false); // overflow 600
		expect(s.on).toBe(true);
		expect(s.dx).toBe(600);
		expect(s.durationMs).toBe(marqueeDurationMs(600));
	});

	it('overflow at/below the twitch threshold stays off', () => {
		expect(marqueeState(120 + MIN_OVERFLOW_PX, 120, false).on).toBe(false);
		expect(marqueeState(120 + MIN_OVERFLOW_PX + 1, 120, false).on).toBe(true);
	});

	it('reduced motion is always off, even for a large overflow', () => {
		expect(marqueeState(400, 100, true)).toEqual({ on: false, dx: 0, durationMs: 0 });
	});

	// The regression itself: the box width never changed (120), only the CONTENT grew — from a
	// short original name that fit, to a translated name that overflows. The state must go on.
	// The action's width-gated ResizeObserver missed this; a MutationObserver now re-measures.
	it('content-only growth past a fixed box flips on (the mobile i18n regression)', () => {
		expect(marqueeState(110, 120, false).on).toBe(false); // original name fits
		expect(marqueeState(260, 120, false).on).toBe(true); // translated name overflows
	});
});

// marqueeDurationMs makes the scroll duration proportional to the overflow so every title moves
// at a constant, readable speed (quick-260712-5ll) — a long title no longer flies past too fast
// to read. Clamped at both ends so a tiny overflow is not jittery-fast and a huge one does not
// crawl forever.
describe('marqueeDurationMs — constant-speed, clamped (quick-260712-5ll)', () => {
	it('scales with overflow in the mid range', () => {
		// 2 * overflow / 120 px/s * 1000 = overflow * 16.666… ms
		expect(marqueeDurationMs(600)).toBe(10000);
		expect(marqueeDurationMs(900)).toBe(15000);
	});

	it('a bigger overflow never produces a shorter duration (monotonic)', () => {
		expect(marqueeDurationMs(700)).toBeGreaterThan(marqueeDurationMs(400));
	});

	it('clamps a tiny overflow up to the floor', () => {
		expect(marqueeDurationMs(40)).toBe(5000);
	});

	it('clamps a huge overflow down to the ceiling', () => {
		expect(marqueeDurationMs(5000)).toBe(20000);
	});
});
