// comments — pure helpers behind /api/comments (quick-260926-nsz). No I/O here; the route tests
// (src/routes/api/comments/comments-endpoint.test.ts) drive the same helpers through R2.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { isDiagKey } from '$lib/proxy/diag-payload';
import {
	isThreadKey,
	threadObjectKey,
	throttleObjectKey,
	cleanName,
	cleanText,
	parseCommentBody,
	parseThread,
	emptyThread,
	addComment,
	addReport,
	removeComment,
	publicItems,
	maintainerItems,
	parseThrottle,
	checkThrottle,
	voterId,
	MAX_ITEMS,
	HIDE_REPORTS,
	NAME_MAX,
	TEXT_MAX,
	TOKEN_MAX,
	POST_MIN_GAP_MS,
	POST_DAILY_MAX,
	type ThreadRecord
} from './comments';

const K = 'ab'.repeat(16);
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TOKEN = 'tok'.repeat(100);

describe('keys', () => {
	it('isThreadKey accepts exactly 32 lowercase hex', () => {
		expect(isThreadKey(K)).toBe(true);
		for (const bad of [null, '', 'a'.repeat(31), 'a'.repeat(33), 'AB'.repeat(16), '../x', 'log/x']) {
			expect(isThreadKey(bad)).toBe(false);
		}
	});

	it('the two key builders stay under their own prefixes, disjoint from log/ and lyric-offset/', () => {
		const voter = 'ab'.repeat(8);
		expect(threadObjectKey(K)).toBe(`comments/${K}.json`);
		expect(throttleObjectKey(voter)).toBe(`comments-throttle/${voter}.json`);
		for (const key of [threadObjectKey(K), throttleObjectKey(voter)]) {
			expect(isDiagKey(key)).toBe(false);
			expect(key.startsWith('lyric-offset/')).toBe(false);
		}
	});
});

describe('cleanName', () => {
	it('trims, collapses whitespace and NFC-normalizes', () => {
		expect(cleanName('Frank')).toBe('Frank');
		expect(cleanName('  Frank  Chan ')).toBe('Frank Chan');
		expect(cleanName('e\u0301')).toBe('é');
	});

	it('strips bidi overrides/isolates, zero-width, C0/C1 and BOM', () => {
		for (const c of ['\u202E', '\u2066', '\u200B', '\u0007', '\uFEFF', '\u0085', '\u2028', '\u2060']) {
			expect(cleanName(`a${c}b`)).toBe('ab');
		}
	});

	it('empty after cleaning, over NAME_MAX code points, or non-string → null', () => {
		expect(cleanName('')).toBeNull();
		expect(cleanName('   ')).toBeNull();
		expect(cleanName('\u200B')).toBeNull();
		expect(cleanName('字'.repeat(NAME_MAX))).toBe('字'.repeat(NAME_MAX));
		expect(cleanName('字'.repeat(NAME_MAX + 1))).toBeNull();
		// code points, not UTF-16 units: 24 astral emoji are 48 units and still fit
		expect(cleanName('😀'.repeat(NAME_MAX))).toBe('😀'.repeat(NAME_MAX));
		for (const bad of [42, null, undefined, {}]) expect(cleanName(bad)).toBeNull();
	});
});

describe('cleanText', () => {
	it('normalizes newlines, collapses 3+ newlines to 2, trims', () => {
		expect(cleanText('hi')).toBe('hi');
		expect(cleanText('a\r\nb\rc')).toBe('a\nb\nc');
		expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb');
		expect(cleanText(' x ')).toBe('x');
	});

	it('strips C0 (except \\n), C1 and bidi controls', () => {
		expect(cleanText('a\u0000b\u0085c')).toBe('abc');
		expect(cleanText('a\u202Eb')).toBe('ab');
		expect(cleanText('a\tb')).toBe('ab');
	});

	it('rejects (never truncates) over TEXT_MAX code points; empty / non-string → null', () => {
		expect(cleanText('')).toBeNull();
		expect(cleanText('\n\n')).toBeNull();
		expect(cleanText('x'.repeat(TEXT_MAX))).toBe('x'.repeat(TEXT_MAX));
		expect(cleanText('x'.repeat(TEXT_MAX + 1))).toBeNull();
		expect(cleanText('😀'.repeat(TEXT_MAX))).toBe('😀'.repeat(TEXT_MAX));
		for (const bad of [42, null, undefined, {}]) expect(cleanText(bad)).toBeNull();
	});
});

