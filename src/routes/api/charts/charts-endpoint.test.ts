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
