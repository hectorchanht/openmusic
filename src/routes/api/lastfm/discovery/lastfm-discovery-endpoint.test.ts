import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET, OPTIONS } from './+server';

// The LASTFM_KEY must NEVER appear in any client-facing artifact (threat T-09-01,
// mirrors lastfm-info-endpoint.test.ts). A fake key lets us assert the key reaches
// the upstream URL but is absent from the response body + headers.
const FAKE_KEY = 'TESTLASTFMKEY';
const GREY_STAR = '2a96cbd8b46e442fc41c2b86b821562f';

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/lastfm/discovery');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
	};
}

type ListItem = {
	artist?: string;
	title?: string;
	name?: string;
	image: string | null;
	mbid?: string | null;
};
type List = { items: ListItem[] };

const JAY_MBID = 'b1a9c0e9-d987-4042-ae91-78d6a3267d69';

const CHART_TRACKS_PAYLOAD = JSON.stringify({
	tracks: {
		track: [
			{
				name: '稻香',
				artist: { name: '周杰伦' },
				mbid: JAY_MBID, // FIX-B: surfaced through the reshape for the client CAA cover
				image: [
					{ '#text': 'https://lastfm.freetls.fastly.net/small.png', size: 'small' },
					{ '#text': 'https://lastfm.freetls.fastly.net/extralarge.png', size: 'extralarge' }
				]
			},
			{
				name: 'Shape of You',
				artist: { name: 'Ed Sheeran' },
				mbid: '', // empty upstream mbid → reshaped to null
				image: [{ '#text': 'https://lastfm.freetls.fastly.net/ed.png', size: 'large' }]
			}
		]
	}
});

const CHART_ARTISTS_PAYLOAD = JSON.stringify({
	artists: {
		artist: [
			{ name: '周杰伦', mbid: JAY_MBID, image: [{ '#text': 'https://lastfm.freetls.fastly.net/jay.png', size: 'extralarge' }] },
			{ name: 'Taylor Swift', image: [{ '#text': 'https://lastfm.freetls.fastly.net/ts.png', size: 'large' }] }
		]
	}
});

const ALBUM1_MBID = 'c2b9d1f0-aaaa-bbbb-cccc-78d6a3267d70';
const TOP_ALBUMS_PAYLOAD = JSON.stringify({
	topalbums: {
		album: [
			{ name: '魔杰座', mbid: ALBUM1_MBID, image: [{ '#text': 'https://lastfm.freetls.fastly.net/album1.png', size: 'extralarge' }] },
			{ name: '叶惠美', image: [{ '#text': 'https://lastfm.freetls.fastly.net/album2.png', size: 'large' }] }
		]
	}
});

describe('/api/lastfm/discovery — Last.fm key injected upstream, ABSENT from client response (no-leak)', () => {
	it('injects the key into the upstream fetch but never echoes it to the client body/headers', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				return new Response(CHART_TRACKS_PAYLOAD, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		const event = fakeEvent(
			{ method: 'chart.gettoptracks', limit: '10' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// (a) upstream URL carries the injected key + method
		expect(capturedUpstreamUrl).toContain(`api_key=${FAKE_KEY}`);
		expect(capturedUpstreamUrl).toContain('method=chart.gettoptracks');
		// (b) the client-facing response body does NOT contain the key
		expect(body).not.toContain(FAKE_KEY);
		// (c) no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_KEY);

		// returns a clean { items } list, image picked largest, placeholder-filtered, with the
		// FIX-B mbid surfaced (real → kept, empty upstream → null).
		const parsed = JSON.parse(body) as List;
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]).toEqual({
			artist: '周杰伦',
			title: '稻香',
			image: 'https://lastfm.freetls.fastly.net/extralarge.png',
			mbid: JAY_MBID
		});
		expect(parsed.items[1].artist).toBe('Ed Sheeran');
		expect(parsed.items[1].mbid).toBeNull(); // empty upstream mbid → null
	});

	it('encodes a non-ASCII passthrough param (tag) into the upstream URL', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				return new Response(CHART_TRACKS_PAYLOAD, { status: 200 });
			})
		);
		const event = fakeEvent(
			{ method: 'tag.gettoptracks', tag: '华语' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(capturedUpstreamUrl).toContain('method=tag.gettoptracks');
		expect(capturedUpstreamUrl).toContain(encodeURIComponent('华语'));
	});
});

