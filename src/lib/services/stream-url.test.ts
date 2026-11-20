// Tests for fetchDirectStreamUrl (direct-first playback URL helper).
//
// Never-throw contract: anything but a 200 with an https:// `url` maps to null —
// the adapter then keeps its proxy URL and the listener never sees the difference.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchDirectStreamUrl } from './stream-url';
import { getCachedDirectUrl, invalidateDirectUrl, __resetDirectUrlCache } from './direct-url-cache';
import { __resetGovernor } from './api-base';

const ac = new AbortController();

function mockFetchOnce(status: number, body: unknown) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
	__resetGovernor();
	__resetDirectUrlCache();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__resetGovernor();
	__resetDirectUrlCache();
});

describe('fetchDirectStreamUrl', () => {
	it('returns the https url on a 200 { url }', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(200, { url: 'https://m8.music.126.net/x.mp3' }));
		const out = await fetchDirectStreamUrl('netease', '123', ac.signal);
		expect(out).toBe('https://m8.music.126.net/x.mp3');
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(503, { error: 'upstream failed' }));
		const out = await fetchDirectStreamUrl('audius', '999', ac.signal);
		expect(out).toBeNull();
	});

	it('returns null when the body carries an error instead of a url', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(200, { error: 'no redirect' }));
		const out = await fetchDirectStreamUrl('netease', '123', ac.signal);
		expect(out).toBeNull();
	});

	it('returns null for a non-https url (mixed-content guard)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(200, { url: 'http://m8.music.126.net/x.mp3' }));
		const out = await fetchDirectStreamUrl('netease', '123', ac.signal);
		expect(out).toBeNull();
	});

	it('returns null when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		const out = await fetchDirectStreamUrl('audius', '999', ac.signal);
		expect(out).toBeNull();
	});

	it('hits /api/stream-url with source + id params', async () => {
		const fetchMock = mockFetchOnce(200, { url: 'https://cdn.example/x.mp3' });
		vi.stubGlobal('fetch', fetchMock);
		await fetchDirectStreamUrl('audius', 'abc 123', ac.signal);
		const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
		expect(calledUrl).toContain('/api/stream-url?source=audius&id=abc%20123');
	});
});

describe('fetchDirectStreamUrl — resolve cache (quick-261006-r2)', () => {
	it('caches a success: the second call skips the fetch', async () => {
		const fetchMock = mockFetchOnce(200, { url: 'https://m801.music.126.net/x.mp3' });
		vi.stubGlobal('fetch', fetchMock);

		const first = await fetchDirectStreamUrl('netease', 'cache-1', ac.signal);
		const second = await fetchDirectStreamUrl('netease', 'cache-1', ac.signal);

		expect(first).toBe('https://m801.music.126.net/x.mp3');
		expect(second).toBe('https://m801.music.126.net/x.mp3');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(getCachedDirectUrl('netease', 'cache-1')).toBe('https://m801.music.126.net/x.mp3');
	});

	it('never caches a failure: a non-ok then a 200 re-fetches', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: 'upstream failed' }), { status: 503 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ url: 'https://m801.music.126.net/x.mp3' }), { status: 200 })
			);
		vi.stubGlobal('fetch', fetchMock);

		expect(await fetchDirectStreamUrl('netease', 'cache-2', ac.signal)).toBeNull();
		expect(getCachedDirectUrl('netease', 'cache-2')).toBeNull(); // failures are never written
		expect(await fetchDirectStreamUrl('netease', 'cache-2', ac.signal)).toBe(
			'https://m801.music.126.net/x.mp3'
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('invalidateDirectUrl forces a re-resolve', async () => {
		const fetchMock = mockFetchOnce(200, { url: 'https://m801.music.126.net/x.mp3' });
		vi.stubGlobal('fetch', fetchMock);

		await fetchDirectStreamUrl('netease', 'cache-3', ac.signal);
		invalidateDirectUrl('netease', 'cache-3');
		await fetchDirectStreamUrl('netease', 'cache-3', ac.signal);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('the cache is keyed by source+id: no cross-key hits', async () => {
		const fetchMock = mockFetchOnce(200, { url: 'https://m801.music.126.net/x.mp3' });
		vi.stubGlobal('fetch', fetchMock);

		await fetchDirectStreamUrl('netease', 'cache-4', ac.signal);
		// a different source with the same id must miss the cache and hit the network
		await fetchDirectStreamUrl('audius', 'cache-4', ac.signal);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
