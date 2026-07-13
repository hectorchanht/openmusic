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
	vi.unstubAllGlobals(); // quick-260713-mqv: reset the caches.default stub between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
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

	// --- Phase 26-07 Gap 3: Last.fm per-track image passthrough (largest https, placeholder filtered) ---

	// Last.fm placeholder-star image hash — any URL containing it must be dropped (never a cover).
	const PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

	it('passes through the LARGEST https Last.fm image (extralarge > large > medium > small)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						similartracks: {
							track: [
								{
									name: 'Someone Like You',
									match: '1',
									artist: { name: 'Adele' },
									image: [
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/34s/small.png', size: 'small' },
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/64s/medium.png', size: 'medium' },
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/large.png', size: 'large' },
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/extralarge.png', size: 'extralarge' }
									]
								}
							]
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
		);
		const event = fakeEvent({ artist: 'Adele', track: 'Hello' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as {
			tracks: { artist: string; title: string; match: number; image?: string }[];
		};
		expect(parsed.tracks[0].image).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/extralarge.png');
	});

	it('falls back to the next-largest https image when extralarge is absent', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						similartracks: {
							track: [
								{
									name: 'Chandelier',
									match: '0.8',
									artist: { name: 'Sia' },
									image: [
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/34s/small.png', size: 'small' },
										{ '#text': 'https://lastfm.freetls.fastly.net/i/u/174s/large.png', size: 'large' }
									]
								}
							]
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
		);
		const event = fakeEvent({ artist: 'Sia', track: 'X' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as { tracks: { image?: string }[] };
		expect(parsed.tracks[0].image).toBe('https://lastfm.freetls.fastly.net/i/u/174s/large.png');
	});

	it('drops the placeholder-star image and any non-https image → no image field', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						similartracks: {
							track: [
								{
									name: 'Placeholderish',
									match: '0.9',
									artist: { name: 'Nobody' },
									image: [
										// all placeholder-star + a non-https entry → nothing solid survives
										{ '#text': `https://lastfm.freetls.fastly.net/i/u/174s/${PLACEHOLDER_HASH}.png`, size: 'large' },
										{ '#text': `https://lastfm.freetls.fastly.net/i/u/300x300/${PLACEHOLDER_HASH}.png`, size: 'extralarge' },
										{ '#text': 'http://insecure.example/cover.png', size: 'medium' },
										{ '#text': '', size: 'small' }
									]
								}
							]
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
		);
		const event = fakeEvent({ artist: 'Nobody', track: 'Z' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as { tracks: { image?: string }[] };
		expect(parsed.tracks[0].image).toBeUndefined();
	});

	it('a track with NO image array returns cleanly (no image field, shape intact)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						similartracks: {
							track: [{ name: 'Bare', match: '0.5', artist: { name: 'Solo' } }]
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
		);
		const event = fakeEvent({ artist: 'Solo', track: 'W' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as {
			tracks: { artist: string; title: string; match: number; image?: string }[];
		};
		expect(parsed.tracks[0]).toEqual({ artist: 'Solo', title: 'Bare', match: 0.5 });
		expect('image' in parsed.tracks[0]).toBe(false);
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

// quick-260713-mqv: track.getSimilar success is now edge-cached in caches.default with an
// OWN-ORIGIN key + 24h TTL. Mirrors the deezer/search cache-hit pattern; the Last.fm error / EMPTY
// paths are never written.
describe('/api/lastfm/similar-tracks — edge cache (own-origin key, success only)', () => {
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
		const event = fakeEvent({ artist: 'Adele', track: 'Hello' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
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

		const mk = () => fakeEvent({ artist: 'Adele', track: 'Hello' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		const body1 = JSON.parse(await res1.text()) as { tracks: { title: string }[] };
		expect(body1.tracks[0].title).toBe('Someone Like You');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(mk() as any);
		const body2 = JSON.parse(await res2.text()) as { tracks: { title: string }[] };
		expect(body2.tracks[0].title).toBe('Someone Like You');
		expect(fetchSpy).toHaveBeenCalledTimes(1); // no second upstream fetch — served from cache
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN); // WR-01 re-applied
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

		const event = fakeEvent({ artist: 'Adele', track: 'Hello' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(cacheStub.put).toHaveBeenCalled();
		expect(cacheKeyUrl).toContain('openmusic.lol/api/lastfm/similar-tracks');
		expect(cacheKeyUrl).not.toContain('audioscrobbler.com');
		expect(cacheKeyUrl).not.toContain(FAKE_KEY);
	});

	it('does NOT cache a Last.fm error body (error-6 → second request refetches upstream)', async () => {
		const fetchSpy = vi.fn(async () =>
			new Response(JSON.stringify({ error: 6, message: 'Track not found' }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const cacheStub = inMemoryCacheStub();
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () => fakeEvent({ artist: 'A', track: 'B' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		expect((JSON.parse(await res1.text()) as { tracks: unknown[] }).tracks).toEqual([]);
		expect(cacheStub.put).not.toHaveBeenCalled(); // error path never writes the cache

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(mk() as any);
		expect(fetchSpy).toHaveBeenCalledTimes(2); // nothing cached → upstream hit again
	});
});
