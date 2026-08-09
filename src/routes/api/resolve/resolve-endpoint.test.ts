// Endpoint tests for /api/resolve (phase 31, D-06/D-07/D-09/D-10).
//
// The harness is og-endpoint.test.ts:746-782's `stubCache()` + `fakeEvent()`, extended with a
// `delete` spy (D-09) and a `ctx.waitUntil` spy (the out-of-band fill — the test awaits the
// captured promises to observe the write that the CLIENT deliberately never waits for).
//
// `edgeCache()` returns null under vitest by design, so REAL Cache API semantics are not
// provable here (deferred to 31-VALIDATION.md's manual checks). What IS proven: the route's
// logic against an in-memory shim, and the SUBREQUEST COUNT — which is how "a repeat request is
// a HIT with zero upstream calls" is demonstrated.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET, POST, OPTIONS } from './+server';
import { resolveCacheKey, RESOLVE_TTL_S } from '$lib/proxy/resolve-cache';

const ORIGIN = 'https://openmusic.lol';
const ARTIST = 'Nirvana';
const TITLE = 'Come As You Are';

/** In-memory caches.default + the D-09 delete spy. */
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

type Reply = Response | 'THROW';

/** Stub the kuwo upstream. Every subrequest URL is recorded so counts can be asserted. */
function stubUpstream(replies: Reply[]) {
	const calls: string[] = [];
	let i = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			calls.push(String(url));
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

const SEARCH_HIT = json({ code: 200, data: [{ rid: 4212, name: TITLE, artist: ARTIST }] });
const SEARCH_DRY = json({ code: 200, data: [] });
const DETAIL_HIT = json({ code: 200, data: { url: 'https://cdn.kuwo/a.mp3' } });

const OK_ENTRY = {
	source: 'kuwo',
	songid: '4212',
	url: 'https://cdn.kuwo/a.mp3',
	avail: { kuwo: 'ok' }
};
const DRY_ENTRY = { source: null, songid: null, url: null, avail: { kuwo: 'dry' } };

/** GET event. `waited` collects everything handed to ctx.waitUntil so the fill can be awaited. */
function fakeGet(search: Record<string, string>, origin: string | null = ORIGIN) {
	const url = new URL(`${ORIGIN}/api/resolve`);
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
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

/** POST event. `body` is sent raw so a malformed payload can be exercised. */
function fakePost(body: string, origin: string | null = ORIGIN) {
	const url = new URL(`${ORIGIN}/api/resolve`);
	return {
		url,
		platform: { ctx: { waitUntil: vi.fn() } },
		request: new Request(url, {
			method: 'POST',
			body,
			headers: origin ? { origin, 'content-type': 'application/json' } : {}
		})
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const callGET = (event: ReturnType<typeof fakeGet>['event']) => GET(event as any);
const callPOST = (event: ReturnType<typeof fakePost>) => POST(event as any);
/* eslint-enable @typescript-eslint/no-explicit-any */

const KEY = resolveCacheKey(ORIGIN, ARTIST, TITLE).url;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('/api/resolve GET — zero-work short-circuit', () => {
	it('blank a AND t → { hit: false } with no cache touch and NO fill', async () => {
		const { cacheStub } = stubCache();
		const { calls } = stubUpstream([]);
		const { event, waited } = fakeGet({ a: '  ', t: '' });

		const res = await callGET(event);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ hit: false });
		expect(cacheStub.match).not.toHaveBeenCalled();
		expect(event.platform.ctx.waitUntil).not.toHaveBeenCalled();
		expect(waited).toHaveLength(0);
		expect(calls).toHaveLength(0);
	});
});

describe('/api/resolve GET — miss returns immediately, fills out of band (D-06/D-08)', () => {
	it('a MISS answers { hit: false } and schedules the fill via ctx.waitUntil', async () => {
		stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const { event, waited } = fakeGet({ a: ARTIST, t: TITLE });

		const res = await callGET(event);
		// The response is produced BEFORE the fill has been awaited — that is the whole point.
		expect(await res.json()).toEqual({ hit: false });
		expect(event.platform.ctx.waitUntil).toHaveBeenCalledTimes(1);
		expect(waited).toHaveLength(1);
	});

	it('the scheduled fill writes the ok entry, and a SECOND identical GET is a HIT with ZERO subrequests', async () => {
		const { putKeys } = stubCache();
		const first = stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		expect(putKeys).toEqual([KEY]);
		expect(first.calls).toHaveLength(2);

		// Only fetch is re-stubbed — the in-memory cache store must survive, or the second GET
		// would trivially miss for the wrong reason.
		const second = stubUpstream([]);
		const two = fakeGet({ a: ARTIST, t: TITLE });
		const res = await callGET(two.event);

		expect(await res.json()).toEqual({ hit: true, entry: OK_ENTRY });
		expect(second.calls).toHaveLength(0);
		expect(two.event.platform.ctx.waitUntil).not.toHaveBeenCalled();
	});

	it('a query-variant GET (different casing/punctuation) hits the SAME entry', async () => {
		stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		const variant = fakeGet({ a: '  nirvana ', t: 'come-as-you-are!' });
		const res = await callGET(variant.event);
		expect(await res.json()).toEqual({ hit: true, entry: OK_ENTRY });
	});

	it('a CLEAN negative IS cached — the repeat costs zero subrequests (D-06(c))', async () => {
		const { putKeys } = stubCache();
		stubUpstream([SEARCH_DRY]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		expect(putKeys).toEqual([KEY]);

		const second = stubUpstream([]);
		const res = await callGET(fakeGet({ a: ARTIST, t: TITLE }).event);
		expect(await res.json()).toEqual({ hit: true, entry: DRY_ENTRY });
		expect(second.calls).toHaveLength(0);
	});

	it('an upstream FAULT writes NOTHING — the next request retries (D-06(c))', async () => {
		const { putKeys, cacheStub } = stubCache();
		stubUpstream(['THROW']);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		const res = await callGET(one.event);
		await Promise.all(one.waited);

		expect(await res.json()).toEqual({ hit: false });
		expect(cacheStub.put).not.toHaveBeenCalled();
		expect(putKeys).toHaveLength(0);
	});
});

describe('/api/resolve — the cached copy is CORS-free (T-31-03-04)', () => {
	it('the stored Response carries only content-type + Cache-Control', async () => {
		const { store } = stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		const stored = store.get(KEY);
		expect(stored).toBeDefined();
		expect(stored?.headers.get('Vary')).toBeNull();
		expect(stored?.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect([...(stored?.headers.keys() ?? [])].sort()).toEqual(['cache-control', 'content-type']);
	});

	it('CORS is re-applied per requesting origin on the live response, never `*`', async () => {
		stubCache();
		stubUpstream([]);
		const res = await callGET(fakeGet({ a: ARTIST, t: TITLE }).event);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(res.headers.get('Vary')).toBe('Origin');

		const stranger = await callGET(fakeGet({ a: ARTIST, t: TITLE }, 'https://evil.example').event);
		expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});

describe('/api/resolve — the client-facing response is NEVER storable (31-D-09 regression)', () => {
	// SHIPPED DEFECT this guards: the hit response carried `public, max-age=900`, so
	// Cloudflare/workerd stored the whole `{hit:true, entry}` JSON in the AUTOMATIC response cache
	// keyed on the request URL. Observed on `pnpm preview` (wrangler 4.98.0/Miniflare): POST bust →
	// `{busted:true}` (the entry WAS deleted — a `?cb=<random>` GET and a `Cache-Control: no-cache`
	// GET both returned `{hit:false}`), yet the plain GET kept answering `{hit:true}` with
	// `Cache-Control: public, max-age=900` + `CF-Cache-Status: HIT` for 10s+ after the bust. The
	// D-08/D-09 self-healing property did not exist. A resolve response is a VIEW of a mutable
	// entry, so no intermediary may store it — unlike /api/og and /api/deezer/search, whose
	// response IS the artifact.
	const storable = (res: Response) => {
		const cc = res.headers.get('Cache-Control') ?? '';
		return /\bpublic\b/i.test(cc) || /\bmax-age\s*=\s*[1-9]/i.test(cc);
	};

	it('a HIT response is not publicly cacheable and carries no positive max-age', async () => {
		stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		stubUpstream([]);
		const res = await callGET(fakeGet({ a: ARTIST, t: TITLE }).event);
		expect(await res.json()).toEqual({ hit: true, entry: OK_ENTRY });
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(storable(res)).toBe(false);
	});

	it('the MISS, the blank short-circuit and the POST replies are not storable either', async () => {
		stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const miss = await callGET(fakeGet({ a: ARTIST, t: TITLE }).event);
		const blank = await callGET(fakeGet({ a: ' ', t: '' }).event);
		const bust = await callPOST(fakePost(JSON.stringify({ a: ARTIST, t: TITLE })));
		const bad = await callPOST(fakePost('not-json-at-all'));

		for (const res of [miss, blank, bust, bad]) {
			expect(res.headers.get('Cache-Control')).toBe('no-store');
			expect(storable(res)).toBe(false);
		}
	});

	it('the TTL still lives on the STORED entry — that is the only place it belongs', async () => {
		const { store } = stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		expect(store.get(KEY)?.headers.get('Cache-Control')).toBe(`public, max-age=${RESOLVE_TTL_S}`);
	});
});

describe('/api/resolve POST — DELETE-ONLY bust (31-D-09, T-31-03-01)', () => {
	it('deletes the SAME key the GET wrote and reports busted: true', async () => {
		const { putKeys, cacheStub } = stubCache();
		stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);
		expect(putKeys[0]).toBe(KEY);

		cacheStub.put.mockClear();
		const res = await callPOST(fakePost(JSON.stringify({ a: ARTIST, t: TITLE })));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ busted: true });
		expect(cacheStub.delete).toHaveBeenCalledTimes(1);
		expect(cacheStub.delete.mock.calls[0][0].url).toBe(putKeys[0]);
		// The handler is structurally delete-only: it can never WRITE shared cache state.
		expect(cacheStub.put).not.toHaveBeenCalled();
	});

	it('ignores any extra body field — a client-supplied url can never become a cached entry', async () => {
		const { cacheStub } = stubCache();
		stubUpstream([]);
		const res = await callPOST(
			fakePost(JSON.stringify({ a: ARTIST, t: TITLE, url: 'https://evil.example/pwn.mp3' }))
		);
		expect(await res.json()).toEqual({ busted: false });
		expect(cacheStub.put).not.toHaveBeenCalled();
	});

	it('a malformed body is a 400 { busted: false } with no cache touch', async () => {
		const { cacheStub } = stubCache();
		const res = await callPOST(fakePost('not-json-at-all'));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ busted: false });
		expect(cacheStub.delete).not.toHaveBeenCalled();
		expect(cacheStub.put).not.toHaveBeenCalled();
	});

	it('blank terms short-circuit with no cache touch', async () => {
		const { cacheStub } = stubCache();
		const res = await callPOST(fakePost(JSON.stringify({ a: '', t: '   ' })));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ busted: false });
		expect(cacheStub.delete).not.toHaveBeenCalled();
	});
});