describe('parseCommentBody', () => {
	const post = (o: Record<string, unknown>) => JSON.stringify({ k: K, name: 'A', text: 'hi', token: TOKEN, ...o });

	it('a post (action absent or "post") with a token', () => {
		const want = { action: 'post', k: K, name: 'A', text: 'hi', token: TOKEN };
		expect(parseCommentBody(post({}))).toEqual(want);
		expect(parseCommentBody(post({ action: 'post', extra: 1 }))).toEqual(want);
	});

	it('a report needs a lowercase UUID id and no token', () => {
		expect(parseCommentBody(JSON.stringify({ k: K, action: 'report', id: UUID }))).toEqual({
			action: 'report',
			k: K,
			id: UUID
		});
	});

	it('everything else is null', () => {
		for (const body of [
			'not json',
			'[]',
			JSON.stringify({ name: 'A', text: 'hi', token: TOKEN }),
			post({ k: 'bad' }),
			post({ action: 'delete' }),
			post({ name: '' }),
			post({ text: 'x'.repeat(TEXT_MAX + 1) }),
			post({ token: undefined }),
			post({ token: '' }),
			post({ token: 42 }),
			post({ token: 'x'.repeat(TOKEN_MAX + 1) }),
			JSON.stringify({ k: K, action: 'report', id: 'x' }),
			JSON.stringify({ k: K, action: 'report' }),
			JSON.stringify({ k: K, action: 'report', id: `${UUID}/x` }),
			JSON.stringify({ k: K, action: 'report', id: UUID.toUpperCase() })
		]) {
			expect(parseCommentBody(body), body.slice(0, 80)).toBeNull();
		}
	});
});

const item = (id: string, t: number, reporters: string[] = []) => ({ id, name: 'n', text: 'x', t, reporters });

describe('parseThread', () => {
	it('anything not {v:1, items:[...]} is empty', () => {
		for (const text of [null, '', 'not json', '[]', '{"v":2}', '{"v":1,"items":{}}']) {
			expect(parseThread(text)).toEqual(emptyThread());
		}
	});

	it('drops malformed items one by one and round-trips a valid record', () => {
		const good = item('a', 1, ['r1']);
		const rec = {
			v: 1,
			items: [good, { ...good, reporters: 'x' }, { ...good, t: '1' }, { ...good, id: 5 }, { ...good, reporters: [1] }]
		};
		expect(parseThread(JSON.stringify(rec))).toEqual({ v: 1, items: [good] });
		const valid: ThreadRecord = { v: 1, items: [item('b', 2), good] };
		expect(parseThread(JSON.stringify(valid))).toEqual(valid);
	});
});

describe('addComment / addReport / removeComment', () => {
	it('addComment prepends newest-first, adds reporters: [] and never mutates its input', () => {
		const rec = emptyThread();
		const a = addComment(rec, { id: 'a', name: 'n', text: 'x', t: 1 });
		const b = addComment(a, { id: 'b', name: 'n', text: 'x', t: 2 });
		expect(rec.items).toEqual([]);
		expect(a.items.map((i) => i.id)).toEqual(['a']);
		expect(b.items.map((i) => i.id)).toEqual(['b', 'a']);
		expect(b.items[0].reporters).toEqual([]);
	});

	it('caps at MAX_ITEMS, dropping the oldest', () => {
		let rec = emptyThread();
		for (let i = 0; i <= MAX_ITEMS; i++) rec = addComment(rec, { id: `c${i}`, name: 'n', text: 'x', t: i });
		expect(rec.items).toHaveLength(MAX_ITEMS);
		expect(rec.items.some((i) => i.id === 'c0')).toBe(false);
		expect(rec.items[0].id).toBe(`c${MAX_ITEMS}`);
	});

	it('addReport: unknown id → null; idempotent per voter; distinct voters accumulate', () => {
		const rec: ThreadRecord = { v: 1, items: [item('a', 1)] };
		expect(addReport(rec, 'zz', 'v1')).toBeNull();
		const one = addReport(rec, 'a', 'v1')!;
		expect(one.items[0].reporters).toEqual(['v1']);
		expect(rec.items[0].reporters).toEqual([]);
		expect(addReport(one, 'a', 'v1')!.items[0].reporters).toEqual(['v1']);
		const three = addReport(addReport(one, 'a', 'v2')!, 'a', 'v3')!;
		expect(three.items[0].reporters).toHaveLength(3);
	});

	it('removeComment: unknown id → null; known id removed, others intact', () => {
		const rec: ThreadRecord = { v: 1, items: [item('a', 2), item('b', 1)] };
		expect(removeComment(rec, 'zz')).toBeNull();
		expect(removeComment(rec, 'a')).toEqual({ v: 1, items: [item('b', 1)] });
		expect(rec.items).toHaveLength(2);
	});
});

