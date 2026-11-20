// Tests for the /api/charts edge route and its helpers in $lib/proxy/charts.ts (39-D-13..15).
//
// Harness copied from resolve-endpoint.test.ts: an in-memory `caches.default` shim, a recording
// `fetch` stub, and a `ctx.waitUntil` spy whose captured promises the test awaits to observe the
// background refill. `edgeCache()` reads the stubbed global, so real Cache API semantics are NOT
// proven here — what IS proven is the route's logic against the shim and the SUBREQUEST COUNT.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	validateChartQuery,
	chartCacheKey,
	readChartEntry,
	writeChartEntry,
	serveChart,
	ytChartsInit,
	CHART_FRESH_MS,
	CHART_STALE_S,
	YT_CHARTS_CLIENT_VERSION,
	type ChartItem,
	type ChartQuery
} from '$lib/proxy/charts';
import type { EdgeCache } from '$lib/proxy/edge-cache';
import { GET, OPTIONS } from './+server';
import appleHkSongs from '$lib/services/__fixtures__/charts/apple-hk-songs.json';
import kkboxHkSong from '$lib/services/__fixtures__/charts/kkbox-hk-song.json';
import ytHkTracks from '$lib/services/__fixtures__/charts/yt-hk-tracks.json';
import ytCnGlobal from '$lib/services/__fixtures__/charts/yt-cn-global.json';

const ORIGIN = 'https://openmusic.lol';

/** In-memory caches.default. `putKeys` records every write so "never cached" can be asserted. */
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			putKeys.push(req.url);
			store.set(req.url, res.clone());
		}),
		delete: vi.fn(async (req: Request) => store.delete(req.url))
	};
	vi.stubGlobal('caches', { default: cacheStub });
	return { store, putKeys, cacheStub };
}

