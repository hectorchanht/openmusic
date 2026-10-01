// cover-pick pure helpers (Phase 40 D-17 / D-18 / D-18a / D-19) — the key screen, the ONLY two R2
// key builders, vote parsing, count-based consensus and the per-IP throttle behind /api/cover-pick.

import { describe, expect, it } from 'vitest';
import {
	isPickKey,
	pickObjectKey,
	pickThrottleKey,
	pickQuery,
	emptyRecord,
	parseRecord,
	parseVoteBody,
	applyVote,
	consensus,
	voterId,
	throttleVoterId,
	parseThrottle,
	checkThrottle,
	MAX_URL_CHARS,
	MAX_VOTES,
	PICK_MIN_GAP_MS,
	PICK_DAILY_MAX,
	type PickRecord
} from './cover-pick';

const K1 = 'ab'.repeat(16);
const K2 = 'cd'.repeat(16);
const QQ = 'https://y.gtimg.cn/x.jpg';
const DZ = 'https://e-cdns-images.dzcdn.net/x.jpg';

const rec = (votes: PickRecord['votes']): PickRecord => ({ v: 1, votes });

describe('isPickKey', () => {
	it('accepts 32 lowercase hex', () => {
		expect(isPickKey(K1)).toBe(true);
	});
	it('rejects short, uppercase, null and path-shaped keys', () => {
		for (const k of ['a'.repeat(31), 'AB'.repeat(16), null, '../x', '']) expect(isPickKey(k)).toBe(false);
	});
});

describe('R2 key builders', () => {
	it('records live under cover-pick/<kind>/', () => {
		expect(pickObjectKey('u', K1)).toBe(`cover-pick/u/${K1}.json`);
		expect(pickObjectKey('n', K1)).toBe(`cover-pick/n/${K1}.json`);
	});
	it('throttle lives under cover-pick-throttle/', () => {
		expect(pickThrottleKey('0123456789abcdef')).toBe('cover-pick-throttle/0123456789abcdef.json');
	});
});

describe('pickQuery', () => {
	it('fixed u-then-n order, absent keys omitted', () => {
		expect(pickQuery({ u: K1, n: K2 })).toBe(`u=${K1}&n=${K2}`);
		expect(pickQuery({ u: K1, n: null })).toBe(`u=${K1}`);
		expect(pickQuery({ u: null, n: K2 })).toBe(`n=${K2}`);
	});
});

describe('parseVoteBody', () => {
	it('u only', () => {
		expect(parseVoteBody(JSON.stringify({ u: K1, url: QQ }))).toEqual({ u: K1, n: null, url: QQ });
	});
	it('both keys', () => {
		expect(parseVoteBody(JSON.stringify({ u: K1, n: K2, url: QQ }))).toEqual({ u: K1, n: K2, url: QQ });
	});
	it('neither key → null', () => {
		expect(parseVoteBody(JSON.stringify({ url: QQ }))).toBeNull();
	});
	it('a present key that fails the screen → null', () => {
		expect(parseVoteBody(JSON.stringify({ u: K1, n: '../log/x', url: QQ }))).toBeNull();
		expect(parseVoteBody(JSON.stringify({ u: 5, url: QQ }))).toBeNull();
	});
	it('non-allowlisted or non-https url → null', () => {
		expect(parseVoteBody(JSON.stringify({ u: K1, url: 'https://example.com/x.jpg' }))).toBeNull();
		expect(parseVoteBody(JSON.stringify({ u: K1, url: 'http://y.gtimg.cn/x.jpg' }))).toBeNull();
		expect(parseVoteBody(JSON.stringify({ u: K1, url: 42 }))).toBeNull();
	});
	it('url over MAX_URL_CHARS → null', () => {
		const url = 'https://y.gtimg.cn/' + 'a'.repeat(MAX_URL_CHARS);
		expect(parseVoteBody(JSON.stringify({ u: K1, url }))).toBeNull();
	});
	it('non-object JSON and invalid JSON → null', () => {
		for (const t of ['not json', '[]', 'null', '"x"', '1']) expect(parseVoteBody(t)).toBeNull();
	});
	it('stores the normalized href safeImageUrl approved', () => {
		expect(parseVoteBody(JSON.stringify({ u: K1, url: 'https://Y.GTIMG.CN/x.jpg' }))?.url).toBe(QQ);
	});
});