describe('/api/lastfm/discovery — absent key / allow-list / error graceful', () => {
	it('returns 200 empty list and does NOT fetch when LASTFM_KEY is missing (D-06 fallback trigger)', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent({ method: 'chart.gettoptracks' }); // no platform.env
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed).toEqual({ items: [] });

		// must NOT have fetched an upstream (esp. not api_key=undefined)
		expect(fetchSpy).not.toHaveBeenCalled();
		const calledWithUndefinedKey = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('api_key=undefined')
		);
		expect(calledWithUndefinedKey).toBe(false);
	});

	it('rejects a method outside the allow-list with the empty list and no fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const event = fakeEvent(
			{ method: 'user.getlovedtracks' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns empty list on a Last.fm error-29 rate-limit body (no throw)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 29, message: 'Rate limit exceeded' }), {
						status: 200
					})
			)
		);
		const event = fakeEvent(
			{ method: 'chart.gettoptracks' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items).toEqual([]);
	});

	it('returns empty list on malformed upstream JSON (best-effort fallback)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json at all', { status: 200 }))
		);
		const event = fakeEvent(
			{ method: 'chart.gettoptracks' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items).toEqual([]);
	});
});

describe('/api/lastfm/discovery — list reshapers per method', () => {
	it('chart.gettopartists reshapes to { name, image } items', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(CHART_ARTISTS_PAYLOAD, { status: 200 })));
		const event = fakeEvent(
			{ method: 'chart.gettopartists' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items[0]).toEqual({ name: '周杰伦', image: 'https://lastfm.freetls.fastly.net/jay.png', mbid: JAY_MBID });
		expect(parsed.items[1].name).toBe('Taylor Swift');
		expect(parsed.items[1].mbid).toBeNull(); // no upstream mbid → null
	});

	it('artist.gettopalbums reshapes to { name, image } items', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(TOP_ALBUMS_PAYLOAD, { status: 200 })));
		const event = fakeEvent(
			{ method: 'artist.gettopalbums', artist: '周杰伦' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items[0]).toEqual({ name: '魔杰座', image: 'https://lastfm.freetls.fastly.net/album1.png', mbid: ALBUM1_MBID });
		expect(parsed.items).toHaveLength(2);
	});

	// FIX-B: the per-item MusicBrainz `mbid` is surfaced through the reshape (client builds a
	// CAA cover URL from it). A real mbid is kept; an empty / absent upstream mbid → null so a
	// no-mbid tile keeps the gradient. mbid is a public id — the no-leak test still holds.
	it('surfaces a real mbid and reshapes empty/absent upstream mbid to null', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							tracks: {
								track: [
									{ name: 'Has', artist: { name: 'A' }, mbid: JAY_MBID },
									{ name: 'EmptyMbid', artist: { name: 'B' }, mbid: '   ' },
									{ name: 'NoMbid', artist: { name: 'C' } }
								]
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent({ method: 'chart.gettoptracks' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items[0].mbid).toBe(JAY_MBID); // real id kept
		expect(parsed.items[1].mbid).toBeNull(); // whitespace-only → null
		expect(parsed.items[2].mbid).toBeNull(); // absent → null
		// no-leak invariant holds: the key is not the mbid and never appears.
		expect(JSON.stringify(parsed)).not.toContain(FAKE_KEY);
	});

	it('placeholder filter: grey-star hash image on a track item → image null', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							tracks: {
								track: [
									{
										name: 'No Art',
										artist: { name: 'Nobody' },
										image: [
											{ '#text': '', size: 'small' },
											{
												'#text': `https://lastfm.freetls.fastly.net/i/u/300x300/${GREY_STAR}.png`,
												size: 'extralarge'
											}
										]
									}
								]
							}
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent(
			{ method: 'chart.gettoptracks' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as List;
		expect(parsed.items[0]).toEqual({ artist: 'Nobody', title: 'No Art', image: null, mbid: null });
	});

	// CR-01 (security): image URLs are interpolated into CSS `background-image: url(...)`.
	// A `)` / off-domain / non-https URL must be rejected (image null) so it can't inject a
	// second url() layer; a clean fastly URL is kept (no over-rejection).
	it('rejects unsafe image URLs (CSS-injection / off-domain / non-https) → image null', async () => {
		const unsafe = [
			'https://lastfm.freetls.fastly.net/x.png)cover.png', // CSS url() breaker
			'https://evil.example.com/track.png', // off-domain
			'http://lastfm.freetls.fastly.net/x.png' // not https
		];
		for (const bad of unsafe) {
			vi.stubGlobal(
				'fetch',
				vi.fn(
					async () =>
						new Response(
							JSON.stringify({
								tracks: { track: [{ name: 'T', artist: { name: 'A' }, image: [{ '#text': bad, size: 'extralarge' }] }] }
							}),
							{ status: 200 }
						)
				)
			);
			const event = fakeEvent({ method: 'chart.gettoptracks' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res = await GET(event as any);
			const parsed = JSON.parse(await res.text()) as List;
			expect(parsed.items[0].image, `should reject: ${bad}`).toBeNull();
		}
		// Sanity: a clean fastly URL IS kept.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							tracks: { track: [{ name: 'T', artist: { name: 'A' }, image: [{ '#text': 'https://lastfm.freetls.fastly.net/ok.png', size: 'extralarge' }] }] }
						}),
						{ status: 200 }
					)
			)
		);
		const okEvent = fakeEvent({ method: 'chart.gettoptracks' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const okRes = await GET(okEvent as any);
		const okParsed = JSON.parse(await okRes.text()) as List;
		expect(okParsed.items[0].image).toBe('https://lastfm.freetls.fastly.net/ok.png');
	});
});