const q = (s: string) => validateChartQuery(new URLSearchParams(s));
const APPLE_HK: ChartQuery = { src: 'apple', kind: 'songs', cc: 'hk' };
const ITEMS: ChartItem[] = [{ artist: 'A', title: 'T', image: null, mbid: null }];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('proxy/charts helpers', () => {
	describe('validateChartQuery (T-39-10 closed allowlist)', () => {
		it('accepts every source with its own kinds and regions', () => {
			expect(q('src=apple&kind=songs&cc=hk')).toEqual({ src: 'apple', kind: 'songs', cc: 'hk' });
			expect(q('src=apple&kind=albums&cc=us')).toEqual({ src: 'apple', kind: 'albums', cc: 'us' });
			expect(q('src=kkbox&kind=newrelease&cc=tw')).toEqual({
				src: 'kkbox',
				kind: 'newrelease',
				cc: 'tw'
			});
			expect(q('src=yt&kind=artists&cc=sa')).toEqual({ src: 'yt', kind: 'artists', cc: 'sa' });
		});

		it.each([
			['a kind that belongs to another source', 'src=kkbox&kind=songs&cc=hk'],
			['a region KKBOX does not serve', 'src=kkbox&kind=song&cc=us'],
			['the cn storefront', 'src=apple&kind=songs&cc=cn'],
			['an upper-case region', 'src=apple&kind=songs&cc=HK'],
			['an unknown source', 'src=deezer&kind=songs&cc=hk'],
			['a missing src', 'kind=songs&cc=hk'],
			['a missing kind', 'src=apple&cc=hk'],
			['a missing cc', 'src=apple&kind=songs'],
			['a path-traversal region', 'src=apple&kind=songs&cc=../x'],
			['no params at all', '']
		])('rejects %s', (_label, search) => {
			expect(q(search)).toBeNull();
		});
	});

	describe('chartCacheKey (T-39-11)', () => {
		it('builds the versioned own-origin key from the validated query only', () => {
			expect(chartCacheKey(ORIGIN, APPLE_HK).url).toBe(
				'https://openmusic.lol/api/charts/_k?v=1&src=apple&kind=songs&cc=hk'
			);
		});

		it('junk extra params cannot mint a new key', () => {
			const junk = validateChartQuery(new URLSearchParams('src=apple&kind=songs&cc=hk&foo=bar&x=1'));
			expect(junk).not.toBeNull();
			expect(chartCacheKey(ORIGIN, junk!).url).toBe(chartCacheKey(ORIGIN, APPLE_HK).url);
		});
	});

	describe('readChartEntry (never throws, shape-guarded)', () => {
		const key = chartCacheKey(ORIGIN, APPLE_HK);
		const cacheReturning = (res: Response | undefined): EdgeCache => ({
			match: async () => res,
			put: async () => {},
			delete: async () => false
		});
		const body = (v: unknown) => new Response(JSON.stringify(v));

		it('returns undefined for a null cache', async () => {
			expect(await readChartEntry(null, key)).toBeUndefined();
		});

		it('returns undefined on a miss', async () => {
			expect(await readChartEntry(cacheReturning(undefined), key)).toBeUndefined();
		});

		it('returns undefined when match() throws', async () => {
			const broken: EdgeCache = {
				match: async () => {
					throw new Error('cache down');
				},
				put: async () => {},
				delete: async () => false
			};
			expect(await readChartEntry(broken, key)).toBeUndefined();
		});

		it('returns undefined for a body without a numeric fetchedAt', async () => {
			expect(await readChartEntry(cacheReturning(body({ items: ITEMS })), key)).toBeUndefined();
			expect(
				await readChartEntry(cacheReturning(body({ fetchedAt: '1', items: ITEMS })), key)
			).toBeUndefined();
		});

		it('returns undefined for a body whose items is not an array', async () => {
			expect(
				await readChartEntry(cacheReturning(body({ fetchedAt: 1, items: {} })), key)
			).toBeUndefined();
			expect(await readChartEntry(cacheReturning(body(null)), key)).toBeUndefined();
			expect(
				await readChartEntry(cacheReturning(new Response('not json')), key)
			).toBeUndefined();
		});

		it('returns a well-formed entry', async () => {
			const entry = { fetchedAt: 123, items: ITEMS };
			expect(await readChartEntry(cacheReturning(body(entry)), key)).toEqual(entry);
		});
	});

	describe('writeChartEntry', () => {
		it('stores a fresh JSON Response with the 48 h stale max-age', async () => {
			const { store, cacheStub } = stubCache();
			const key = chartCacheKey(ORIGIN, APPLE_HK);
			await writeChartEntry(cacheStub, key, { fetchedAt: 1, items: ITEMS });
			const stored = store.get(key.url);
			expect(stored).toBeDefined();
			expect(stored!.headers.get('content-type')).toBe('application/json');
			expect(stored!.headers.get('Cache-Control')).toBe(`public, max-age=${CHART_STALE_S}`);
			expect(CHART_STALE_S).toBe(172_800);
			expect(stored!.headers.get('Vary')).toBeNull();
			expect(await stored!.json()).toEqual({ fetchedAt: 1, items: ITEMS });
		});

		it('never throws when put() rejects, and is a no-op for a null cache', async () => {
			const broken: EdgeCache = {
				match: async () => undefined,
				put: async () => {
					throw new Error('quota');
				},
				delete: async () => false
			};
			const key = chartCacheKey(ORIGIN, APPLE_HK);
			await expect(writeChartEntry(broken, key, { fetchedAt: 1, items: ITEMS })).resolves.toBeUndefined();
			await expect(writeChartEntry(null, key, { fetchedAt: 1, items: ITEMS })).resolves.toBeUndefined();
		});
	});

	describe('ytChartsInit', () => {
		const sig = new AbortController().signal;
		const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

		it('builds the pinned WEB_MUSIC_ANALYTICS request for hk tracks with zh-TW', () => {
			const init = ytChartsInit('hk', 'tracks', sig);
			expect(init.method).toBe('POST');
			expect(new Headers(init.headers).get('content-type')).toBe('application/json');
			expect(init.signal).toBe(sig);
			const b = bodyOf(init);
			expect(b.context.client).toEqual({
				clientName: 'WEB_MUSIC_ANALYTICS',
				clientVersion: '2.0',
				hl: 'zh-TW',
				gl: 'HK'
			});
			expect(YT_CHARTS_CLIENT_VERSION).toBe('2.0');
			expect(b.browseId).toBe('FEmusic_analytics_charts_home');
			expect(b.query).toContain('chart_params_country_code=hk');
			expect(b.query).toContain('chart_params_chart_type=TRACKS');
			expect(b.query).toContain('chart_params_period_type=WEEKLY');
		});

		it('uses en + upper-case gl for other regions, and ARTISTS for the artist chart', () => {
			const b = bodyOf(ytChartsInit('us', 'artists', sig));
			expect(b.context.client.hl).toBe('en');
			expect(b.context.client.gl).toBe('US');
			expect(b.query).toContain('chart_params_chart_type=ARTISTS');
			expect(b.query).toContain('chart_params_country_code=us');
			expect(bodyOf(ytChartsInit('tw', 'tracks', sig)).context.client.hl).toBe('zh-TW');
		});
	});

	describe('serveChart (P39-02 serve-stale)', () => {
		const key = chartCacheKey(ORIGIN, APPLE_HK);
		const REFILL: ChartItem[] = [{ artist: 'New', title: 'Song', image: null, mbid: null }];

		/** A waitUntil spy that keeps every scheduled promise so the test can await the refill. */
		function fakeCtx() {
			const waited: Promise<unknown>[] = [];
			return { waited, ctx: { waitUntil: vi.fn((p: Promise<unknown>) => void waited.push(p)) } };
		}

		it('miss → loads once, writes the non-empty result once, returns it', async () => {
			const { cacheStub, putKeys } = stubCache();
			const load = vi.fn(async () => ITEMS);
			const { ctx } = fakeCtx();
			expect(await serveChart(cacheStub, key, load, ctx)).toEqual(ITEMS);
			expect(load).toHaveBeenCalledTimes(1);
			expect(putKeys).toEqual([key.url]);
			expect(ctx.waitUntil).not.toHaveBeenCalled();
		});

		it('miss + load throws → [] and nothing is ever cached', async () => {
			const { cacheStub, putKeys } = stubCache();
			const load = vi.fn(async (): Promise<ChartItem[]> => {
				throw new Error('upstream down');
			});
			expect(await serveChart(cacheStub, key, load, fakeCtx().ctx)).toEqual([]);
			expect(putKeys).toHaveLength(0);
		});

		it('miss + empty parse → [] and the empty result is never cached', async () => {
			const { cacheStub, putKeys } = stubCache();
			expect(await serveChart(cacheStub, key, async () => [], fakeCtx().ctx)).toEqual([]);
			expect(putKeys).toHaveLength(0);
		});

		it('fresh hit → served with no load and no refill', async () => {
			const { cacheStub } = stubCache();
			await writeChartEntry(cacheStub, key, { fetchedAt: Date.now() - 60_000, items: ITEMS });
			const load = vi.fn(async () => REFILL);
			const { ctx } = fakeCtx();
			expect(await serveChart(cacheStub, key, load, ctx)).toEqual(ITEMS);
			expect(load).not.toHaveBeenCalled();
			expect(ctx.waitUntil).not.toHaveBeenCalled();
		});

		it('stale hit → stale items returned now, one refill scheduled, a non-empty refill rewrites the entry', async () => {
			const { cacheStub, putKeys } = stubCache();
			const seededAt = Date.now() - CHART_FRESH_MS - 60_000;
			await writeChartEntry(cacheStub, key, { fetchedAt: seededAt, items: ITEMS });
			putKeys.length = 0;
			const load = vi.fn(async () => REFILL);
			const { ctx, waited } = fakeCtx();

			expect(await serveChart(cacheStub, key, load, ctx)).toEqual(ITEMS);
			expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
			await Promise.all(waited);
			expect(load).toHaveBeenCalledTimes(1);
			expect(putKeys).toEqual([key.url]);
			const after = await readChartEntry(cacheStub, key);
			expect(after!.items).toEqual(REFILL);
			expect(after!.fetchedAt).toBeGreaterThan(seededAt);
		});

		it('stale hit + an empty refill leaves the stale entry untouched (empty never cached)', async () => {
			const { cacheStub, putKeys } = stubCache();
			const seededAt = Date.now() - CHART_FRESH_MS - 60_000;
			await writeChartEntry(cacheStub, key, { fetchedAt: seededAt, items: ITEMS });
			putKeys.length = 0;
			const { ctx, waited } = fakeCtx();
			await serveChart(cacheStub, key, async () => [], ctx);
			await Promise.all(waited);
			expect(putKeys).toHaveLength(0);
			expect(await readChartEntry(cacheStub, key)).toEqual({ fetchedAt: seededAt, items: ITEMS });
		});

		it('stale hit + a throwing refill leaves the stale entry untouched and never rejects', async () => {
			const { cacheStub, putKeys } = stubCache();
			const seededAt = Date.now() - CHART_FRESH_MS - 60_000;
			await writeChartEntry(cacheStub, key, { fetchedAt: seededAt, items: ITEMS });
			putKeys.length = 0;
			const { ctx, waited } = fakeCtx();
			const load = async (): Promise<ChartItem[]> => {
				throw new Error('upstream down');
			};
			expect(await serveChart(cacheStub, key, load, ctx)).toEqual(ITEMS);
			await expect(Promise.all(waited)).resolves.toBeDefined();
			expect(putKeys).toHaveLength(0);
		});

		it('stale hit without a ctx (vite dev) still serves the stale items', async () => {
			const { cacheStub } = stubCache();
			await writeChartEntry(cacheStub, key, { fetchedAt: 0, items: ITEMS });
			expect(await serveChart(cacheStub, key, async () => REFILL, undefined)).toEqual(ITEMS);
		});
	});
});

