import { describe, it, expect } from 'vitest';
import {
	chunkRanges,
	dedupeSendList,
	applyUniqueChunkResult,
	initialPending,
	clearUniqueChunkPending,
	skeletonWidthPct,
	LYRICS_CHUNK_SIZE
} from './lyric-chunks';

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

// quick-261120-maxsave (spec Addendum 2): the send list is collapsed to unique
// lines before chunking; these helpers own the collapse + the fan-back-out.
describe('dedupeSendList', () => {
	it('returns an empty map for an empty list', () => {
		expect(dedupeSendList([])).toEqual({ unique: [], uniqOf: [] });
	});
	it('keeps a duplicate-free list identical (identity map)', () => {
		expect(dedupeSendList(['a', 'b', 'c'])).toEqual({ unique: ['a', 'b', 'c'], uniqOf: [0, 1, 2] });
	});
	it('collapses repeats to first-appearance order and maps every occurrence', () => {
		expect(dedupeSendList(['hook', 'verse', 'hook', 'hook', 'bridge', 'verse'])).toEqual({
			unique: ['hook', 'verse', 'bridge'],
			uniqOf: [0, 1, 0, 0, 2, 1]
		});
	});
	it('treats whitespace/punctuation variants as distinct lines (no normalisation)', () => {
		expect(dedupeSendList(['Hook', 'Hook ', 'Hook!']).unique).toHaveLength(3);
	});
});

describe('applyUniqueChunkResult', () => {
	// Line indices 1 and 3 are the sent positions (0 and 2 were whitelisted).
	const base = ['l0', 'l1', 'l2', 'l3'];
	const positions = [1, 3];
	it('with an identity map it lands outputs at their mapped line positions in a NEW array', () => {
		const next = applyUniqueChunkResult(base, positions, [0, 1], 0, ['T1', 'T3']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'T3']);
		expect(next).not.toBe(base);
		expect(base).toEqual(['l0', 'l1', 'l2', 'l3']); // base untouched
	});
	it('applies a later chunk by its chunkStart offset', () => {
		const next = applyUniqueChunkResult(base, positions, [0, 1], 1, ['T3']);
		expect(next).toEqual(['l0', 'l1', 'l2', 'T3']);
	});
	it('keeps the original where an output slot is missing', () => {
		const next = applyUniqueChunkResult(base, positions, [0, 1], 0, ['T1']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'l3']);
	});
	it('fans one unique result out to EVERY occurrence of the repeated line', () => {
		// Send list was [hook, verse, hook] at line positions [0, 1, 2]; the unique
		// chunk holds [hook, verse] — the hook's translation lands at lines 0 AND 2.
		const next = applyUniqueChunkResult(
			['hook', 'verse', 'hook'],
			[0, 1, 2],
			[0, 1, 0],
			0,
			['HOOK', 'VERSE']
		);
		expect(next).toEqual(['HOOK', 'VERSE', 'HOOK']);
	});
	it('ignores outputs with no matching send position instead of throwing', () => {
		const next = applyUniqueChunkResult(base, positions, [0, 1], 0, ['T1', 'T3', 'EXTRA']);
		expect(next).toEqual(['l0', 'T1', 'l2', 'T3']);
	});
});

// quick-261116-lyrux (Fix 1): the pending flags behind the show-below skeleton.
// quick-261120-maxsave: clearing goes through the unique map (identity maps below
// reproduce the old per-occurrence behaviour exactly).
describe('initialPending / clearUniqueChunkPending', () => {
	it('marks exactly the sent positions pending', () => {
		expect(initialPending(4, [1, 3])).toEqual([false, true, false, true]);
	});
	it('marks nothing pending when nothing was sent', () => {
		expect(initialPending(3, [])).toEqual([false, false, false]);
	});
	it('ignores out-of-range positions instead of throwing', () => {
		expect(initialPending(2, [1, 9])).toEqual([false, true]);
	});
	it('a settled chunk clears ONLY its own positions (out-of-order safe)', () => {
		// Two chunks in flight: positions [0,1] (chunk A) and [2,3] (chunk B).
		// B settles first — A's lines must stay pending.
		const pending = initialPending(4, [0, 1, 2, 3]);
		const afterB = clearUniqueChunkPending(pending, [0, 1, 2, 3], [0, 1, 2, 3], 2, 4);
		expect(afterB).toEqual([true, true, false, false]);
		const afterA = clearUniqueChunkPending(afterB, [0, 1, 2, 3], [0, 1, 2, 3], 0, 2);
		expect(afterA).toEqual([false, false, false, false]);
	});
	it('clears through the positions map, not raw line indices', () => {
		// Sent positions are lines 1 and 3; the (only) chunk covers send range [0,2).
		const pending = initialPending(4, [1, 3]);
		expect(clearUniqueChunkPending(pending, [1, 3], [0, 1], 0, 2)).toEqual([
			false,
			false,
			false,
			false
		]);
	});
	it('never mutates the input array', () => {
		const pending = initialPending(3, [0, 1, 2]);
		const next = clearUniqueChunkPending(pending, [0, 1, 2], [0, 1, 2], 0, 1);
		expect(next).not.toBe(pending);
		expect(pending).toEqual([true, true, true]);
	});
	it('a settled unique chunk clears EVERY occurrence of its repeated lines', () => {
		// Send list [hook, verse, hook] at lines [0,1,2] (uniqOf [0,1,0]).
		const pending = initialPending(3, [0, 1, 2]);
		// Both uniques settle ([0,2)): all three lines clear, repeats included.
		expect(clearUniqueChunkPending(pending, [0, 1, 2], [0, 1, 0], 0, 2)).toEqual([
			false,
			false,
			false
		]);
		// Only the verse's unique settles ([1,2)): both hook occurrences stay pending.
		expect(clearUniqueChunkPending(pending, [0, 1, 2], [0, 1, 0], 1, 2)).toEqual([
			true,
			false,
			true
		]);
	});
});

describe('skeletonWidthPct', () => {
	it('is deterministic for the same text', () => {
		expect(skeletonWidthPct('사랑해요 오늘 밤')).toBe(skeletonWidthPct('사랑해요 오늘 밤'));
	});
	it('stays inside a plausible line-width band', () => {
		for (const s of ['', 'a', 'Hello world', '사랑해', '今晚我要握住你的手', 'x'.repeat(200)]) {
			const pct = skeletonWidthPct(s);
			expect(pct).toBeGreaterThanOrEqual(40);
			expect(pct).toBeLessThanOrEqual(90);
		}
	});
	it('varies across different lines (not a uniform grid)', () => {
		const pcts = new Set(['line one', 'line two', 'line three', 'line four', 'line five'].map(skeletonWidthPct));
		expect(pcts.size).toBeGreaterThan(1);
	});
});
