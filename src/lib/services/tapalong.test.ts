import { describe, it, expect } from 'vitest';
import {
	PAD_PATTERNS,
	GUIDE_PATTERN,
	INTENSITY_SCALES,
	PATTERN_TOTAL_MAX_MS,
	scalePattern,
	velocityFromPosition,
	PENTA_FREQS,
	pluckFreq,
	nextPluckStep,
	breakInfo,
	modeSynthFactor,
	haloBump,
	padOrder,
	parseTapAlongSettings,
	serializeTapAlongSettings,
	DEFAULT_TAPALONG_SETTINGS
} from './tapalong';
import type { LyricLine } from './lrc';

// quick-261021-tap: pins for the pure Tap-Along logic (brief §6). If a pattern shape, the
// intensity clamp, the break geometry or the settings fallbacks drift, these fail.

const lines: LyricLine[] = [
	{ time: 0, text: 'a' },
	{ time: 4, text: 'b' }, // 4s gap after line a — over the 2.5s break threshold
	{ time: 5, text: 'c' }, // 1s gap — never a break
	{ time: 10, text: 'd' }
];

describe('quick-261021-tap patterns', () => {
	it('pad patterns are the brief §3.2 shapes verbatim', () => {
		expect(PAD_PATTERNS.kick).toEqual([40]);
		expect(PAD_PATTERNS.snare).toEqual([14, 28, 20]);
		expect(PAD_PATTERNS.pluck).toEqual([22, 18, 12]);
		expect(PAD_PATTERNS.shaker).toEqual([8, 14, 8, 14, 10]);
		expect(GUIDE_PATTERN).toEqual([7]);
	});

	it('scalePattern at medium intensity × full velocity is the identity', () => {
		expect(scalePattern(PAD_PATTERNS.snare, INTENSITY_SCALES.medium)).toEqual([14, 28, 20]);
	});

	it('scalePattern scales durations by intensity × velocity', () => {
		expect(scalePattern([40], INTENSITY_SCALES.low)).toEqual([24]);
		expect(scalePattern([40], INTENSITY_SCALES.high)).toEqual([52]);
		expect(scalePattern([40], 1, 0.5)).toEqual([20]);
	});

	it('scalePattern clamps the total to PATTERN_TOTAL_MAX_MS', () => {
		const out = scalePattern([100, 100, 100], 1.3);
		expect(out.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PATTERN_TOTAL_MAX_MS);
		expect(out.every((ms) => ms >= 1)).toBe(true);
	});

	it('scalePattern never throws on degenerate input', () => {
		expect(scalePattern([], 1)).toEqual([]);
		expect(scalePattern([40], Number.NaN, Number.NaN)).toEqual([40]);
	});
});

describe('quick-261021-tap velocity + pluck ladder', () => {
	it('velocity is full at centre and floored at the edge', () => {
		expect(velocityFromPosition(0)).toBe(1);
		expect(velocityFromPosition(1)).toBeCloseTo(0.55);
		expect(velocityFromPosition(0.5)).toBeCloseTo(0.775);
		expect(velocityFromPosition(9)).toBeCloseTo(0.55); // clamped
		expect(velocityFromPosition(Number.NaN)).toBe(1);
	});

	it('pluckFreq walks and wraps the pentatonic ladder', () => {
		expect(pluckFreq(0)).toBe(PENTA_FREQS[0]);
		expect(pluckFreq(3)).toBe(PENTA_FREQS[3]);
		expect(pluckFreq(PENTA_FREQS.length)).toBe(PENTA_FREQS[0]);
		expect(pluckFreq(-2)).toBe(PENTA_FREQS[0]);
	});

	it('nextPluckStep increments in flow and resets after the idle gap', () => {
		expect(nextPluckStep(0, 300)).toBe(1);
		expect(nextPluckStep(4, 1999)).toBe(5);
		expect(nextPluckStep(4, 2001)).toBe(0);
		expect(nextPluckStep(4, Number.NaN)).toBe(0);
	});
});

describe('quick-261021-tap break detection (call-and-response)', () => {
	it('the latter half of a >2.5s gap is a break; the first half is not', () => {
		expect(breakInfo(lines, 0, 1).inBreak).toBe(false); // gap 4s, first half
		expect(breakInfo(lines, 0, 2.5).inBreak).toBe(true); // latter half
		expect(breakInfo(lines, 0, 3.99).inBreak).toBe(true);
		expect(breakInfo(lines, 0, 4).inBreak).toBe(false); // next line has started
		expect(breakInfo(lines, 0, 2.5).gapSec).toBe(4);
	});

	it('a short gap is never a break', () => {
		expect(breakInfo(lines, 1, 4.9).inBreak).toBe(false);
	});

	it('degenerate inputs are never a break', () => {
		expect(breakInfo(lines, -1, 3).inBreak).toBe(false);
		expect(breakInfo([], 0, 3).inBreak).toBe(false);
		expect(breakInfo(lines, 3, 30).inBreak).toBe(false); // last line, no duration
		expect(breakInfo(lines, 3, 30, 40).gapSec).toBe(30); // last line vs duration
	});
});

describe('quick-261021-tap modes + settings', () => {
	it('ensemble is the only full-presence synth mode', () => {
		expect(modeSynthFactor('ensemble')).toBe(1);
		expect(modeSynthFactor('guided')).toBe(0.8);
		expect(modeSynthFactor('free')).toBe(0.8);
	});

	it('kick feeds the halo most', () => {
		expect(haloBump('kick')).toBeGreaterThan(haloBump('pluck'));
	});

	it('padOrder mirrors horizontally for left-handed use', () => {
		expect(padOrder(false)).toEqual(['snare', 'shaker', 'kick', 'pluck']);
		expect(padOrder(true)).toEqual(['shaker', 'snare', 'pluck', 'kick']);
	});

	it('settings round-trip through serialize/parse', () => {
		const s = { ...DEFAULT_TAPALONG_SETTINGS, intensity: 'high' as const, mode: 'free' as const };
		expect(parseTapAlongSettings(serializeTapAlongSettings(s))).toEqual(s);
	});

	it('parse falls back per-field and never throws', () => {
		expect(parseTapAlongSettings(null)).toEqual(DEFAULT_TAPALONG_SETTINGS);
		expect(parseTapAlongSettings('not json')).toEqual(DEFAULT_TAPALONG_SETTINGS);
		const p = parseTapAlongSettings('{"intensity":"loud","synthVolume":7,"guide":false}');
		expect(p.intensity).toBe('medium'); // bad enum → default
		expect(p.synthVolume).toBe(1); // out-of-range number → clamped, not defaulted
		expect(p.guide).toBe(false); // good field survives
	});
});
