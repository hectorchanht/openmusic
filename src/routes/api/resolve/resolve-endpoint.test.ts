// Endpoint tests for /api/resolve (phase 31 D-06/D-07/D-09/D-10, entry shape rebuilt around the
// permanent qq song_mid by 32-D-10 / 32-D-10a).
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
import {
	resolveCacheKey,
	writeResolveEntry,
	RESOLVE_TTL_S,
	RESOLVE_MID_TTL_S,
	type ResolveEntry
} from '$lib/proxy/resolve-cache';

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

/** Stub the qq (tang) upstream. Every subrequest URL is recorded so counts can be asserted. */
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

const MID = '003OUlho2gk0Ny';
// 32-D-01: the fill is ONE qq search subrequest; `song_mid` is on the row, so there is no detail
// call left to stub. Every `stubUpstream([SEARCH_HIT])` below used to be `[SEARCH_HIT, DETAIL_HIT]`.
const SEARCH_HIT = json([{ song_mid: MID, song_title: TITLE, singer_name: ARTIST }]);
const SEARCH_DRY = json([]);
/** 32-D-20: the tang DETAIL body the refresh-on-read turns into a fresh `url`. */
const SQ_URL = 'https://isure6.stream.qqmusic.qq.com/sq.flac';
const DETAIL_HIT = json({ song_mid: MID, song_play_url_sq: 'http://isure6.stream.qqmusic.qq.com/sq.flac' });

const OK_ENTRY = {
	source: 'qq',
	songid: MID,
	avail: { qq: 'ok' },
	url: null,
	urlExp: null,
	urlQuality: null
};
const DRY_ENTRY = {
	source: null,
	songid: null,
	avail: { qq: 'dry' },
	url: null,
	urlExp: null,
	urlQuality: null
};

