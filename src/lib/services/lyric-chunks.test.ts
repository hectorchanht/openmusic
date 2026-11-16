import { describe, it, expect } from 'vitest';
import { chunkRanges, applyChunkResult, LYRICS_CHUNK_SIZE } from './lyric-chunks';

// quick-261116-kvprog: the pure arithmetic behind NpLyrics' progressive rendering.

describe('chunkRanges', () => {
	it('returns no ranges for an empty list', () => {
		expect(chunkRanges(0, 10)).toEqual([]);
	});
	it('returns one range for a short list', () => {
		expect(chunkRanges(3, 10)).toEqual([{ start: 0, end: 3 }]);
	});
	it('splits in order with a short tail', () => {
		expect(chunkRanges(25, 10)).toEqual([
			{ start: 0, end: 10 },
			{ start: 10, end: 20 },
			{ start: 20, end: 25 }
		]);
	});
	it('covers the default chunk size exactly', () => {
		const ranges = chunkRanges(60, LYRICS_CHUNK_SIZE);
		expect(ranges).toHaveLength(6);
		expect(ranges[5]).toEqual({ start: 50, end: 60 });
	});
});

describe('applyChunkResult', () => {
	// Line indices 1 and 3 are the sent positions (0 and 2 were whitelisted).
	const base = ['l0', 'l1', 'l2', 'l3'];
	const positions = [1, 3];
	it('lands outputs at their mapped line positions in a NEW array', () => {
		const next = applyChunkResult(base, positions, 0, ['T1', 'T3']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'T3']);
		expect(next).not.toBe(base);
		expect(base).toEqual(['l0', 'l1', 'l2', 'l3']); // base untouched
	});
	it('applies a later chunk by its chunkStart offset', () => {
		const next = applyChunkResult(base, positions, 1, ['T3']);
		expect(next).toEqual(['l0', 'l1', 'l2', 'T3']);
	});
	it('keeps the original where an output slot is missing', () => {
		const next = applyChunkResult(base, positions, 0, ['T1']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'l3']);
	});
	it('stops at the end of the positions map instead of throwing', () => {
		const next = applyChunkResult(base, positions, 0, ['T1', 'T3', 'EXTRA']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'T3']);
	});
});
