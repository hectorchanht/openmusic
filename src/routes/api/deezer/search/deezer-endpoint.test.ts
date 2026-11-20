import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '$lib/proxy/proxy-types';
import { GET, OPTIONS } from './+server';

// /api/deezer/search (quick-260606-wv8) is a no-secret Deezer cover/search edge proxy,
// modeled on /api/lastfm/discovery. It reshapes Deezer's `data[0]` into { cover,
// artistPicture }, scopes CORS to the own origin (never *), guards image URLs to
// https *.dzcdn.net (CSS-breaker reject), edge-caches with an own-origin key, and
// degrades every miss/error to { cover:null, artistPicture:null } (never throws).
//
// LIVE Deezer probe (2026-06-06): api.deezer.com/search?q=... → { data:[...], total };
// no-match → { data:[], total:0 } (clean 200, NO error envelope); data[0].album.cover_xl/
// cover_big/cover_medium + data[0].artist.picture_xl/picture_big; image host
// cdn-images.dzcdn.net (all https); NO API key required. These tests stub fetch (no live
// network) + an in-memory caches.default for the cache-hit / cache-key assertions.

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fakeEvent(search: Record<string, string>, env?: Env) {
	const url = new URL('https://openmusic.lol/api/deezer/search');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		// Most cases pass platform: undefined to PROVE the proxy works with NO key/secret.
		platform: env ? { env } : undefined,
		request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
	};
}

type DeezerResult = { cover: string | null; artistPicture: string | null };

const COVER_XL = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';
const COVER_BIG = 'https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg';
const COVER_MED = 'https://cdn-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg';
const PIC_XL = 'https://cdn-images.dzcdn.net/images/artist/def/1000x1000-000000-80-0-0.jpg';
const PIC_BIG = 'https://cdn-images.dzcdn.net/images/artist/def/500x500-000000-80-0-0.jpg';

const FULL_PAYLOAD = JSON.stringify({
	data: [
		{
			album: { cover_xl: COVER_XL, cover_big: COVER_BIG, cover_medium: COVER_MED },
			artist: { picture_xl: PIC_XL, picture_big: PIC_BIG }
		}
	],
	total: 1
});

describe('/api/deezer/search — reshape data[0] → { cover, artistPicture }', () => {
	it('returns the highest-res cover + artist picture from data[0]', async () => {
		let capturedUpstream = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstream = String(input);
				return new Response(FULL_PAYLOAD, { status: 200 });
			})
		);
		const event = fakeEvent({ q: 'Jay Chou Simple Love' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBe(COVER_XL);
		expect(parsed.artistPicture).toBe(PIC_XL);
		// upstream is api.deezer.com/search with the encoded q + limit=1 (passthrough only)
		expect(capturedUpstream).toContain('https://api.deezer.com/search');
		expect(capturedUpstream).toContain(encodeURIComponent('Jay Chou Simple Love'));
		expect(capturedUpstream).toContain('limit=1');
	});

	it('falls back cover_xl → cover_big → cover_medium and picture_xl → picture_big', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: [
								{ album: { cover_big: COVER_BIG }, artist: { picture_big: PIC_BIG } }
							]
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBe(COVER_BIG);
		expect(parsed.artistPicture).toBe(PIC_BIG);
	});

	it('encodes a non-ASCII q into the upstream URL', async () => {
		let capturedUpstream = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstream = String(input);
				return new Response(FULL_PAYLOAD, { status: 200 });
			})
		);
		const event = fakeEvent({ q: '周杰伦 稻香' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(capturedUpstream).toContain(encodeURIComponent('周杰伦 稻香'));
	});
});

