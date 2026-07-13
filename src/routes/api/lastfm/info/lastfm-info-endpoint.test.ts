import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET, OPTIONS } from './+server';

// The LASTFM_KEY must NEVER appear in any client-facing artifact (threat T-08-01,
// mirrors similar-endpoint.test.ts). A fake key lets us assert the key reaches the
// upstream URL but is absent from the response body + headers.
const FAKE_KEY = 'TESTLASTFMKEY';
const GREY_STAR = '2a96cbd8b46e442fc41c2b86b821562f';

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals(); // quick-260713-mqv: reset the caches.default stub between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/lastfm/info');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
	};
}

type Info = {
	tags: string[];
	bio: string | null;
	bioUrl: string | null;
	image: string | null;
	listeners: number | null;
	playcount: number | null;
	tracks?: { artist: string; title: string }[];
};

const TRACK_PAYLOAD = JSON.stringify({
	track: {
		listeners: '123',
		playcount: '456',
		toptags: {
			tag: [
				{ name: 'mandopop' },
				{ name: 'pop' },
				{ name: 'chinese' },
				{ name: 'ballad' },
				{ name: 'rnb' },
				{ name: 'sixth-should-be-dropped' }
			]
		},
		album: {
			image: [
				{ '#text': 'https://lastfm.freetls.fastly.net/small.png', size: 'small' },
				{ '#text': 'https://lastfm.freetls.fastly.net/extralarge.png', size: 'extralarge' }
			]
		},
		wiki: { summary: 'A great track. Second sentence here.' }
	}
});

