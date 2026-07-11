import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET, OPTIONS } from './+server';

// The LASTFM_KEY must NEVER appear in any client-facing artifact (threat T-26-03-01,
// mirrors similar-endpoint.test.ts / proxy.test.ts JOOX_TOKEN no-leak tests). A fake key
// lets us assert the key reaches the upstream URL but is absent from the response body.
const FAKE_KEY = 'TESTLASTFMKEY';
const ORIGIN = 'https://openmusic.lol';

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/lastfm/similar-tracks');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: ORIGIN } })
	};
}

// Upstream track.getSimilar body — deliberately NOT in ascending order to prove we
// PRESERVE the upstream match-descending order rather than re-sorting client-side.
const SIMILAR_PAYLOAD = JSON.stringify({
	similartracks: {
		track: [
			{ name: 'Someone Like You', match: '1', artist: { name: 'Adele' } },
			{ name: 'Rolling in the Deep', match: '0.72', artist: { name: 'Adele' } },
			{ name: '', match: '0.5', artist: { name: 'NoTitle' } }, // dropped (missing title)
			{ name: 'Orphan', match: '0.3' } // dropped (missing artist)
		]
	}
});

describe('/api/lastfm/similar-tracks — track.getSimilar proxy', () => {
	it('injects the key upstream, returns a clean {tracks:[{artist,title,match}]} match-ordered, never leaks the key', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				return new Response(SIMILAR_PAYLOAD, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		const event = fakeEvent(
			{ artist: 'Adele', track: 'Hello', limit: '8' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// (a) upstream URL carries the injected key + the fixed track.getsimilar method + both params
		expect(capturedUpstreamUrl).toContain(`api_key=${FAKE_KEY}`);
		expect(capturedUpstreamUrl).toContain('track.getsimilar');
		expect(capturedUpstreamUrl).toContain('artist=Adele');
		expect(capturedUpstreamUrl).toContain('track=Hello');
		expect(capturedUpstreamUrl).toContain('autocorrect=1');
		// (b) the client-facing response body does NOT contain the key
		expect(body).not.toContain(FAKE_KEY);
		// (c) no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_KEY);

		// clean shape, incomplete pairs dropped, order PRESERVED (descending match)
		const parsed = JSON.parse(body) as { tracks: { artist: string; title: string; match: number }[] };
		expect(parsed.tracks).toEqual([
			{ artist: 'Adele', title: 'Someone Like You', match: 1 },
			{ artist: 'Adele', title: 'Rolling in the Deep', match: 0.72 }
		]);
		// match is a NUMBER, not the upstream string
		expect(typeof parsed.tracks[0].match).toBe('number');
	});

	it('handles Last.fm array-or-single quirk (a single similar track returned as an object)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({ similartracks: { track: { name: 'Solo', match: 0.9, artist: { name: 'X' } } } }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
		);
		const event = fakeEvent({ artist: 'X', track: 'Y' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as { tracks: { artist: string; title: string }[] };
		expect(parsed.tracks).toEqual([{ artist: 'X', title: 'Solo', match: 0.9 }]);
	});

	it('returns 200 { tracks: [] } and does NOT fetch when LASTFM_KEY is missing', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent({ artist: 'Adele', track: 'Hello' }); // no platform.env → no key
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		expect((JSON.parse(await res.text()) as { tracks: unknown[] }).tracks).toEqual([]);

		// must NOT have fetched an upstream (esp. not api_key=undefined)
		expect(fetchSpy).not.toHaveBeenCalled();
		const calledWithUndefinedKey = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('api_key=undefined')
		);
		expect(calledWithUndefinedKey).toBe(false);
	});

	it('returns 200 { tracks: [] } and does NOT fetch when artist or track is missing', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		// only artist, no track
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r1 = await GET(fakeEvent({ artist: 'Adele' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }) as any);
		expect((JSON.parse(await r1.text()) as { tracks: unknown[] }).tracks).toEqual([]);
		// only track, no artist
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r2 = await GET(fakeEvent({ track: 'Hello' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }) as any);
		expect((JSON.parse(await r2.text()) as { tracks: unknown[] }).tracks).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns { tracks: [] } on a Last.fm error body (error-6 not found)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ error: 6, message: 'Track not found' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		const event = fakeEvent({ artist: 'A', track: 'B' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		expect((JSON.parse(await res.text()) as { tracks: unknown[] }).tracks).toEqual([]);
	});

	it('returns { tracks: [] } on malformed upstream JSON / upstream throw (best-effort fallback)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('not json at all', { status: 200 })));
		const event = fakeEvent({ artist: 'A', track: 'B' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		expect((JSON.parse(await res.text()) as { tracks: unknown[] }).tracks).toEqual([]);
	});

	it('OPTIONS returns 204 with own-origin CORS headers (never *)', async () => {
		const req = new Request('https://openmusic.lol/api/lastfm/similar-tracks', {
			method: 'OPTIONS',
			headers: { origin: ORIGIN }
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await OPTIONS({ request: req } as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
	});
});
