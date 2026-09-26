import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { __resetGovernor } from '$lib/services/api-base';
import { songKey } from '$lib/services/dedupe';
import { warmScript } from '$lib/services/zh-convert';
import { commentThreadKey, fetchComments, postComment, reportComment, relativeTime } from './comments';

// quick-260926-nsz — the never-throw client side of per-song comments.

const K = 'ab'.repeat(16);
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ITEM = { id: UUID, name: 'Frank', text: 'hi', t: 1 };

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	__resetGovernor();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('commentThreadKey', () => {
	beforeAll(async () => {
		await warmScript('zh-Hans');
	});

	it('Traditional/Simplified, case and a bracket suffix fold to ONE thread', async () => {
		const k = await commentThreadKey('Gareth.T', '顏色');
		expect(k).toMatch(/^[0-9a-f]{32}$/);
		expect(await commentThreadKey('Gareth.T', '颜色')).toBe(k);
		expect(await commentThreadKey('gareth.t', '颜色 (Live)')).toBe(k);
		expect(await commentThreadKey('Gareth.T', '玻璃')).not.toBe(k);
	});

	it('is the first 32 hex of SHA-256(songKey(artist, title))', async () => {
		expect(songKey('周杰倫', '顏色')).toBe(songKey('周杰伦', '颜色'));
		const want = createHash('sha256').update(songKey('Gareth.T', '顏色')).digest('hex').slice(0, 32);
		expect(await commentThreadKey('Gareth.T', '顏色')).toBe(want);
	});

	it('a blank title or a missing crypto.subtle → null, never a throw', async () => {
		expect(await commentThreadKey('A', '')).toBeNull();
		expect(await commentThreadKey('A', '   ')).toBeNull();
		vi.stubGlobal('crypto', { subtle: undefined });
		await expect(commentThreadKey('A', 'song')).resolves.toBeNull();
	});
});

describe('fetchComments', () => {
	it('GETs exactly /api/comments?k=<k> and returns the items', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: [ITEM] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchComments(K)).toEqual([ITEM]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url.endsWith(`/api/comments?k=${K}`)).toBe(true);
		expect(init?.method ?? 'GET').toBe('GET');
	});

	it('drops a malformed item and keeps the rest', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, items: [ITEM, { ...ITEM, t: '1' }, { ...ITEM, id: 5 }] })));
		expect(await fetchComments(K)).toEqual([ITEM]);
	});

	it('{ok:false}, a 503, a rejecting fetch or an aborted signal → null', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false })));
		expect(await fetchComments(K)).toBeNull();
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, err: 'unconfigured' }, 503)));
		expect(await fetchComments(K)).toBeNull();
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
		expect(await fetchComments(K)).toBeNull();
		__resetGovernor();
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, items: [] })));
		const ac = new AbortController();
		ac.abort();
		expect(await fetchComments(K, ac.signal)).toBeNull();
	});
});

describe('postComment', () => {
	it('POSTs {k,name,text,token} as JSON once and returns the items', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: [ITEM] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await postComment(K, 'Frank', 'hi', 'cf-token')).toEqual({ ok: true, items: [ITEM] });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url.endsWith('/api/comments')).toBe(true);
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({ k: K, name: 'Frank', text: 'hi', token: 'cf-token' });
	});

	it('maps statuses to a closed error set and never throws', async () => {
		const cases: Array<[() => Promise<Response>, string]> = [
			[async () => json({ ok: false, err: 'slow-down' }, 429), 'slow-down'],
			[async () => json({ ok: false, err: 'turnstile' }, 403), 'verify'],
			[async () => json({ ok: false, err: 'forbidden-origin' }, 403), 'invalid'],
			[async () => json({ ok: false, err: 'invalid' }, 400), 'invalid'],
			[async () => json({ ok: false, err: 'too-large' }, 413), 'invalid'],
			[async () => json({ ok: false, err: 'unsupported-type' }, 415), 'invalid'],
			[async () => json({ ok: false, err: 'conflict' }, 409), 'unavailable'],
			[async () => json({ ok: false, err: 'unconfigured' }, 503), 'unavailable'],
			[async () => json({ ok: true, items: 'x' }), 'unavailable'],
			[async () => Promise.reject(new TypeError('network')), 'unavailable']
		];
		for (const [impl, err] of cases) {
			__resetGovernor();
			vi.stubGlobal('fetch', vi.fn(impl));
			expect(await postComment(K, 'n', 't', 'tok')).toEqual({ ok: false, err });
		}
	});
});

describe('reportComment', () => {
	it('POSTs {k,id,action:"report"}; ok → true, anything else → false', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: [] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await reportComment(K, UUID)).toBe(true);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({ k: K, id: UUID, action: 'report' });
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		for (const impl of [
			async () => json({ ok: false }, 404),
			async () => json({ ok: false }, 503),
			async () => Promise.reject(new TypeError('network'))
		]) {
			__resetGovernor();
			vi.stubGlobal('fetch', vi.fn(impl));
			expect(await reportComment(K, UUID)).toBe(false);
		}
	});
});

describe('relativeTime', () => {
	const now = Date.UTC(2026, 8, 26, 12, 0, 0);
	it('picks the largest whole unit', () => {
		const zero = relativeTime(now - 5_000, now, 'en');
		expect(zero.length).toBeGreaterThan(0);
		expect(zero).not.toMatch(/\d/);
		expect(relativeTime(now - 3 * 60_000, now, 'en')).toContain('3');
		expect(relativeTime(now - 2 * 3_600_000, now, 'en')).toContain('2');
		expect(relativeTime(now - 3 * 86_400_000, now, 'en')).toContain('3');
		expect(relativeTime(now - 40 * 86_400_000, now, 'en')).toMatch(/1|last month/);
		expect(relativeTime(now - 800 * 86_400_000, now, 'en')).toContain('2');
	});
	it('a bogus locale falls back to en; zh-Hant works', () => {
		expect(relativeTime(now - 3 * 60_000, now, 'xx-INVALID-!!')).toContain('3');
		expect(relativeTime(now - 3 * 60_000, now, 'zh-Hant').length).toBeGreaterThan(0);
	});
});