describe('/api/lastfm/info — Last.fm key injected upstream, ABSENT from client response (no-leak)', () => {
	it('injects the key into the upstream fetch but never echoes it to the client body/headers', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				return new Response(TRACK_PAYLOAD, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// (a) upstream URL carries the injected key + method + the encoded non-ASCII fixture
		expect(capturedUpstreamUrl).toContain(`api_key=${FAKE_KEY}`);
		expect(capturedUpstreamUrl).toContain('method=track.getinfo');
		expect(capturedUpstreamUrl).toContain(encodeURIComponent('周杰伦'));
		// (b) the client-facing response body does NOT contain the key
		expect(body).not.toContain(FAKE_KEY);
		// (c) no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_KEY);

		// returns the clean reshaped info (tags capped at 5, album art picked)
		const parsed = JSON.parse(body) as Info;
		expect(parsed.tags).toEqual(['mandopop', 'pop', 'chinese', 'ballad', 'rnb']);
		expect(parsed.image).toBe('https://lastfm.freetls.fastly.net/extralarge.png');
		expect(parsed.listeners).toBe(123);
		expect(parsed.playcount).toBe(456);
	});

	it('returns 200 all-empty shape and does NOT fetch when LASTFM_KEY is missing', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent({ method: 'track.getinfo', artist: '周杰伦', track: '稻香' }); // no platform.env
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed).toEqual({
			tags: [],
			bio: null,
			bioUrl: null,
			image: null,
			listeners: null,
			playcount: null
		});

		// must NOT have fetched an upstream (esp. not api_key=undefined)
		expect(fetchSpy).not.toHaveBeenCalled();
		const calledWithUndefinedKey = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('api_key=undefined')
		);
		expect(calledWithUndefinedKey).toBe(false);
	});

	it('returns all-empty shape on malformed upstream JSON (best-effort fallback)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json at all', { status: 200 }))
		);
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(parsed.image).toBeNull();
	});

	it('returns all-empty shape on a Last.fm error-6 body (silent best-effort)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 6, message: 'Track not found' }), { status: 200 })
			)
		);
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: 'Nope', track: 'Nope' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(parsed.bio).toBeNull();
		expect(parsed.image).toBeNull();
	});

	it('rejects a method outside the allow-list with the empty shape and no fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const event = fakeEvent(
			{ method: 'user.getlovedtracks', artist: 'x' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tags).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('placeholder filter: grey-star hash image is never returned (image: null)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							album: {
								tags: { tag: [{ name: 'rock' }] },
								image: [
									{ '#text': '', size: 'small' },
									{ '#text': `https://lastfm.freetls.fastly.net/i/u/300x300/${GREY_STAR}.png`, size: 'extralarge' }
								]
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'album.getinfo', artist: 'X', album: 'Y' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.image).toBeNull(); // grey-star / empty filtered → null
		expect(parsed.tags).toEqual(['rock']);
	});

	it('artist.getinfo: extracts bio summary (HTML-stripped) + attribution bioUrl', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							artist: {
								stats: { listeners: '999', playcount: '8888' },
								tags: { tag: [{ name: 'pop' }, { name: 'mandopop' }] },
								bio: {
									summary:
										'Jay Chou is a Taiwanese musician. He is huge. <a href="https://www.last.fm/music/Jay+Chou">Read more on Last.fm</a>.'
								}
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'artist.getinfo', artist: 'Jay Chou' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.bio).toContain('Jay Chou is a Taiwanese musician');
		expect(parsed.bio).not.toContain('<a href'); // HTML stripped
		expect(parsed.bioUrl).toBe('https://www.last.fm/music/Jay+Chou');
		expect(parsed.tags).toEqual(['pop', 'mandopop']);
		expect(parsed.listeners).toBe(999);
	});

	// quick-260711-spt: Last.fm returns a boilerplate-only summary (just the attribution
	// <a>Read more on Last.fm</a> with no prose) for artists with no wiki. That must resolve
	// to bio: null so the artist-page About section hides instead of rendering a bogus
	// "Read more on Last.fm" <p> above the real attribution link.
	it('artist.getinfo: boilerplate-only bio summary yields bio: null', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							artist: {
								bio: {
									summary:
										'<a href="https://www.last.fm/music/Edan">Read more on Last.fm</a>.'
								}
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'artist.getinfo', artist: 'Edan' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.bio).toBeNull();
	});

	// CR-01 (security): bioUrl is rendered as href on the artist page; Svelte does NOT
	// sanitize href bindings, so a javascript:/data:/off-domain href would be a clickable
	// XSS vector. The edge must hand the client only an https:// last.fm URL.
	it('rejects a non-https / off-domain attribution href (bioUrl: null), bio text still returned', async () => {
		const cases = [
			'javascript:alert(document.cookie)//',
			'data:text/html,<script>alert(1)</script>',
			'https://evil.example.com/last.fm-phish',
			'http://www.last.fm/music/X' // http (not https) — rejected
		];
		for (const href of cases) {
			vi.stubGlobal(
				'fetch',
				vi.fn(
					async () =>
						new Response(
							JSON.stringify({
								artist: {
									bio: { summary: `Real bio text here. <a href="${href}">Read more on Last.fm</a>.` }
								}
							}),
							{ status: 200 }
						)
				)
			);
			const event = fakeEvent(
				{ method: 'artist.getinfo', artist: 'X' },
				{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
			);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res = await GET(event as any);
			const parsed = JSON.parse(await res.text()) as Info;
			expect(parsed.bioUrl, `href should be rejected: ${href}`).toBeNull();
			expect(parsed.bio).toContain('Real bio text here'); // bio body still surfaced
		}
	});
});

