// quick-261122-ugcb1 — the Nowbar underline maths (brief §2.6) and the sibling-aware lineEndAt.
import { describe, it, expect } from 'vitest';
import { lineProgressAt, lineEndAt, parseLRC, splitParenLines, type LyricLine } from './lrc';

const L = (time: number, text: string, end?: number): LyricLine =>
	end === undefined ? { time, text } : { time, text, end };

describe('lineProgressAt', () => {
	const lines = [L(10, 'a'), L(14, 'b'), L(20, 'c')];

	it('before the first line → idx -1, frac 0', () => {
		expect(lineProgressAt(lines, 5)).toEqual({ idx: -1, frac: 0, start: 0, end: 0 });
	});

	it('legacy ends: progress runs to the next line start', () => {
		expect(lineProgressAt(lines, 12)).toMatchObject({ idx: 0, frac: 0.5, start: 10, end: 14 });
		expect(lineProgressAt(lines, 14)).toMatchObject({ idx: 1, frac: 0 });
	});

	it('an explicit end makes the line finish early (instrumental gap reads as a full underline)', () => {
		const ex = [L(10, 'a', 12), L(20, 'b')];
		expect(lineProgressAt(ex, 11).frac).toBeCloseTo(0.5);
		expect(lineProgressAt(ex, 15).frac).toBe(1);
	});

	it('last line runs to the duration; unknown duration → zero-length → 1', () => {
		expect(lineProgressAt(lines, 25, 0, 30).frac).toBeCloseTo(0.5);
		expect(lineProgressAt(lines, 25, 0, 0).frac).toBe(1);
	});

	it('applies the lyric offset (positive = lyrics later)', () => {
		expect(lineProgressAt(lines, 14, 2)).toMatchObject({ idx: 0, frac: 0.5 });
	});

	it('same-timestamp siblings share one window, not a zero-length one', () => {
		const sib = [L(10, '原文'), L(10, 'translation'), L(16, 'next')];
		expect(lineProgressAt(sib, 13)).toMatchObject({ idx: 0, frac: 0.5, end: 16 });
		// an explicit end on any sibling of the group ends the group at the latest one
		const sibEnd = [L(10, '原文', 12), L(10, 'tr', 14), L(16, 'next')];
		expect(lineProgressAt(sibEnd, 12).end).toBe(14);
	});
});

describe('lineEndAt sibling skip', () => {
	it('skips same-time siblings to the next strictly-later line', () => {
		const sib = [L(10, 'a'), L(10, 'b'), L(16, 'c')];
		expect(lineEndAt(sib, 0)).toBe(16);
		expect(lineEndAt(sib, 1)).toBe(16);
	});
});

describe('explicit end survives the render pipeline', () => {
	it('splitParenLines keeps the parent end on every clause', () => {
		const out = splitParenLines(parseLRC('[00:10.00][00:12.50]我愛你 (I love you)'));
		expect(out.length).toBe(2);
		for (const l of out) expect(l.end).toBe(12.5);
	});
});
