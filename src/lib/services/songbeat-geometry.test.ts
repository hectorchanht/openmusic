// GROW-OUT geometry pins (Hector 2026-11-23 22:09, standing law — NO SILENT BREAKAGE).
// The shared skeleton every Song Beat skin renders by: a note starts INSIDE its hit
// box, GROWS outward, crosses the border and continues outside; inside travel equals
// outside travel; the border crossing IS the perfect moment. These pins FAIL if any
// skin or core change reverts to shrink-in / fall-to-a-line asymmetry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { growOut, judgeDelta } from './songbeat';

const APPROACH = 1.6;

describe('grow-out geometry — symmetry around the border', () => {
	it('distance from the border is EQUAL at equal time offsets before/after perfect', () => {
		for (const d of [0.02, 0.07, 0.13, 0.2, 0.5, 1.0, 1.6]) {
			const before = growOut(-d, APPROACH);
			const after = growOut(d, APPROACH);
			expect(after.borderDistance).toBeCloseTo(before.borderDistance, 10);
			expect(after.offset).toBeCloseTo(-before.offset, 10);
			// Mirror travel: growth past the border equals shrink… no — growth INSIDE
			// the border at −d is exactly as far from the border as growth OUTSIDE at +d.
			expect(1 - before.scale).toBeCloseTo(after.scale - 1, 10);
		}
	});

	it('starts as a point inside the box, reaches the border at 0, doubles at the mirror end', () => {
		expect(growOut(-APPROACH, APPROACH).scale).toBeCloseTo(0, 10);
		expect(growOut(0, APPROACH).scale).toBe(1);
		expect(growOut(APPROACH, APPROACH).scale).toBeCloseTo(2, 10);
		// Growth is monotonic in time — a note never shrinks.
		let prev = -Infinity;
		for (let dt = -APPROACH; dt <= APPROACH; dt += 0.1) {
			const sc = growOut(dt, APPROACH).scale;
			expect(sc).toBeGreaterThan(prev);
			prev = sc;
		}
	});

	it('the approach window scales the geometry (faster approach = faster growth)', () => {
		expect(growOut(-0.8, 1.6).borderDistance).toBeCloseTo(growOut(-0.4, 0.8).borderDistance, 10);
		expect(growOut(-0.8, 1.6).borderDistance).toBeCloseTo(0.5, 10);
	});
});

describe('grow-out geometry — border alignment IS perfect judgment', () => {
	it('offset 0 (border alignment) is the perfect moment, and only that moment', () => {
		expect(growOut(0, APPROACH).atBorder).toBe(true);
		expect(growOut(0, APPROACH).phase).toBe('perfect');
		expect(judgeDelta(0)).toBe('perfect');
		expect(growOut(-0.01, APPROACH).atBorder).toBe(false);
		expect(growOut(0.01, APPROACH).atBorder).toBe(false);
	});

	it('judgment windows are symmetric around the border crossing', () => {
		for (const d of [0.01, 0.07, 0.1, 0.13, 0.17, 0.2, 0.21, 0.3]) {
			expect(judgeDelta(-d)).toBe(judgeDelta(d));
		}
		// The PERFECT band straddles the border equally on both sides.
		expect(judgeDelta(-0.07)).toBe('perfect');
		expect(judgeDelta(0.07)).toBe('perfect');
		expect(judgeDelta(-0.0701)).not.toBe('perfect');
		expect(judgeDelta(0.0701)).not.toBe('perfect');
	});
});

describe('grow-out geometry — skins render by it (source pins)', () => {
	for (const skin of ['SongBeatSquareSkin', 'SongBeatRoundSkin']) {
		it(`${skin} grows via growOut and carries no shrink-in ring`, () => {
			const src = readFileSync(`src/lib/components/${skin}.svelte`, 'utf-8');
			expect(src).toContain('growOut(next.signedDt, approachSec)');
			expect(src).toContain('note-shape');
			expect(src).not.toContain('1.45 - 0.45');
			// The note must be able to cross OUT of the box: pad overflow is visible.
			expect(src).toContain('overflow: visible');
		});
	}
});