// Task 2 (Phase 9, D-04/D-05): album.getinfo additionally surfaces an ORDERED tracklist
// (LastfmInfo.tracks) — the tracks the Phase-8 reshaper dropped. Single-entity getInfo
// (track/artist) leaves tracks undefined so the existing 5-field contract is unchanged.
describe('/api/lastfm/info — album.getinfo ordered tracklist (D-05)', () => {
	it('reshapes album.tracks.track[] into an ordered { artist, title }[] preserving order', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							album: {
								tags: { tag: [{ name: 'mandopop' }] },
								image: [{ '#text': 'https://lastfm.freetls.fastly.net/album.png', size: 'extralarge' }],
								tracks: {
									track: [
										{ name: '稻香', artist: { name: '周杰伦' }, '@attr': { rank: '1' } },
										{ name: '说好的幸福呢', artist: { name: '周杰伦' }, '@attr': { rank: '2' } },
										{ name: '魔术先生', artist: { name: '周杰伦' }, '@attr': { rank: '3' } }
									]
								}
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'album.getinfo', artist: '周杰伦', album: '魔杰座' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tracks).toEqual([
			{ artist: '周杰伦', title: '稻香' },
			{ artist: '周杰伦', title: '说好的幸福呢' },
			{ artist: '周杰伦', title: '魔术先生' }
		]);
		// existing single-entity fields still present (no regression)
		expect(parsed.image).toBe('https://lastfm.freetls.fastly.net/album.png');
		expect(parsed.tags).toEqual(['mandopop']);
	});

	it('handles a one-track album returned as a single object (array-or-single quirk)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							album: {
								tracks: { track: { name: 'Solo', artist: { name: 'Mono' }, '@attr': { rank: '1' } } }
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'album.getinfo', artist: 'Mono', album: 'One' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tracks).toEqual([{ artist: 'Mono', title: 'Solo' }]);
	});

	it('album.getinfo with no tracks block → tracks undefined (EMPTY deep-equal still holds)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ album: { name: 'Bare' } }), { status: 200 }))
		);
		const event = fakeEvent(
			{ method: 'album.getinfo', artist: 'X', album: 'Bare' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tracks).toBeUndefined();
		// the rest deep-equals the all-empty single-entity shape (no array leakage)
		expect(parsed).toEqual({
			tags: [],
			bio: null,
			bioUrl: null,
			image: null,
			listeners: null,
			playcount: null
		});
	});

	it('track.getinfo leaves tracks undefined (single-entity contract unchanged)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(TRACK_PAYLOAD, { status: 200 }))
		);
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as Info;
		expect(parsed.tracks).toBeUndefined();
		expect(parsed.tags).toEqual(['mandopop', 'pop', 'chinese', 'ballad', 'rnb']);
	});
});

describe('/api/lastfm/info — CORS preflight', () => {
	it('OPTIONS returns 204 with scoped corsHeaders', async () => {
		const req = new Request('https://openmusic.lol/api/lastfm/info', {
			method: 'OPTIONS',
			headers: { origin: 'https://openmusic.lol' }
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await OPTIONS({ request: req } as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		// never `*`
		expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
	});
});

// quick-260713-mqv: getInfo success is now edge-cached in caches.default with an OWN-ORIGIN key
// + 6h TTL. Mirrors the deezer/search cache-hit pattern; the !key / bad-method / data.error /
// !entity / catch EMPTY paths are never written.
describe('/api/lastfm/info — edge cache (own-origin key, success only)', () => {
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

	it('sets Cache-Control: public, max-age=21600 on a success', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(TRACK_PAYLOAD, { status: 200 })));
		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const cc = res.headers.get('Cache-Control') ?? '';
		expect(cc).toContain('public');
		expect(cc).toContain('max-age=21600');
	});

	it('serves the second identical request from caches.default WITHOUT a second upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response(TRACK_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const cacheStub = inMemoryCacheStub();
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () =>
			fakeEvent(
				{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
				{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
			);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		const body1 = JSON.parse(await res1.text()) as Info;
		expect(body1.listeners).toBe(123);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(mk() as any);
		const body2 = JSON.parse(await res2.text()) as Info;
		expect(body2.listeners).toBe(123);
		expect(body2.tags).toEqual(['mandopop', 'pop', 'chinese', 'ballad', 'rnb']);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // no second upstream fetch — served from cache
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol'); // WR-01
	});

	it('uses the own-origin Request as the cache key (NEVER the LASTFM_KEY-bearing upstream URL)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(TRACK_PAYLOAD, { status: 200 })));
		let cacheKeyUrl = '';
		const cacheStub = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async (req: Request) => {
				cacheKeyUrl = req.url;
			})
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const event = fakeEvent(
			{ method: 'track.getinfo', artist: '周杰伦', track: '稻香' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(cacheStub.put).toHaveBeenCalled();
		expect(cacheKeyUrl).toContain('openmusic.lol/api/lastfm/info');
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

		const mk = () =>
			fakeEvent(
				{ method: 'track.getinfo', artist: 'Nope', track: 'Nope' },
				{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
			);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		expect((JSON.parse(await res1.text()) as Info).tags).toEqual([]);
		expect(cacheStub.put).not.toHaveBeenCalled(); // error path never writes the cache

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(mk() as any);
		expect(fetchSpy).toHaveBeenCalledTimes(2); // nothing cached → upstream hit again
	});
});
