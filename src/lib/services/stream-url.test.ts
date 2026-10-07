// Tests for fetchDirectStreamUrl (direct-first playback URL helper).
//
// Never-throw contract: anything but a 200 with an https:// `url` maps to null —
// the adapter then keeps its proxy URL and the listener never sees the difference.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchDirectStreamUrl } from './stream-url';
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
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__resetGovernor();
});

describe('fetchDirectStreamUrl', () => {
	it('returns the https url on a 200 { url }', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(200, { url: 'https://m8.music.126.net/x.mp3' }));
		const out = await fetchDirectStreamUrl('netease', '123', ac.signal);
		expect(out).toBe('https://m8.music.126.net/x.mp3');
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(502, { error: 'upstream failed' }));
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
