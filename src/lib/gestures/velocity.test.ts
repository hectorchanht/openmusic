import { describe, it, expect } from 'vitest';
import { createVelocityTracker } from './velocity';

// Synthetic numeric timeStamps only (NO Date.now / performance.now) so the math is
// deterministic and SSR-safe. Velocity is px/ms: positive = DOWN (clientY ↑), negative = UP.
describe('createVelocityTracker', () => {
	it('Test 1: two samples 100px apart over 100ms → ~+1.0 px/ms (down)', () => {
		const v = createVelocityTracker();
		v.sample(0, 0);
		v.sample(100, 100);
		expect(v.velocity()).toBeCloseTo(1.0, 5);
	});

	it('Test 2: upward motion (clientY decreasing) → negative velocity', () => {
		const v = createVelocityTracker();
		v.sample(200, 0);
		v.sample(100, 100); // moved UP 100px in 100ms
		expect(v.velocity()).toBeCloseTo(-1.0, 5);
		expect(v.velocity()).toBeLessThan(0);
	});

	it('Test 3: fewer than 2 samples → velocity() === 0', () => {
		const v = createVelocityTracker();
		expect(v.velocity()).toBe(0); // zero samples
		v.sample(50, 10);
		expect(v.velocity()).toBe(0); // one sample
	});

	it('Test 4: delta-t === 0 between the last two samples → 0 (no Infinity / NaN)', () => {
		const v = createVelocityTracker();
		v.sample(0, 50);
		v.sample(100, 50); // identical timestamp
		const result = v.velocity();
		expect(result).toBe(0);
		expect(Number.isFinite(result)).toBe(true);
		expect(Number.isNaN(result)).toBe(false);
	});

	it('Test 5: reset() clears history → velocity() back to 0', () => {
		const v = createVelocityTracker();
		v.sample(0, 0);
		v.sample(100, 100);
		expect(v.velocity()).toBeCloseTo(1.0, 5);
		v.reset();
		expect(v.velocity()).toBe(0);
		v.sample(0, 0); // one fresh sample → still 0
		expect(v.velocity()).toBe(0);
	});

	it('Test 6: only the most recent points are used (old far-apart sample does not skew)', () => {
		const v = createVelocityTracker();
		// An old, slow sample far back in time...
		v.sample(0, 0);
		v.sample(10, 1000); // 0.01 px/ms over the old leg
		// ...then a fresh fast flick. The reading must reflect the LAST two points only.
		v.sample(10, 1010);
		v.sample(110, 1020); // +100px / 10ms = +10 px/ms
		expect(v.velocity()).toBeCloseTo(10.0, 5);
	});
});
