// seekbar.test.ts — the shared SeekBar's pure math (quick-261119-seekbar):
// buffered-ranges → bar geometry (multi-range), tap/drag → seek fraction
// (clamped 0..1), and the Nowbar strip's gesture-claim decision.
import { describe, expect, it } from 'vitest';
import {
	readBufferedRanges,
	rangesToPercents,
	fractionFromClientX,
	decideGestureClaim,
	sameBufferedRanges,
	type BufferedHolder
} from './seekbar';

/** A TimeRanges fake over [start,end] pairs. */
function fakeBuffered(pairs: [number, number][]): BufferedHolder {
	return {
		buffered: {
			length: pairs.length,
			start: (i: number) => pairs[i][0],
			end: (i: number) => pairs[i][1]
		}
	};
}

describe('readBufferedRanges', () => {
	it('returns [] for a missing / empty buffer', () => {
		expect(readBufferedRanges(null)).toEqual([]);
		expect(readBufferedRanges(undefined)).toEqual([]);
		expect(readBufferedRanges({})).toEqual([]);
		expect(readBufferedRanges(fakeBuffered([]))).toEqual([]);
	});

	it('snapshots a single range', () => {
		expect(readBufferedRanges(fakeBuffered([[0, 42.5]]))).toEqual([{ start: 0, end: 42.5 }]);
	});

	it('keeps MULTIPLE ranges apart (the post-seek shape)', () => {
		expect(
			readBufferedRanges(
				fakeBuffered([
					[0, 30],
					[95, 140]
				])
			)
		).toEqual([
			{ start: 0, end: 30 },
			{ start: 95, end: 140 }
		]);
	});

	it('sorts out-of-order ranges and merges overlapping / touching ones', () => {
		expect(
			readBufferedRanges(
				fakeBuffered([
					[50, 80],
					[0, 30],
					[29.98, 55]
				])
			)
		).toEqual([{ start: 0, end: 80 }]);
	});

	it('drops invalid spans (inverted, non-finite, negative-clamped)', () => {
		expect(
			readBufferedRanges(
				fakeBuffered([
					[10, 5],
					[NaN, 20],
					[-4, 12]
				])
			)
		).toEqual([{ start: 0, end: 12 }]);
	});

	it('never throws on a detached element whose TimeRanges explode', () => {
		const evil: BufferedHolder = {
			buffered: {
				length: 1,
				start: () => {
					throw new Error('detached');
				},
				end: () => {
					throw new Error('detached');
				}
			}
		};
		expect(readBufferedRanges(evil)).toEqual([]);
	});
});

describe('rangesToPercents', () => {
	it('maps a single range to left/width percents', () => {
		expect(rangesToPercents([{ start: 0, end: 50 }], 200)).toEqual([{ left: 0, width: 25 }]);
	});

	it('maps MULTIPLE ranges independently (grey segments after a seek)', () => {
		expect(
			rangesToPercents(
				[
					{ start: 0, end: 30 },
					{ start: 95, end: 140 }
				],
				200
			)
		).toEqual([
			{ left: 0, width: 15 },
			{ left: 47.5, width: 22.5 }
		]);
	});

	it('clamps ranges to the track bounds', () => {
		expect(rangesToPercents([{ start: 150, end: 999 }], 200)).toEqual([
			{ left: 75, width: 25 }
		]);
		expect(rangesToPercents([{ start: 250, end: 300 }], 200)).toEqual([]);
	});

	it('unknown duration → no segments (honest empty bar)', () => {
		expect(rangesToPercents([{ start: 0, end: 10 }], 0)).toEqual([]);
		expect(rangesToPercents([{ start: 0, end: 10 }], NaN)).toEqual([]);
		expect(rangesToPercents([{ start: 0, end: 10 }], Infinity)).toEqual([]);
	});
});

describe('fractionFromClientX', () => {
	const rect = { left: 100, width: 200 };
	it('maps the left edge to 0, the middle to 0.5, the right edge to 1', () => {
		expect(fractionFromClientX(100, rect)).toBe(0);
		expect(fractionFromClientX(200, rect)).toBe(0.5);
		expect(fractionFromClientX(300, rect)).toBe(1);
	});
	it('clamps past both ends (a drag may leave the bar)', () => {
		expect(fractionFromClientX(-50, rect)).toBe(0);
		expect(fractionFromClientX(999, rect)).toBe(1);
	});
	it('a zero-width rect reads 0 instead of NaN', () => {
		expect(fractionFromClientX(10, { left: 0, width: 0 })).toBe(0);
	});
});

describe('decideGestureClaim', () => {
	it('waits under the threshold (a release here is a tap)', () => {
		expect(decideGestureClaim(0, 0)).toBe('wait');
		expect(decideGestureClaim(5, -6)).toBe('wait');
		expect(decideGestureClaim(7.9, 0)).toBe('wait');
	});
	it('claims a horizontal-dominant drag at/past the threshold', () => {
		expect(decideGestureClaim(8, 0)).toBe('claim');
		expect(decideGestureClaim(-30, 10)).toBe('claim');
		expect(decideGestureClaim(12, 12)).toBe('claim'); // a tie goes to the seek — the finger is ON the strip
	});
	it('yields a vertical-dominant drag (scroll intent is never hijacked)', () => {
		expect(decideGestureClaim(0, 8)).toBe('yield');
		expect(decideGestureClaim(6, -40)).toBe('yield');
	});
	it('honours a custom threshold', () => {
		expect(decideGestureClaim(4, 0, 4)).toBe('claim');
		expect(decideGestureClaim(3, 0, 4)).toBe('wait');
	});
});

describe('sameBufferedRanges', () => {
	it('equal within epsilon → same (no $state churn)', () => {
		expect(sameBufferedRanges([{ start: 0, end: 30 }], [{ start: 0.1, end: 30.2 }])).toBe(true);
	});
	it('growth past epsilon → different', () => {
		expect(sameBufferedRanges([{ start: 0, end: 30 }], [{ start: 0, end: 31 }])).toBe(false);
	});
	it('a count change is always material', () => {
		expect(
			sameBufferedRanges(
				[{ start: 0, end: 30 }],
				[
					{ start: 0, end: 30 },
					{ start: 90, end: 100 }
				]
			)
		).toBe(false);
	});
});