describe('/api/lastfm/discovery — Cache-Control + Cache API', () => {
	it('sets per-method Cache-Control: public max-age (charts 3600, tag 21600, topalbums 86400)', async () => {
		const cases: Array<{ method: string; ttl: number; payload: string; extra?: Record<string, string> }> = [
			{ method: 'chart.gettoptracks', ttl: 3600, payload: CHART_TRACKS_PAYLOAD },
			{ method: 'tag.gettoptracks', ttl: 21600, payload: CHART_TRACKS_PAYLOAD, extra: { tag: 'pop' } },
			{ method: 'artist.gettopalbums', ttl: 86400, payload: TOP_ALBUMS_PAYLOAD, extra: { artist: 'x' } }
		];
		for (const c of cases) {
			vi.stubGlobal('fetch', vi.fn(async () => new Response(c.payload, { status: 200 })));
			const event = fakeEvent(
				{ method: c.method, ...(c.extra ?? {}) },
				{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
			);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res = await GET(event as any);
			const cc = res.headers.get('Cache-Control') ?? '';
			expect(cc, `${c.method} cache-control`).toContain('public');
			expect(cc, `${c.method} ttl`).toContain(`max-age=${c.ttl}`);
		}
	});

	it('serves the second identical request from caches.default without a second upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response(CHART_TRACKS_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		// Minimal Cache API stub: an in-memory map keyed by the cache request URL.
		const store = new Map<string, Response>();
		const cacheStub = {
			match: vi.fn(async (req: Request) => {
				const hit = store.get(req.url);
				return hit ? hit.clone() : undefined;
			}),
			put: vi.fn(async (req: Request, res: Response) => {
				store.set(req.url, res.clone());
			})
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const mk = () =>
			fakeEvent({ method: 'chart.gettoptracks', limit: '5' }, { JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		const body1 = JSON.parse(await res1.text()) as List;
		expect(body1.items).toHaveLength(2);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(mk() as any);
		const body2 = JSON.parse(await res2.text()) as List;
		expect(body2.items).toHaveLength(2);
		// cache hit short-circuits — no second upstream fetch
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
	});

	it('does not put the secret-bearing upstream URL into the cache key (own-origin key only)', async () => {
		const fetchSpy = vi.fn(async () => new Response(CHART_TRACKS_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		let cacheKeyUrl = '';
		const cacheStub = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async (req: Request) => {
				cacheKeyUrl = req.url;
			})
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const event = fakeEvent(
			{ method: 'chart.gettoptracks' },
			{ JOOX_TOKEN: 'x', LASTFM_KEY: FAKE_KEY }
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(cacheStub.put).toHaveBeenCalled();
		expect(cacheKeyUrl).not.toContain(FAKE_KEY);
		expect(cacheKeyUrl).not.toContain('ws.audioscrobbler.com');
	});
});

describe('/api/lastfm/discovery — CORS preflight', () => {
	it('OPTIONS returns 204 with scoped corsHeaders (never *)', async () => {
		const req = new Request('https://openmusic.lol/api/lastfm/discovery', {
			method: 'OPTIONS',
			headers: { origin: 'https://openmusic.lol' }
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await OPTIONS({ request: req } as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
	});
});