type Reply = Response | 'THROW';

/** Stub every upstream. Each subrequest's URL AND init are recorded so counts/bodies can be asserted. */
function stubUpstream(replies: Reply[]) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	let i = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			const reply = replies.length ? replies[Math.min(i++, replies.length - 1)] : 'THROW';
			if (reply === 'THROW') throw new Error('network down');
			return reply.clone();
		})
	);
	return { calls };
}

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

/** GET event. `waited` collects everything handed to ctx.waitUntil so the refill can be awaited. */
function fakeGet(search: string, origin: string | null = ORIGIN) {
	const url = new URL(`${ORIGIN}/api/charts?${search}`);
	const waited: Promise<unknown>[] = [];
	return {
		waited,
		event: {
			url,
			platform: { ctx: { waitUntil: vi.fn((p: Promise<unknown>) => void waited.push(p)) } },
			request: new Request(url, origin ? { headers: { origin } } : {})
		}
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const callGET = (event: ReturnType<typeof fakeGet>['event']) => GET(event as any);
const callOPTIONS = (event: unknown) => OPTIONS(event as any);
/* eslint-enable @typescript-eslint/no-explicit-any */

const APPLE_KEY = 'https://openmusic.lol/api/charts/_k?v=1&src=apple&kind=songs&cc=hk';
const APPLE_URL = 'https://rss.marketingtools.apple.com/api/v2/hk/music/most-played/50/songs.json';

describe('/api/charts GET', () => {
	it('an unknown src → { items: [] } with zero cache touches, zero subrequests, no refill', async () => {
		const { cacheStub, putKeys } = stubCache();
		const { calls } = stubUpstream([json(appleHkSongs)]);
		const { event, waited } = fakeGet('src=deezer&kind=songs&cc=hk');

		const res = await callGET(event);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [] });
		expect(res.headers.get('Cache-Control')).toBeNull();
		expect(cacheStub.match).not.toHaveBeenCalled();
		expect(putKeys).toHaveLength(0);
		expect(calls).toHaveLength(0);
		expect(event.platform.ctx.waitUntil).not.toHaveBeenCalled();
		expect(waited).toHaveLength(0);
	});

	it('a non-KKBOX region → { items: [] } with zero work', async () => {
		const { cacheStub } = stubCache();
		const { calls } = stubUpstream([json(kkboxHkSong)]);
		const res = await callGET(fakeGet('src=kkbox&kind=song&cc=us').event);
		expect(await res.json()).toEqual({ items: [] });
		expect(cacheStub.match).not.toHaveBeenCalled();
		expect(calls).toHaveLength(0);
	});

	it('cold apple/songs/hk → fetches Apple once, caches under the canonical key, 1800 s client ttl', async () => {
		const { putKeys } = stubCache();
		const { calls } = stubUpstream([json(appleHkSongs)]);
		const { event } = fakeGet('src=apple&kind=songs&cc=hk');

		const res = await callGET(event);
		const body = (await res.json()) as { items: { artist: string; title: string }[] };
		expect(body.items.length).toBeGreaterThanOrEqual(1);
		expect(body.items[0].artist).toBeTruthy();
		expect(calls.map((c) => c.url)).toEqual([APPLE_URL]);
		expect(putKeys).toEqual([APPLE_KEY]);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=1800');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
	});

	it('a second identical GET is a fresh hit — no subrequest, no refill', async () => {
		stubCache();
		const { calls } = stubUpstream([json(appleHkSongs)]);
		await callGET(fakeGet('src=apple&kind=songs&cc=hk').event);
		const second = fakeGet('src=apple&kind=songs&cc=hk');
		const res = await callGET(second.event);

		expect(((await res.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
		expect(calls).toHaveLength(1);
		expect(second.event.platform.ctx.waitUntil).not.toHaveBeenCalled();
	});

	it('a stale entry is served immediately and refilled via waitUntil', async () => {
		const { cacheStub, putKeys } = stubCache();
		const key = chartCacheKey(ORIGIN, APPLE_HK);
		const seededAt = Date.now() - 7 * 3600_000;
		await writeChartEntry(cacheStub, key, { fetchedAt: seededAt, items: ITEMS });
		putKeys.length = 0;
		const { calls } = stubUpstream([json(appleHkSongs)]);
		const { event, waited } = fakeGet('src=apple&kind=songs&cc=hk');

		const res = await callGET(event);
		expect(await res.json()).toEqual({ items: ITEMS });
		expect(event.platform.ctx.waitUntil).toHaveBeenCalledTimes(1);
		await Promise.all(waited);
		expect(calls).toHaveLength(1);
		expect(putKeys).toEqual([APPLE_KEY]);
		const after = await readChartEntry(cacheStub, key);
		expect(after!.fetchedAt).toBeGreaterThan(seededAt);
		expect(after!.items).not.toEqual(ITEMS);
	});

	it('a stale entry + an empty upstream parse is never cached (stale entry untouched)', async () => {
		const { cacheStub, putKeys } = stubCache();
		const key = chartCacheKey(ORIGIN, APPLE_HK);
		const seededAt = Date.now() - 7 * 3600_000;
		await writeChartEntry(cacheStub, key, { fetchedAt: seededAt, items: ITEMS });
		putKeys.length = 0;
		stubUpstream([json({ feed: { results: [] } })]);
		const { event, waited } = fakeGet('src=apple&kind=songs&cc=hk');

		expect(await (await callGET(event)).json()).toEqual({ items: ITEMS });
		await Promise.all(waited);
		expect(putKeys).toHaveLength(0);
		expect(await readChartEntry(cacheStub, key)).toEqual({ fetchedAt: seededAt, items: ITEMS });
	});

	it('a cold cache + an upstream failure → { items: [] }, empty never cached, no browser ttl', async () => {
		const { putKeys } = stubCache();
		stubUpstream(['THROW']);
		const res = await callGET(fakeGet('src=apple&kind=songs&cc=hk').event);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [] });
		expect(putKeys).toHaveLength(0);
		expect(res.headers.get('Cache-Control')).toBeNull();
	});

	it('a non-2xx upstream → { items: [] }, never cached', async () => {
		const { putKeys } = stubCache();
		stubUpstream([new Response('nope', { status: 404 })]);
		const res = await callGET(fakeGet('src=apple&kind=albums&cc=hk').event);
		expect(await res.json()).toEqual({ items: [] });
		expect(putKeys).toHaveLength(0);
	});

	it('a YouTube global-fallback body (echo "global") → { items: [] }, never cached', async () => {
		const { putKeys } = stubCache();
		const { calls } = stubUpstream([json(ytCnGlobal)]);
		const res = await callGET(fakeGet('src=yt&kind=tracks&cc=hk').event);

		expect(await res.json()).toEqual({ items: [] });
		expect(putKeys).toHaveLength(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://charts.youtube.com/youtubei/v1/browse?alt=json');
		expect(calls[0].init?.method).toBe('POST');
		const sent = String(calls[0].init?.body);
		expect(sent).toContain('"clientVersion":"2.0"');
		expect(sent).toContain('chart_params_country_code=hk');
	});

	it('yt/tracks/hk with a matching echo → tracks with allowlisted YouTube art', async () => {
		stubCache();
		stubUpstream([json(ytHkTracks)]);
		const res = await callGET(fakeGet('src=yt&kind=tracks&cc=hk').event);
		const { items } = (await res.json()) as { items: { artist: string; image: string | null }[] };
		expect(items.length).toBeGreaterThan(0);
		for (const it of items) {
			if (it.image) expect(new URL(it.image).hostname).toMatch(/googleusercontent\.com$|ytimg\.com$|ggpht\.com$/);
		}
	});

	it('kkbox/song/hk → Latin aliases stripped, every cover on i.kfs.io', async () => {
		stubCache();
		const { calls } = stubUpstream([json(kkboxHkSong)]);
		const res = await callGET(fakeGet('src=kkbox&kind=song&cc=hk').event);
		const { items } = (await res.json()) as { items: { artist: string; image: string | null }[] };

		expect(calls[0].url).toBe(
			'https://kma.kkbox.com/charts/api/v1/daily?type=song&terr=hk&lang=tc&category=297&limit=50'
		);
		expect(items.length).toBeGreaterThan(0);
		expect(items[0].artist).not.toMatch(/\([\x20-\x7E]+\)\s*$/);
		// The fixture really carries an alias somewhere, so the strip is exercised, not vacuous.
		expect(JSON.stringify(kkboxHkSong)).toMatch(/[^\x00-\x7F] ?\([\x20-\x7E]+\)"/);
		for (const it of items) {
			expect(it.artist).not.toMatch(/[^\x00-\x7F]\s*\([\x20-\x7E]+\)\s*$/);
			expect(it.image!.startsWith('https://i.kfs.io/')).toBe(true);
		}
	});

	it('junk extra params map onto the same cache key as the clean query', async () => {
		const { putKeys } = stubCache();
		stubUpstream([json(appleHkSongs)]);
		await callGET(fakeGet('src=apple&kind=songs&cc=hk&foo=bar').event);
		expect(putKeys).toEqual([APPLE_KEY]);
	});
});

describe('/api/charts OPTIONS', () => {
	it('answers 204 with own-origin CORS and no body', async () => {
		const url = new URL(`${ORIGIN}/api/charts`);
		const res = await callOPTIONS({
			url,
			request: new Request(url, { method: 'OPTIONS', headers: { origin: ORIGIN } })
		});
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(await res.text()).toBe('');
	});
});