describe('projections', () => {
	const rec: ThreadRecord = {
		v: 1,
		items: [item('old', 1, ['r1', 'r2']), item('hidden', 3, ['r1', 'r2', 'r3']), item('new', 2)]
	};

	it('publicItems hides at HIDE_REPORTS and exposes only id/name/text/t, newest first', () => {
		const out = publicItems(rec);
		expect(out.map((i) => i.id)).toEqual(['new', 'old']);
		for (const i of out) expect(Object.keys(i).sort()).toEqual(['id', 'name', 't', 'text']);
		expect(HIDE_REPORTS).toBe(3);
	});

	it('maintainerItems shows hidden items with counts, never the hashes', () => {
		const out = maintainerItems(rec);
		expect(out.map((i) => [i.id, i.reports, i.hidden])).toEqual([
			['hidden', 3, true],
			['new', 0, false],
			['old', 2, false]
		]);
		const json = JSON.stringify(out);
		for (const h of ['r1', 'r2', 'r3']) expect(json).not.toContain(h);
	});
});

describe('throttle', () => {
	const now = Date.UTC(2026, 8, 26, 12, 0, 0);
	const today = '2026-09-26';

	it('a fresh address is admitted', () => {
		expect(checkThrottle(null, now)).toEqual({ ok: true, next: { last: now, day: today, n: 1 } });
	});

	it('enforces the minimum gap', () => {
		expect(checkThrottle({ last: now - (POST_MIN_GAP_MS - 1), day: today, n: 1 }, now)).toEqual({ ok: false });
		expect(checkThrottle({ last: now - POST_MIN_GAP_MS, day: today, n: 1 }, now)).toEqual({
			ok: true,
			next: { last: now, day: today, n: 2 }
		});
	});

	it('enforces the daily cap and resets on a new UTC day', () => {
		expect(checkThrottle({ last: now - 3_600_000, day: today, n: POST_DAILY_MAX }, now)).toEqual({ ok: false });
		expect(checkThrottle({ last: now - 86_400_000, day: '2026-09-25', n: POST_DAILY_MAX }, now)).toEqual({
			ok: true,
			next: { last: now, day: today, n: 1 }
		});
	});

	it('parseThrottle is never-throw and strict about shape', () => {
		expect(parseThrottle(JSON.stringify({ last: 1, day: today, n: 2 }))).toEqual({ last: 1, day: today, n: 2 });
		for (const text of [null, '', 'x', '[]', '{"last":"1","day":"d","n":1}', '{"last":1,"day":2,"n":1}', '{"last":1,"day":"d"}']) {
			expect(parseThrottle(text)).toBeNull();
		}
	});
});

describe('voterId', () => {
	it('first 16 hex of SHA-256(ip|comments): deterministic, per-ip, never the raw ip', async () => {
		const a = await voterId('1.2.3.4');
		expect(a).toMatch(/^[0-9a-f]{16}$/);
		expect(await voterId('1.2.3.4')).toBe(a);
		expect(await voterId('5.6.7.8')).not.toBe(a);
		expect(a).toBe(createHash('sha256').update('1.2.3.4|comments').digest('hex').slice(0, 16));
		expect(a).not.toContain('1.2.3.4');
	});
});