describe('/api/deezer/search — empty / no-match / error graceful (never throws)', () => {
	it('returns { cover:null, artistPicture:null } with NO fetch on empty q', async () => {
		const fetchSpy = vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const event = fakeEvent({ q: '' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed).toEqual({ cover: null, artistPicture: null });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns nulls with NO fetch when q is missing entirely', async () => {
		const fetchSpy = vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		const event = fakeEvent({});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed).toEqual({ cover: null, artistPicture: null });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns nulls on a no-match upstream { data: [], total: 0 }', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 }))
		);
		const event = fakeEvent({ q: 'asdkjhaskdjh no match' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed).toEqual({ cover: null, artistPicture: null });
	});

	it('returns nulls on malformed upstream JSON (best-effort, never throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json at all', { status: 200 }))
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed).toEqual({ cover: null, artistPicture: null });
	});

	it('returns nulls when fetch itself throws (never throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed).toEqual({ cover: null, artistPicture: null });
	});

	it('works with platform: undefined (no secret/env read)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 })));
		const event = fakeEvent({ q: 'x' }); // no platform.env
		expect(event.platform).toBeUndefined();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBe(COVER_XL);
	});
});

describe('/api/deezer/search — image-host allow-list (.dzcdn.net https, CSS-breaker reject)', () => {
	it('nulls a cover/picture whose host is NOT *.dzcdn.net', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: [
								{
									album: { cover_xl: 'https://evil.example.com/cover.jpg' },
									artist: { picture_xl: 'https://evil.example.com/pic.jpg' }
								}
							]
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBeNull();
		expect(parsed.artistPicture).toBeNull();
	});

	it('nulls a non-https cover URL', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: [{ album: { cover_xl: 'http://cdn-images.dzcdn.net/cover.jpg' } }]
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBeNull();
	});

	it('nulls a cover URL containing a CSS/attr breaker char', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: [
								{ album: { cover_xl: 'https://cdn-images.dzcdn.net/cover.jpg)evil.png' } }
							]
						}),
						{ status: 200 }
					)
			)
		);
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBeNull();
	});

	it('keeps a clean cdn-images.dzcdn.net https URL', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 })));
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const parsed = JSON.parse(await res.text()) as DeezerResult;
		expect(parsed.cover).toBe(COVER_XL);
		expect(parsed.artistPicture).toBe(PIC_XL);
	});
});

describe('/api/deezer/search — Cache-Control + Cache API (own-origin key)', () => {
	it('sets Cache-Control: public, max-age=86400 on a success', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 })));
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const cc = res.headers.get('Cache-Control') ?? '';
		expect(cc).toContain('public');
		expect(cc).toContain('max-age=86400');
	});

	it('serves the second identical request from caches.default WITHOUT a second upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
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

		const mk = () => fakeEvent({ q: 'Jay Chou Simple Love' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(mk() as any);
		const body1 = JSON.parse(await res1.text()) as DeezerResult;
		expect(body1.cover).toBe(COVER_XL);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(cacheStub.put).toHaveBeenCalledTimes(1);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(mk() as any);
		const body2 = JSON.parse(await res2.text()) as DeezerResult;
		expect(body2.cover).toBe(COVER_XL);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // no second upstream fetch
		expect(cacheStub.match).toHaveBeenCalledTimes(2);
		// cache hit re-applies CORS for THIS origin
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
	});

	it('uses the own-origin Request as the cache key (NEVER the upstream api.deezer.com URL)', async () => {
		const fetchSpy = vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);
		let cacheKeyUrl = '';
		const cacheStub = {
			match: vi.fn(async () => undefined),
			put: vi.fn(async (req: Request) => {
				cacheKeyUrl = req.url;
			})
		};
		vi.stubGlobal('caches', { default: cacheStub });

		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(cacheStub.put).toHaveBeenCalled();
		expect(cacheKeyUrl).toContain('openmusic.lol/api/deezer/search');
		expect(cacheKeyUrl).not.toContain('api.deezer.com');
	});

	it('does NOT write the cache on a miss / error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('bad json', { status: 200 }))
		);
		const putSpy = vi.fn(async () => { });
		vi.stubGlobal('caches', {
			default: { match: vi.fn(async () => undefined), put: putSpy }
		});
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(event as any);
		expect(putSpy).not.toHaveBeenCalled();
	});
});

describe('/api/deezer/search — CORS', () => {
	it('GET response scopes Access-Control-Allow-Origin to the own origin (never *)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(FULL_PAYLOAD, { status: 200 })));
		const event = fakeEvent({ q: 'x' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
	});

	it('OPTIONS returns 204 with scoped corsHeaders (never *)', async () => {
		const req = new Request('https://openmusic.lol/api/deezer/search', {
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