/** Seed the shimmed cache with an entry directly, so a url's freshness can be dialed per case. */
async function seed(entry: ResolveEntry) {
	await writeResolveEntry(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).caches.default,
		resolveCacheKey(ORIGIN, ARTIST, TITLE),
		entry
	);
}

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
		stubUpstream([SEARCH_HIT]);
		const { event, waited } = fakeGet({ a: ARTIST, t: TITLE });

		const res = await callGET(event);
		// The response is produced BEFORE the fill has been awaited — that is the whole point.
		expect(await res.json()).toEqual({ hit: false });
		expect(event.platform.ctx.waitUntil).toHaveBeenCalledTimes(1);
		expect(waited).toHaveLength(1);
	});

	it('the scheduled fill writes the ok entry, and a SECOND identical GET is a HIT', async () => {
		const { putKeys } = stubCache();
		const first = stubUpstream([SEARCH_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		expect(putKeys).toEqual([KEY]);
		expect(first.calls).toHaveLength(1); // 32-D-10: ONE subrequest, not two

		// Only fetch is re-stubbed — the in-memory cache store must survive, or the second GET
		// would trivially miss for the wrong reason.
		const second = stubUpstream([]);
		const two = fakeGet({ a: ARTIST, t: TITLE });
		const res = await callGET(two.event);

		// 32-D-20 — INTENDED CHANGE from 32-04's "ZERO subrequests" pin: the search fill writes a
		// url-LESS positive, so this read is exactly the refresh-on-read trigger and spends ONE
		// bounded background detail call. The zero-subrequest property moves to the url-WARM read
		// asserted in the next case, which is the one a user's repeat play actually hits.
		expect(await res.json()).toEqual({ hit: true, entry: OK_ENTRY });
		expect(two.event.platform.ctx.waitUntil).toHaveBeenCalledTimes(1);
		expect(second.calls).toHaveLength(1);
		expect(second.calls[0]).toContain(`mid=${MID}`);
		expect(second.calls[0]).not.toContain('msg=');
	});

	it('a query-variant GET (different casing/punctuation) hits the SAME entry', async () => {
		stubCache();
		stubUpstream([SEARCH_HIT]);
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
		stubUpstream([SEARCH_HIT]);
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
		stubUpstream([SEARCH_HIT]);
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
		stubUpstream([SEARCH_HIT]);
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
		stubUpstream([SEARCH_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		// 32-D-10a: a POSITIVE fill (a song_mid) is stored permanent + immutable …
		expect(store.get(KEY)?.headers.get('Cache-Control')).toBe(
			`public, max-age=${RESOLVE_MID_TTL_S}, immutable`
		);
	});

	it('a NEGATIVE fill is stored at the SHORT TTL — end to end through the route (32-D-10a)', async () => {
		// The route-level half of VALIDATION gate #5: a flaky 0-row qq search must not be able to
		// pin this song lossy for the whole PoP. 15 minutes and it re-fills.
		const { store } = stubCache();
		stubUpstream([SEARCH_DRY]);
		const one = fakeGet({ a: ARTIST, t: TITLE });
		await callGET(one.event);
		await Promise.all(one.waited);

		expect(store.get(KEY)?.headers.get('Cache-Control')).toBe(`public, max-age=${RESOLVE_TTL_S}`);
	});
});

describe('/api/resolve POST — DELETE-ONLY bust (31-D-09, T-31-03-01)', () => {
	it('deletes the SAME key the GET wrote and reports busted: true', async () => {
		const { putKeys, cacheStub } = stubCache();
		stubUpstream([SEARCH_HIT]);
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
		const { calls } = stubUpstream([SEARCH_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		const get = await callGET(one.event);
		expect(get.status).toBe(200);
		expect(await get.json()).toEqual({ hit: false });
		await Promise.all(one.waited); // the fill runs and simply writes nowhere
		expect(calls).toHaveLength(1);

		const post = await callPOST(fakePost(JSON.stringify({ a: ARTIST, t: TITLE })));
		expect(await post.json()).toEqual({ busted: false });
	});

	it('no platform.ctx (no waitUntil available): the GET still answers, just without a fill', async () => {
		stubCache();
		const { calls } = stubUpstream([SEARCH_HIT]);
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


// 32-D-20 — the url layer. The entry now carries a short-lived `url` beside the permanent mid, and
// the EDGE owns its freshness: a stale url is nulled out of the VIEW the client sees (one clock,
// one authority) and refilled out of band. THE PROPERTY THAT MATTERS is not that a warm hit is
// fast, it is that a not-fresh url is, from the client's seat, byte-indistinguishable from a url
// the entry never had — the same "advisory, never authoritative" contract as 31-D-08/31-D-11.
describe('/api/resolve GET — url refresh-on-read (32-D-20)', () => {
	const fresh = (): ResolveEntry => ({
		...OK_ENTRY,
		url: SQ_URL,
		urlExp: Date.now() + 900_000,
		urlQuality: 'lossless'
	});
	const stale = (): ResolveEntry => ({
		...OK_ENTRY,
		url: 'https://isure6.stream.qqmusic.qq.com/expired.flac',
		urlExp: Date.now() - 1,
		urlQuality: 'lossless'
	});

	it('a FRESH url is served intact, with ZERO subrequests and no refresh scheduled', async () => {
		stubCache();
		await seed(fresh());
		const { calls } = stubUpstream([]);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		const body = (await (await callGET(one.event)).json()) as { hit: boolean; entry: ResolveEntry };
		expect(body.entry.url).toBe(SQ_URL);
		expect(calls).toHaveLength(0);
		expect(one.event.platform.ctx.waitUntil).not.toHaveBeenCalled();
	});

	it('a STALE url is NULLED in the view (songid intact) and refilled out of band', async () => {
		const { store, putKeys } = stubCache();
		await seed(stale());
		putKeys.length = 0;
		stubUpstream([DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		const body = (await (await callGET(one.event)).json()) as { hit: boolean; entry: ResolveEntry };
		// The client contract is "url present ⇒ fresh". It never reads urlExp.
		expect(body.entry.url).toBeNull();
		expect(body.entry.urlExp).toBeNull();
		expect(body.entry.urlQuality).toBeNull();
		expect(body.entry.songid).toBe(MID);

		await Promise.all(one.waited);
		expect(putKeys).toEqual([KEY]);
		// The rewritten entry keeps the PERMANENT header — the url rides inside the payload and
		// must never shorten the mid's lifetime (32-D-10a's split is untouched) — and the stored
		// copy stays CORS-free (T-31-03-04).
		expect(store.get(KEY)?.headers.get('Cache-Control')).toBe(
			`public, max-age=${RESOLVE_MID_TTL_S}, immutable`
		);
		expect([...(store.get(KEY)?.headers.keys() ?? [])].sort()).toEqual([
			'cache-control',
			'content-type'
		]);

		// … and a SECOND read now serves the refreshed url with ZERO subrequests: the 0.44s path.
		const second = stubUpstream([]);
		const two = fakeGet({ a: ARTIST, t: TITLE });
		const after = (await (await callGET(two.event)).json()) as { entry: ResolveEntry };
		expect(after.entry.url).toBe(SQ_URL);
		expect(after.entry.urlQuality).toBe('lossless');
		expect(second.calls).toHaveLength(0);
		expect(two.event.platform.ctx.waitUntil).not.toHaveBeenCalled();
	});

	it('a DRY negative NEVER triggers a refill — there is no mid to refill from', async () => {
		stubCache();
		await seed(DRY_ENTRY);
		const { calls } = stubUpstream([DETAIL_HIT]);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		expect(await (await callGET(one.event)).json()).toEqual({ hit: true, entry: DRY_ENTRY });
		expect(one.event.platform.ctx.waitUntil).not.toHaveBeenCalled();
		expect(calls).toHaveLength(0);
	});

	it('a refresh that yields no url writes NOTHING — a tang fault is retried, never pinned', async () => {
		const { putKeys } = stubCache();
		await seed(stale());
		putKeys.length = 0;
		stubUpstream(['THROW']);
		const one = fakeGet({ a: ARTIST, t: TITLE });

		await callGET(one.event);
		await Promise.all(one.waited);
		expect(putKeys).toHaveLength(0);
	});
});