describe('parseRecord', () => {
	it('keeps valid entries, drops a bad url or a non-finite t', () => {
		const text = JSON.stringify({
			v: 1,
			votes: {
				a: { u: QQ, t: 1 },
				b: { u: 'https://example.com/x.jpg', t: 2 },
				c: { u: QQ, t: 'x' },
				d: { u: 7, t: 3 }
			}
		});
		expect(parseRecord(text)).toEqual(rec({ a: { u: QQ, t: 1 } }));
	});
	it('invalid JSON / null / wrong version → empty', () => {
		for (const t of ['nope', null, '{"v":2,"votes":{}}']) expect(parseRecord(t)).toEqual(emptyRecord());
	});
});

describe('applyVote (D-19)', () => {
	it('a new voter adds', () => {
		expect(applyVote(emptyRecord(), 'a', QQ, 1)).toEqual(rec({ a: { u: QQ, t: 1 } }));
	});
	it('the same voter re-voting replaces', () => {
		const r = applyVote(applyVote(emptyRecord(), 'a', QQ, 1), 'a', DZ, 2);
		expect(r).toEqual(rec({ a: { u: DZ, t: 2 } }));
	});
	it('over MAX_VOTES keeps the newest 50', () => {
		let r = emptyRecord();
		for (let i = 0; i < MAX_VOTES + 5; i++) r = applyVote(r, `v${i}`, QQ, i);
		expect(Object.keys(r.votes)).toHaveLength(MAX_VOTES);
		expect(r.votes.v0).toBeUndefined();
		expect(r.votes[`v${MAX_VOTES + 4}`]).toBeDefined();
	});
});

describe('consensus (D-17)', () => {
	it('no votes → null', () => {
		expect(consensus(emptyRecord())).toBeNull();
	});
	it('most votes wins', () => {
		expect(consensus(rec({ a: { u: QQ, t: 9 }, b: { u: QQ, t: 1 }, c: { u: DZ, t: 10 } }))).toBe(QQ);
	});
	it('a tie goes to the most recent vote', () => {
		expect(consensus(rec({ a: { u: QQ, t: 1 }, b: { u: DZ, t: 5 } }))).toBe(DZ);
		expect(consensus(rec({ a: { u: QQ, t: 5 }, b: { u: DZ, t: 1 } }))).toBe(QQ);
	});
	it('one vote applies (no quorum)', () => {
		expect(consensus(rec({ a: { u: QQ, t: 1 } }))).toBe(QQ);
	});
});

describe('voter ids', () => {
	it('per-key salt: one ip yields different ids on different keys', async () => {
		expect(await voterId('1.2.3.4', K1)).not.toBe(await voterId('1.2.3.4', K2));
		expect(await voterId('1.2.3.4', K1)).toMatch(/^[0-9a-f]{16}$/);
	});
	it('throttle id is 16 hex, global-salted, and differs from any per-key id', async () => {
		const t = await throttleVoterId('1.2.3.4');
		expect(t).toMatch(/^[0-9a-f]{16}$/);
		expect(t).not.toBe(await voterId('1.2.3.4', K1));
		expect(t).toBe(await throttleVoterId('1.2.3.4'));
		expect(t).not.toBe(await throttleVoterId('5.6.7.8'));
	});
});

describe('throttle (D-18a)', () => {
	const now = Date.UTC(2026, 8, 30, 12);
	it('no prior state → ok with n=1', () => {
		const g = checkThrottle(null, now);
		expect(g).toEqual({ ok: true, next: { last: now, day: '2026-09-30', n: 1 } });
	});
	it('a second vote inside PICK_MIN_GAP_MS → refused; after it → ok', () => {
		const g = checkThrottle(null, now);
		if (!g.ok) throw new Error('expected ok');
		expect(checkThrottle(g.next, now + 1000).ok).toBe(false);
		expect(checkThrottle(g.next, now + PICK_MIN_GAP_MS)).toEqual({
			ok: true,
			next: { last: now + PICK_MIN_GAP_MS, day: '2026-09-30', n: 2 }
		});
	});
	it('PICK_DAILY_MAX reached the same UTC day → refused; next UTC day resets', () => {
		const th = { last: now - PICK_MIN_GAP_MS * 2, day: '2026-09-30', n: PICK_DAILY_MAX };
		expect(checkThrottle(th, now).ok).toBe(false);
		const tomorrow = Date.UTC(2026, 9, 1, 0, 0, 1);
		expect(checkThrottle(th, tomorrow)).toEqual({ ok: true, next: { last: tomorrow, day: '2026-10-01', n: 1 } });
	});
	it('parseThrottle round-trips and rejects junk', () => {
		const th = { last: 1, day: '2026-09-30', n: 3 };
		expect(parseThrottle(JSON.stringify(th))).toEqual(th);
		for (const t of [null, 'x', '{"last":"1","day":"d","n":1}', '[]']) expect(parseThrottle(t)).toBeNull();
	});
});
