import { describe, it, expect } from 'vitest';
import { isDiagKey } from '$lib/proxy/diag-payload';
import {
	isOffsetKey,
	offsetObjectKey,
	parseVoteBody,
	parseRecord,
	applyVote,
	consensus,
	voterId,
	MAX_VOTES,
	type OffsetRecord
} from './lyric-offset';

// quick-260926-mzn — pure helpers behind /api/lyric-offset: key screen, record parse, vote apply,
// median consensus, salted voter id.

const K = 'ab'.repeat(16);

/** A record whose votes carry the given offsets, one voter each, t = index. */
function rec(offsets: number[]): OffsetRecord {
	const votes: OffsetRecord['votes'] = {};
	offsets.forEach((o, i) => (votes[`v${i}`] = { o, t: i }));
	return { v: 1, votes };
}

describe('isOffsetKey', () => {
	it('accepts exactly 32 lowercase hex', () => {
		expect(isOffsetKey(K)).toBe(true);
		expect(isOffsetKey('0123456789abcdef0123456789abcdef')).toBe(true);
	});
	it('rejects everything else', () => {
		for (const k of [null, '', 'a'.repeat(31), 'a'.repeat(33), 'AB'.repeat(16), '../x', 'log/x.json']) {
			expect(isOffsetKey(k)).toBe(false);
		}
	});
});

describe('offsetObjectKey', () => {
	it('builds lyric-offset/<k>.json, disjoint from the diag log/ namespace', () => {
		expect(offsetObjectKey(K)).toBe(`lyric-offset/${K}.json`);
		expect(isDiagKey(offsetObjectKey(K))).toBe(false);
	});
});

describe('parseVoteBody', () => {
	it('parses and normalizes a valid vote', () => {
		expect(parseVoteBody(`{"k":"${K}","offset":2.34}`)).toEqual({ k: K, offset: 2.3 });
		expect(parseVoteBody(`{"k":"${K}","offset":-0}`)).toEqual({ k: K, offset: 0 });
		expect(parseVoteBody(`{"k":"${K}","offset":1,"extra":true}`)).toEqual({ k: K, offset: 1 });
	});
	it('accepts the exact ±600 bounds', () => {
		expect(parseVoteBody(`{"k":"${K}","offset":600}`)).toEqual({ k: K, offset: 600 });
		expect(parseVoteBody(`{"k":"${K}","offset":-600}`)).toEqual({ k: K, offset: -600 });
	});
	it('rejects bad shapes and out-of-range values (never throws)', () => {
		const bad = [
			'not json',
			'[]',
			'null',
			'{"offset":1}',
			'{"k":"bad","offset":1}',
			`{"k":"${K}","offset":"1"}`,
			`{"k":"${K}"}`,
			`{"k":"${K}","offset":600.1}`,
			`{"k":"${K}","offset":-600.1}`,
			// JSON cannot carry NaN; 1e400 parses to ±Infinity, which exercises the finite check.
			`{"k":"${K}","offset":1e400}`,
			`{"k":"${K}","offset":-1e400}`
		];
		for (const b of bad) expect(parseVoteBody(b)).toBeNull();
	});
});

describe('parseRecord', () => {
	it('degrades anything malformed to an empty v1 record', () => {
		for (const t of [null, '', 'not json', '[]', '{"v":2,"votes":{}}', '{"v":1}', '{"v":1,"votes":[]}']) {
			expect(parseRecord(t)).toEqual({ v: 1, votes: {} });
		}
	});
	it('drops invalid entries one by one', () => {
		const text = JSON.stringify({
			v: 1,
			votes: {
				good: { o: 1.5, t: 10 },
				notObj: 3,
				badO: { o: 'x', t: 1 },
				badT: { o: 1, t: 'y' },
				range: { o: 700, t: 1 }
			}
		});
		expect(parseRecord(text)).toEqual({ v: 1, votes: { good: { o: 1.5, t: 10 } } });
	});
	it('round-trips a valid record', () => {
		const r = rec([1, 2, 3]);
		expect(parseRecord(JSON.stringify(r))).toEqual(r);
	});
});

describe('applyVote', () => {
	it('returns a new object and leaves the input untouched', () => {
		const r = rec([1]);
		const snapshot = JSON.stringify(r);
		const next = applyVote(r, 'x', 2, 99);
		expect(next).not.toBe(r);
		expect(JSON.stringify(r)).toBe(snapshot);
		expect(next.votes.x).toEqual({ o: 2, t: 99 });
	});
	it('a re-vote by the same voter replaces, count unchanged', () => {
		const r = applyVote(rec([1, 2]), 'v0', 5, 50);
		expect(Object.keys(r.votes)).toHaveLength(2);
		expect(r.votes.v0).toEqual({ o: 5, t: 50 });
	});
	it('caps at MAX_VOTES, dropping the oldest (smallest t)', () => {
		const r = rec(Array.from({ length: MAX_VOTES }, () => 1)); // t = 0..49
		const next = applyVote(r, 'new', 1, 1000);
		expect(Object.keys(next.votes)).toHaveLength(MAX_VOTES);
		expect(next.votes.v0).toBeUndefined();
		expect(next.votes.v1).toBeDefined();
		expect(next.votes.new).toEqual({ o: 1, t: 1000 });
	});
});

describe('consensus', () => {
	it('empty and under-quorum records give no offset', () => {
		expect(consensus({ v: 1, votes: {} })).toEqual({ offset: null, n: 0 });
		expect(consensus(rec([1.5, 1.5]))).toEqual({ offset: null, n: 2 });
	});
	it('3 agreeing votes give the median', () => {
		expect(consensus(rec([1.5, 1.5, 1.5]))).toEqual({ offset: 1.5, n: 3 });
		expect(consensus(rec([1, 1.2, 1.1]))).toEqual({ offset: 1.1, n: 3 });
	});
	it('outliers do not count toward agreement', () => {
		expect(consensus(rec([1, 1.1, 30]))).toEqual({ offset: null, n: 3 });
		expect(consensus(rec([1, 1.2, 1.1, 30, -20]))).toEqual({ offset: 1.1, n: 5 });
	});
	it('even count uses the mean of the middle two', () => {
		expect(consensus(rec([1, 2, 2, 3]))).toEqual({ offset: 2, n: 4 });
	});
	it('the median is normalized to 0.1s', () => {
		expect(consensus(rec([0.96, 0.96, 0.96, 0.96]))).toEqual({ offset: 1, n: 4 });
	});
	it('a vote exactly AGREE_WINDOW_SEC from the median counts', () => {
		// median 1 (sorted [0, 1, 2]); 0 and 2 are each exactly 1.0 away
		expect(consensus(rec([0, 1, 2]))).toEqual({ offset: 1, n: 3 });
	});
});

describe('voterId', () => {
	it('is 16 hex, deterministic, salted by key, and never contains the ip', async () => {
		const a = await voterId('1.2.3.4', K);
		expect(a).toMatch(/^[0-9a-f]{16}$/);
		expect(await voterId('1.2.3.4', K)).toBe(a);
		expect(await voterId('1.2.3.4', 'cd'.repeat(16))).not.toBe(a);
		expect(await voterId('5.6.7.8', K)).not.toBe(a);
		expect(a).not.toContain('1.2.3.4');
	});
});
