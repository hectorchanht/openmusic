import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { __resetGovernor } from '$lib/services/api-base';
import { lyricOffsetKey, fetchSharedOffset, submitOffsetVote } from './lyric-offset-shared';

// quick-260926-mzn — the never-throw client side of shared lyric offsets.

const K = 'ab'.repeat(16);

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	__resetGovernor();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('lyricOffsetKey', () => {
	it('is the first 32 hex of SHA-256(uid + "\\n" + lrc)', async () => {
		const k = await lyricOffsetKey('netease:1', '[00:01.00]a');
		expect(k).toMatch(/^[0-9a-f]{32}$/);
		const want = createHash('sha256').update('netease:1\n[00:01.00]a').digest('hex').slice(0, 32);
		expect(k).toBe(want);
	});
	it('changes with the lyrics text and with the uid', async () => {
		const k = await lyricOffsetKey('netease:1', '[00:01.00]a');
		expect(await lyricOffsetKey('netease:1', '[00:01.00]b')).not.toBe(k);
		expect(await lyricOffsetKey('netease:2', '[00:01.00]a')).not.toBe(k);
	});
	it('resolves null without crypto.subtle (non-secure origin)', async () => {
		vi.stubGlobal('crypto', { subtle: undefined });
		await expect(lyricOffsetKey('netease:1', 'x')).resolves.toBeNull();
	});
});

describe('fetchSharedOffset', () => {
	it('GETs exactly /api/lyric-offset?k=<k> and returns the offset', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, offset: 1.5, n: 3 }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchSharedOffset(K)).toBe(1.5);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url.endsWith(`/api/lyric-offset?k=${K}`)).toBe(true);
		expect(init?.method ?? 'GET').toBe('GET');
	});
	it('null / non-number offsets are null; out-of-range is normalized on read', async () => {
		for (const [body, want] of [
			[{ ok: true, offset: null, n: 0 }, null],
			[{ ok: true, offset: 'x' }, null],
			[{ ok: true, offset: 1e9 }, 600]
		] as const) {
			__resetGovernor();
			vi.stubGlobal('fetch', vi.fn(async () => json(body)));
			expect(await fetchSharedOffset(K)).toBe(want);
		}
	});
	it('a 503, a rejecting fetch, or an aborted signal resolve null', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, err: 'unconfigured' }, 503)));
		expect(await fetchSharedOffset(K)).toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
		expect(await fetchSharedOffset(K)).toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, offset: 1 })));
		const ac = new AbortController();
		ac.abort();
		expect(await fetchSharedOffset(K, ac.signal)).toBeNull();
	});
});

describe('submitOffsetVote', () => {
	it('POSTs a normalized JSON vote with a JSON content-type, once', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, offset: null, n: 1 }));
		vi.stubGlobal('fetch', fetchMock);
		await submitOffsetVote(K, 2.34);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url.endsWith('/api/lyric-offset')).toBe(true);
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({ k: K, offset: 2.3 });
	});
	it('never throws on 409 / 503 / network failure', async () => {
		for (const f of [
			async () => json({ ok: false, err: 'conflict' }, 409),
			async () => json({ ok: false, err: 'unconfigured' }, 503),
			async () => Promise.reject(new TypeError('network'))
		]) {
			vi.stubGlobal('fetch', vi.fn(f));
			await expect(submitOffsetVote(K, 1)).resolves.toBeUndefined();
		}
	});
});
