import { describe, it, expect } from 'vitest';
import {
	computeDeadline,
	isExpired,
	remainingMs,
	fadeVolumeAt,
	canFadeVolume,
	decideEndedAction
} from './sleep-timer';

describe('computeDeadline', () => {
	// Test 1: now + minutes*60_000 for every industry-standard duration.
	it('adds minutes*60_000 to now for all six durations', () => {
		for (const m of [5, 10, 15, 30, 45, 60]) {
			expect(computeDeadline(1_000, m)).toBe(1_000 + m * 60_000);
		}
	});

	it('returns now unchanged for a zero-minute deadline', () => {
		expect(computeDeadline(5_000, 0)).toBe(5_000);
	});
});

describe('isExpired', () => {
	it('returns false when now is before the deadline', () => {
		expect(isExpired(100, 200)).toBe(false);
	});

	it('returns true at the exact deadline boundary (now === deadline)', () => {
		expect(isExpired(200, 200)).toBe(true);
	});

	it('returns true when now is past the deadline', () => {
		expect(isExpired(300, 200)).toBe(true);
	});

	it('returns false for a null deadline (timer off)', () => {
		expect(isExpired(999, null)).toBe(false);
	});
});

describe('remainingMs', () => {
	it('returns the positive delta when now is before the deadline', () => {
		expect(remainingMs(100, 1_100)).toBe(1_000);
	});

	it('clamps to 0 at the deadline (no negative)', () => {
		expect(remainingMs(200, 200)).toBe(0);
	});

	it('clamps to 0 after the deadline (no negative)', () => {
		expect(remainingMs(500, 200)).toBe(0);
	});

	it('returns 0 for a null deadline (timer off)', () => {
		expect(remainingMs(123, null)).toBe(0);
	});
});

describe('fadeVolumeAt', () => {
	it('returns startVol at elapsed=0 (fade not started)', () => {
		expect(fadeVolumeAt(0, 10_000, 0.8)).toBeCloseTo(0.8, 6);
	});

	it('returns 0 at elapsed=totalMs (fully faded)', () => {
		expect(fadeVolumeAt(10_000, 10_000, 0.8)).toBeCloseTo(0, 6);
	});

	it('returns startVol*0.5 at the midpoint', () => {
		expect(fadeVolumeAt(5_000, 10_000, 0.8)).toBeCloseTo(0.4, 6);
	});

	it('clamps the result to [0,1] when elapsed overshoots totalMs', () => {
		expect(fadeVolumeAt(20_000, 10_000, 0.8)).toBe(0);
	});

	it('never exceeds 1 even with an out-of-range startVol', () => {
		expect(fadeVolumeAt(0, 10_000, 5)).toBe(1);
	});

	it('returns 0 for totalMs <= 0 (no divide-by-zero / NaN / Infinity)', () => {
		expect(fadeVolumeAt(0, 0, 0.8)).toBe(0);
		expect(fadeVolumeAt(0, -1, 0.8)).toBe(0);
		expect(Number.isFinite(fadeVolumeAt(0, 0, 0.8))).toBe(true);
	});

	it('stays 0 throughout when startVol is 0', () => {
		expect(fadeVolumeAt(0, 10_000, 0)).toBe(0);
		expect(fadeVolumeAt(5_000, 10_000, 0)).toBe(0);
		expect(fadeVolumeAt(10_000, 10_000, 0)).toBe(0);
	});
});

describe('canFadeVolume', () => {
	it('returns true when the volume setter is honored (writable element) and restores the original', () => {
		const audio = { volume: 0.7 };
		expect(canFadeVolume(audio)).toBe(true);
		// original volume restored after the probe
		expect(audio.volume).toBe(0.7);
	});

	it('returns false when the volume setter is ignored (iOS read-only, reads stay 1)', () => {
		// iOS-style fake: the setter is a no-op, reads always return 1.
		const audio = {
			get volume() {
				return 1;
			},
			set volume(_v: number) {
				/* ignored — iOS read-only volume */
			}
		};
		expect(canFadeVolume(audio)).toBe(false);
		// original (1) "restored" — read still reports 1
		expect(audio.volume).toBe(1);
	});

	it('probes against a differing value when the original is 0, and restores it', () => {
		const audio = { volume: 0 };
		expect(canFadeVolume(audio)).toBe(true);
		expect(audio.volume).toBe(0);
	});

	it('returns false (does not throw) when the setter throws', () => {
		const audio = {
			get volume() {
				return 0.5;
			},
			set volume(_v: number) {
				throw new Error('locked');
			}
		};
		expect(canFadeVolume(audio)).toBe(false);
	});
});

describe('decideEndedAction', () => {
	// D-03 LOCK: sleep (end-of-track) beats repeat-one beats advance.
	it("('end-of-track', 'one') === 'sleep-stop' (D-03: sleep beats repeat-one)", () => {
		expect(decideEndedAction('end-of-track', 'one')).toBe('sleep-stop');
	});

	it("('end-of-track', 'off') === 'sleep-stop'", () => {
		expect(decideEndedAction('end-of-track', 'off')).toBe('sleep-stop');
	});

	it("('off', 'one') === 'repeat-rewind' (repeat-one beats advance)", () => {
		expect(decideEndedAction('off', 'one')).toBe('repeat-rewind');
	});

	it("('off', 'off') === 'advance' (default)", () => {
		expect(decideEndedAction('off', 'off')).toBe('advance');
	});

	it("('minutes', 'one') === 'repeat-rewind' (minutes mode does NOT alter the ended branch)", () => {
		expect(decideEndedAction('minutes', 'one')).toBe('repeat-rewind');
	});

	it("('minutes', 'off') === 'advance' (minutes mode does NOT alter the ended branch)", () => {
		expect(decideEndedAction('minutes', 'off')).toBe('advance');
	});
});