describe('/api/resolve — degraded runtimes never throw', () => {
	it('no Cache API (the `vite dev` runtime): GET and POST still answer', async () => {
		vi.stubGlobal('caches', undefined);
		const { calls } = stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		const get = await callGET(one.event);
		expect(get.status).toBe(200);
		expect(await get.json()).toEqual({ hit: false });
		await Promise.all(one.waited); // the fill runs and simply writes nowhere
		expect(calls).toHaveLength(2);

		const post = await callPOST(fakePost(JSON.stringify({ a: ARTIST, t: TITLE })));
		expect(await post.json()).toEqual({ busted: false });
	});

	it('no platform.ctx (no waitUntil available): the GET still answers, just without a fill', async () => {
		stubCache();
		const { calls } = stubUpstream([SEARCH_HIT, DETAIL_HIT]);
		const url = new URL(`${ORIGIN}/api/resolve?a=${ARTIST}&t=${TITLE}`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET({
			url,
			platform: undefined,
			request: new Request(url, { headers: { origin: ORIGIN } })
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		expect(await res.json()).toEqual({ hit: false });
		expect(calls).toHaveLength(0);
	});
});

describe('/api/resolve OPTIONS', () => {
	it('answers the preflight 204 with own-origin CORS, never `*`', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await OPTIONS({
			request: new Request(`${ORIGIN}/api/resolve`, { headers: { origin: ORIGIN } })
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
	});
});
