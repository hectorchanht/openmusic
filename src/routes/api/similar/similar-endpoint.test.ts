import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET } from './+server';

// The LASTFM_KEY must NEVER appear in any client-facing artifact (threat T-5ug-01,
// mirrors proxy.test.ts JOOX_TOKEN no-leak tests). A fake key lets us assert the key
// reaches the upstream URL but is absent from the response body + headers.
const FAKE_KEY = 'TESTLASTFMKEY';

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals(); // quick-260713-mqv: reset the caches.default stub between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/similar');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
	};
}

const SIMILAR_PAYLOAD = JSON.stringify({
	similarartists: {
		artist: [{ name: '林俊杰' }, { name: '陈奕迅' }, { name: '林俊杰' }] // dup to test dedupe
	}
});

describe('/api/similar — Last.fm key injected upstream, ABSENT from client response (no-leak)', () => {
	it('injects the key into the upstream fetch but never echoes it to the client body/headers', async () => {
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

		const event = fakeEvent({ artist: '周杰伦', limit: '8' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// (a) upstream URL carries the injected key (server → upstream only)
		expect(capturedUpstreamUrl).toContain(`api_key=${FAKE_KEY}`);
		expect(capturedUpstreamUrl).toContain('artist.getsimilar');
		expect(capturedUpstreamUrl).toContain(encodeURIComponent('周杰伦'));
		// (b) the client-facing response body does NOT contain the key
		expect(body).not.toContain(FAKE_KEY);
		// (c) no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_KEY);

		// returns clean, deduped artist names
		const parsed = JSON.parse(body) as { artists: string[] };
		expect(parsed.artists).toEqual(['林俊杰', '陈奕迅']);
	});

	it('returns 200 { artists: [] } and does NOT fetch when LASTFM_KEY is missing', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent({ artist: '周杰伦' }); // no platform.env → no key
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as { artists: string[] };
		expect(parsed.artists).toEqual([]);

		// must NOT have fetched an upstream (esp. not api_key=undefined)
		expect(fetchSpy).not.toHaveBeenCalled();
		const calledWithUndefinedKey = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('api_key=undefined')
		);
		expect(calledWithUndefinedKey).toBe(false);
	});

	it('returns { artists: [] } on malformed upstream JSON (best-effort fallback)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json at all', { status: 200 }))
		);

		const event = fakeEvent({ artist: '周杰伦' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as { artists: string[] };
		expect(parsed.artists).toEqual([]);
	});
});

// quick-260713-mqv: artist.getSimilar success is now edge-cached in caches.default with an
// OWN-ORIGIN key + 24h TTL. These mirror the deezer/search cache-hit pattern: an in-memory
// caches.default stub, two identical requests, the SECOND served from cache with NO second
// upstream fetch. Error/EMPTY responses are never written (self-heal within TTL).
describe('/api/similar — edge cache (own-origin key, success only)', () => {
	function inMemoryCacheStub() {
		const store = new Map<string, Response>();
		return {
			match: vi.fn(async (req: Request) => {
				const hit = store.get(req.url);
				return hit ? hit.clone() : undefined;
			}),
			put: vi.fn(async (req: Request, res: Response) => {
				store.set(req.url, res.clone());
			})
		};
	}

	it('sets Cache-Control: public, max-age=86400 on a success', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(SIMILAR_PAYLOAD, { status: 200 })));
		const event = fakeEvent({ artist: '周杰伦' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const cc = res.headers.get('Cache-Control') ?? '';
		expect(cc).toContain('public');
		expect(cc).toContain('max-age=86400');
	});

	it('serves the second identical request from caches.default WITHOUT a second upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response(SIMILAR_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const cacheStub = inMemoryCacheStub();
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () => fakeEvent({ artist: '周杰伦' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		const body1 = JSON.parse(await res1.text()) as { artists: string[] };
		expect(body1.artists).toEqual(['林俊杰', '陈奕迅']);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(mk() as any);
		const body2 = JSON.parse(await res2.text()) as { artists: string[] };
		expect(body2.artists).toEqual(['林俊杰', '陈奕迅']);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // no second upstream fetch — served from cache
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
		// cache hit re-applies CORS for THIS origin (WR-01)
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
	});

	it('uses the own-origin Request as the cache key (NEVER the LASTFM_KEY-bearing upstream URL)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(SIMILAR_PAYLOAD, { status: 200 })));
		let cacheKeyUrl = '';
		const cacheStub = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async (req: Request) => {
				cacheKeyUrl = req.url;
			})
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const event = fakeEvent({ artist: '周杰伦' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(cacheStub.put).toHaveBeenCalled();
		expect(cacheKeyUrl).toContain('openmusic.lol/api/similar');
		expect(cacheKeyUrl).not.toContain('audioscrobbler.com');
		expect(cacheKeyUrl).not.toContain(FAKE_KEY);
	});

	it('does NOT cache an error/EMPTY response (malformed JSON → second request refetches upstream)', async () => {
		const fetchSpy = vi.fn(async () => new Response('not json at all', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const cacheStub = inMemoryCacheStub();
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () => fakeEvent({ artist: '周杰伦' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		expect((JSON.parse(await res1.text()) as { artists: string[] }).artists).toEqual([]);
		expect(cacheStub.put).not.toHaveBeenCalled(); // error path never writes the cache

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(mk() as any);
		expect(fetchSpy).toHaveBeenCalledTimes(2); // nothing cached → upstream hit again
	});
});
