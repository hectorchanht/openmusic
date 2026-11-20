import { describe, expect, it } from 'vitest';
import { progressFraction, reliabilityDot } from './car-mode';

// quick-261116-carmode: the Car Mode panel's two pure judgements — the reliability
// dot (colour-only provenance, no text badges per the confirmed spec) and the
// progress sliver fraction.
describe('reliabilityDot', () => {
	it('is none when nothing is loaded, whatever the provenance flag says', () => {
		expect(reliabilityDot({ hasTrack: false, isLocal: false })).toBe('none');
		expect(reliabilityDot({ hasTrack: false, isLocal: true })).toBe('none');
	});

	it('is local when the attached src bytes are on the device', () => {
		expect(reliabilityDot({ hasTrack: true, isLocal: true })).toBe('local');
	});

	it('is stream when the track is playing from the network', () => {
		expect(reliabilityDot({ hasTrack: true, isLocal: false })).toBe('stream');
	});
});

describe('progressFraction', () => {
	it('is the plain currentTime / duration ratio mid-track', () => {
		expect(progressFraction(30, 120)).toBe(0.25);
		expect(progressFraction(0, 120)).toBe(0);
	});

	it('clamps an overshoot to exactly 1', () => {
		expect(progressFraction(120, 120)).toBe(1);
		expect(progressFraction(999, 120)).toBe(1);
	});

	it('is 0 for unknown, zero or non-finite durations', () => {
		expect(progressFraction(30, 0)).toBe(0);
		expect(progressFraction(30, -5)).toBe(0);
		expect(progressFraction(30, NaN)).toBe(0);
		expect(progressFraction(30, Infinity)).toBe(0);
	});

	it('is 0 for negative or non-finite times', () => {
		expect(progressFraction(-1, 120)).toBe(0);
		expect(progressFraction(NaN, 120)).toBe(0);
	});
});
