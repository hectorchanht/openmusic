// /api/cover-pick endpoint tests (Phase 40 D-13 / D-17 / D-18 / D-18a / D-19) — the GET/POST status
// matrix driven through the exported verb handlers, over an in-memory R2 stand-in WITH etag +
// conditional-put semantics (cloned from the lyric-offset endpoint test).
//
// Every reject path asserts the bucket was not touched, and every response body is checked for the
// absence of `votes` / a voter id / the raw IP.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s at request time).
// That is the manual curl row in 40-VALIDATION.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { voterId, throttleVoterId, MAX_VOTE_BODY_BYTES, PICK_MIN_GAP_MS } from '$lib/proxy/cover-pick';
import { GET, POST } from './+server';

const K1 = 'ab'.repeat(16);
const K2 = 'cd'.repeat(16);
const U_KEY = `cover-pick/u/${K1}.json`;
const N_KEY = `cover-pick/n/${K2}.json`;
const URL_QQ = 'https://y.gtimg.cn/music/photo_new/x.jpg';
const BASE = 'https://openmusic.lol/api/cover-pick';
// The edge-cache key lives OFF the public GET URL: adapter-cloudflare's worker answers any GET whose
// own URL is in caches.default straight from the cache, before hooks.server.ts adds CORS, so a public
// key would ship a CORS-less reply the APK WebView (https://localhost) cannot read.
const EDGE = 'https://openmusic.lol/api/cover-pick/__edge';

type PutOpts = { httpMetadata?: unknown; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } };

/** R2 stand-in: etags + conditional put (null = precondition failed, nothing stored). */
function fakeBucket() {
	const store = new Map<string, { text: string; etag: string }>();
	let n = 0;
	return {
		store,
		get: vi.fn(async (key: string) => {
			const e = store.get(key);
			return e ? { etag: e.etag, text: async () => e.text } : null;
		}),
		put: vi.fn(async (key: string, value: string, opts: PutOpts) => {
			const cur = store.get(key);
			if (opts?.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
			if (opts?.onlyIf?.etagMatches !== undefined && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
			const etag = 'e' + ++n;
			store.set(key, { text: value, etag });
			return { etag };
		})
	};
}

/** A bucket whose conditional put always loses the race. */
function conflictBucket() {
	const b = fakeBucket();
	b.put.mockImplementation(async () => null);
	return b;
}

type Bucket = ReturnType<typeof fakeBucket>;

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
	search?: Record<string, string>;
	ip?: string | null | (() => string);
}

function fakeEvent(method: 'GET' | 'POST', opts: EventOpts = {}) {
	const url = new URL(BASE);
	for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
	const headers: Record<string, string> = {
		origin: 'https://openmusic.lol',
		...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
		...(opts.headers ?? {})
	};
	// A header set to '' is dropped, so a test can model "browser sent no Origin".
	for (const [h, v] of Object.entries(headers)) if (v === '') delete headers[h];
	const ip = opts.ip === undefined ? '1.2.3.4' : opts.ip;
	return {
		url,
		platform: opts.env ? { env: opts.env } : undefined,
		request: new Request(url, { method, headers, body: opts.body }),
		getClientAddress: typeof ip === 'function' ? ip : () => ip
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (e: ReturnType<typeof fakeEvent>) => GET(e as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callPOST = (e: ReturnType<typeof fakeEvent>) => POST(e as any);

const env = (bucket: Bucket) => ({ DIAG: bucket });
const vote = (body: Record<string, unknown>) => JSON.stringify({ url: URL_QQ, ...body });

/** The makeFakeCache shape from proxy.test.ts plus `delete`, stubbed as `caches`. */
function stubCaches() {
	const store = new Map<string, string>();
	const put = vi.fn(async (req: Request, res: Response) => {
		store.set(req.url, await res.text());
	});
	const match = vi.fn(async (req: Request) => {
		const text = store.get(req.url);
		return text === undefined ? undefined : new Response(text, { headers: { 'content-type': 'application/json' } });
	});
	const del = vi.fn(async (req: Request) => store.delete(req.url));
	vi.stubGlobal('caches', { default: { match, put, delete: del } });
	return { store, put, match, delete: del };
}

/** No bucket key the route touched may sit outside the two cover-pick prefixes. */
function expectConfined(bucket: Bucket) {
	const keys = [...bucket.get.mock.calls, ...bucket.put.mock.calls].map((c) => c[0] as string);
	for (const k of keys) {
		expect(k.startsWith('log/')).toBe(false);
		expect(k.startsWith('cover-pick/') || k.startsWith('cover-pick-throttle/')).toBe(true);
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GET /api/cover-pick', () => {
	it('neither u nor n, or a malformed key → 400 invalid-key, R2 untouched', async () => {
		for (const search of [{}, { u: 'ZZ'.repeat(16) }, { n: 'a'.repeat(31) }, { u: K1, n: '../x' }] as Record<
			string,
			string
		>[]) {
			const bucket = fakeBucket();
			const res = await callGET(fakeEvent('GET', { search, env: env(bucket) }));
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ ok: false, err: 'invalid-key' });
			expect(bucket.get).not.toHaveBeenCalled();
		}
	});

	it('no DIAG binding → 503 unconfigured; no platform at all → 503, not a throw', async () => {
		const a = await callGET(fakeEvent('GET', { search: { u: K1 }, env: {} }));
		expect(a.status).toBe(503);
		expect(await a.json()).toEqual({ ok: false, err: 'unconfigured' });
		const b = await callGET(fakeEvent('GET', { search: { u: K1 } }));
		expect(b.status).toBe(503);
	});

	it('?u only → {ok, u:null, n:null}, reads exactly cover-pick/u/<K1>.json, browser no-cache', async () => {
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { u: K1 }, env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-cache');
		expect(await res.json()).toEqual({ ok: true, u: null, n: null });
		expect(bucket.get).toHaveBeenCalledTimes(1);
		expect(bucket.get).toHaveBeenCalledWith(U_KEY);
	});

	it('?u&n reads both records and returns each consensus; never exposes votes or ids', async () => {
		const bucket = fakeBucket();
		// 40-WR-01: two agreeing voters — the quorum a published pick needs.
		bucket.store.set(U_KEY, {
			text: JSON.stringify({ v: 1, votes: { x: { u: URL_QQ, t: 1 }, y: { u: URL_QQ, t: 2 } } }),
			etag: 's1'
		});
		const res = await callGET(fakeEvent('GET', { search: { u: K1, n: K2 }, env: env(bucket) }));
		const text = await res.text();
		expect(JSON.parse(text)).toEqual({ ok: true, u: URL_QQ, n: null });
		expect(bucket.get).toHaveBeenCalledWith(U_KEY);
		expect(bucket.get).toHaveBeenCalledWith(N_KEY);
		expect(text).not.toContain('votes');
		expect(text).not.toContain('"x"');
		expectConfined(bucket);
	});

	it('a stored record with a no-longer-allowlisted url is screened out on read', async () => {
		const bucket = fakeBucket();
		bucket.store.set(U_KEY, {
			text: JSON.stringify({ v: 1, votes: { x: { u: 'https://example.com/x.jpg', t: 1 } } }),
			etag: 's1'
		});
		const res = await callGET(fakeEvent('GET', { search: { u: K1 }, env: env(bucket) }));
		expect(await res.json()).toEqual({ ok: true, u: null, n: null });
	});

	it('a miss writes the body to the edge cache with the 300 s TTL', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		await callGET(fakeEvent('GET', { search: { u: K1, n: K2 }, env: env(bucket) }));
		expect(cache.put).toHaveBeenCalledTimes(1);
		const [req, stored] = cache.put.mock.calls[0];
		expect(req.url).toBe(`${EDGE}?u=${K1}&n=${K2}`);
		expect(stored.headers.get('Cache-Control')).toBe('public, max-age=300');
	});

	it('the edge-cache key is never the public GET URL the adapter worker would serve without CORS', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		await callGET(fakeEvent('GET', { search: { u: K1, n: K2 }, env: env(bucket) }));
		const [req] = cache.put.mock.calls[0];
		expect(new URL(req.url).pathname).not.toBe('/api/cover-pick');
		expect(cache.store.has(`${BASE}?u=${K1}&n=${K2}`)).toBe(false);
	});

	it('a repeat GET from the APK origin (https://localhost) is a cache hit that carries CORS', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		const apk = { headers: { origin: 'https://localhost' } };
		await callGET(fakeEvent('GET', { search: { u: K1 }, env: env(bucket), ...apk }));
		const res = await callGET(fakeEvent('GET', { search: { u: K1 }, env: env(bucket), ...apk }));
		expect(cache.match).toHaveBeenCalledTimes(2);
		expect(bucket.get).toHaveBeenCalledTimes(1); // the second one was the hit
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
	});

	it('an edge-cache hit is served without touching R2', async () => {
		const cache = stubCaches();
		cache.store.set(`${EDGE}?u=${K1}`, JSON.stringify({ ok: true, u: URL_QQ, n: null }));
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { u: K1 }, env: env(bucket) }));
		expect(await res.json()).toEqual({ ok: true, u: URL_QQ, n: null });
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(res.headers.get('Cache-Control')).toBe('no-cache');
		expect(bucket.get).not.toHaveBeenCalled();
	});
});

describe('POST /api/cover-pick — rejects touch nothing', () => {
	const rejects = async (e: ReturnType<typeof fakeEvent>, bucket: Bucket, status: number, err: string) => {
		const res = await callPOST(e);
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ ok: false, err });
		expect(bucket.put).not.toHaveBeenCalled();
		expect(bucket.get).not.toHaveBeenCalled();
	};

	it('no binding → 503', async () => {
		await rejects(fakeEvent('POST', { body: vote({ u: K1 }), env: {} }), fakeBucket(), 503, 'unconfigured');
	});

	it('a foreign Origin → 403 forbidden-origin', async () => {
		const bucket = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: vote({ u: K1 }), headers: { origin: 'https://evil.example' }, env: env(bucket) }),
			bucket,
			403,
			'forbidden-origin'
		);
	});

	it('an absent Origin → 403 (votes only from an allowlisted origin)', async () => {
		const bucket = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: vote({ u: K1 }), headers: { origin: '' }, env: env(bucket) }),
			bucket,
			403,
			'forbidden-origin'
		);
	});

	it('a non-JSON content type → 415', async () => {
		for (const ct of ['text/plain', '']) {
			const bucket = fakeBucket();
			await rejects(
				fakeEvent('POST', { body: vote({ u: K1 }), headers: { 'content-type': ct }, env: env(bucket) }),
				bucket,
				415,
				'unsupported-type'
			);
		}
	});

	it('declared content-length over the cap → 413', async () => {
		const bucket = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: vote({ u: K1 }), headers: { 'content-length': '2000' }, env: env(bucket) }),
			bucket,
			413,
			'too-large'
		);
	});

	it('an oversize real body → 413', async () => {
		const bucket = fakeBucket();
		const body = 'x'.repeat(MAX_VOTE_BODY_BYTES + 1);
		await rejects(fakeEvent('POST', { body, env: env(bucket) }), bucket, 413, 'too-large');
	});

	it('unparsable, keyless or non-allowlisted votes → 400 invalid', async () => {
		for (const body of [
			'not json',
			vote({}),
			vote({ u: 'bad' }),
			vote({ u: K1, url: 'https://example.com/x.jpg' }),
			vote({ u: K1, url: 'http://y.gtimg.cn/x.jpg' })
		]) {
			const bucket = fakeBucket();
			await rejects(fakeEvent('POST', { body, env: env(bucket) }), bucket, 400, 'invalid');
		}
	});

	it('no client address (null, or a throwing getClientAddress) → 400 no-address', async () => {
		const a = fakeBucket();
		await rejects(fakeEvent('POST', { body: vote({ u: K1 }), env: env(a), ip: null }), a, 400, 'no-address');
		const b = fakeBucket();
		const throwing = () => {
			throw new Error('unavailable');
		};
		await rejects(fakeEvent('POST', { body: vote({ u: K1 }), env: env(b), ip: throwing }), b, 400, 'no-address');
	});
});

describe('POST /api/cover-pick — accepted votes', () => {
	it('throttle first, then both records, each with one vote under its per-key voter id', async () => {
		const bucket = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote({ u: K1, n: K2 }), env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBeNull();
		const text = await res.text();
		// 40-WR-01: a lone vote is stored but not published.
		expect(JSON.parse(text)).toEqual({ ok: true, u: null, n: null });

		const thKey = `cover-pick-throttle/${await throttleVoterId('1.2.3.4')}.json`;
		expect(bucket.put.mock.calls.map((c) => c[0])).toEqual([thKey, U_KEY, N_KEY]);
		expect(bucket.put.mock.calls[1][2]).toEqual({
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagDoesNotMatch: '*' }
		});

		const idU = await voterId('1.2.3.4', K1);
		const idN = await voterId('1.2.3.4', K2);
		expect(JSON.parse(bucket.store.get(U_KEY)!.text).votes).toEqual({ [idU]: { u: URL_QQ, t: expect.any(Number) } });
		expect(Object.keys(JSON.parse(bucket.store.get(N_KEY)!.text).votes)).toEqual([idN]);

		for (const [, v] of bucket.store) expect(v.text).not.toContain('1.2.3.4');
		expect(text).not.toContain('votes');
		expect(text).not.toContain(idU);
		expect(text).not.toContain('1.2.3.4');
		expectConfined(bucket);
	});

	it('a vote busts the GET edge-cache entry for exactly ?u=<K1>&n=<K2>', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		await callPOST(fakeEvent('POST', { body: vote({ u: K1, n: K2 }), env: env(bucket) }));
		expect(cache.delete).toHaveBeenCalledTimes(1);
		expect(cache.delete.mock.calls[0][0].url).toBe(`${EDGE}?u=${K1}&n=${K2}`);
	});

	it('n only → only the n record is written; the bust key is ?n=<K2>', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote({ n: K2 }), env: env(bucket) }));
		expect(await res.json()).toEqual({ ok: true, u: null, n: null }); // 40-WR-01: lone vote, unpublished
		expect(bucket.store.has(U_KEY)).toBe(false);
		expect(bucket.store.has(N_KEY)).toBe(true);
		expect(cache.delete.mock.calls[0][0].url).toBe(`${EDGE}?n=${K2}`);
	});

	it('a second vote from the same ip inside PICK_MIN_GAP_MS → 429 slow-down, no record written', async () => {
		const bucket = fakeBucket();
		await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket) }));
		const before = bucket.store.get(U_KEY)!.text;
		const res = await callPOST(
			fakeEvent('POST', { body: vote({ u: K1, url: 'https://e-cdns-images.dzcdn.net/x.jpg' }), env: env(bucket) })
		);
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ ok: false, err: 'slow-down' });
		expect(bucket.store.get(U_KEY)!.text).toBe(before);
	});

	it('a re-vote after the gap replaces the voter’s pick (D-19) under an etag-matched put', async () => {
		vi.useFakeTimers();
		try {
			const bucket = fakeBucket();
			await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket) }));
			const etag = bucket.store.get(U_KEY)!.etag;
			vi.advanceTimersByTime(PICK_MIN_GAP_MS);
			const DZ = 'https://e-cdns-images.dzcdn.net/x.jpg';
			const res = await callPOST(fakeEvent('POST', { body: vote({ u: K1, url: DZ }), env: env(bucket) }));
			expect(await res.json()).toEqual({ ok: true, u: null, n: null }); // 40-WR-01: still one voter
			expect((Object.values(JSON.parse(bucket.store.get(U_KEY)!.text).votes) as { u: string }[])[0].u).toBe(DZ);
			const last = bucket.put.mock.calls.at(-1)!;
			expect(last[0]).toBe(U_KEY);
			expect(last[2]).toEqual({ httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag } });
			expect(Object.keys(JSON.parse(bucket.store.get(U_KEY)!.text).votes)).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	// 40-WR-01: the quorum — a second DISTINCT voter publishes; a second address in the same /64 does not.
	it('a second distinct voter publishes; the same IPv6 /64 counts once', async () => {
		const bucket = fakeBucket();
		const a = await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket), ip: '2001:db8:0:1::1' }));
		expect(await a.json()).toEqual({ ok: true, u: null, n: null });
		const b = await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket), ip: '2001:db8:0:1::2' }));
		expect(b.status).toBe(429); // same /64 → same throttle bucket
		const c = await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket), ip: '2.2.2.2' }));
		expect(await c.json()).toEqual({ ok: true, u: URL_QQ, n: null });
	});

	it('distinct ips: most votes wins', async () => {
		const bucket = fakeBucket();
		const DZ = 'https://e-cdns-images.dzcdn.net/x.jpg';
		await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket), ip: '1.1.1.1' }));
		await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket), ip: '2.2.2.2' }));
		const res = await callPOST(fakeEvent('POST', { body: vote({ u: K1, url: DZ }), env: env(bucket), ip: '3.3.3.3' }));
		expect(await res.json()).toEqual({ ok: true, u: URL_QQ, n: null });
	});

	// 40-CR-01: the netease redirector is never stored — only its resolved music.126.net target.
	it('a netease redirector vote stores the resolved music.126.net url; an unresolvable one → 400', async () => {
		const RED = 'https://api.qijieya.cn/meting/?server=netease&type=pic&id=109951173569626660';
		const TARGET = 'https://p3.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/109951173569626660.jpg?param=300y300';
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: TARGET } })));
		const bucket = fakeBucket();
		const ok = await callPOST(fakeEvent('POST', { body: vote({ u: K1, url: RED }), env: env(bucket) }));
		expect(ok.status).toBe(200);
		const stored = Object.values(JSON.parse(bucket.store.get(U_KEY)!.text).votes) as { u: string }[];
		expect(stored.map((v) => v.u)).toEqual([TARGET]);

		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })));
		const bucket2 = fakeBucket();
		const bad = await callPOST(fakeEvent('POST', { body: vote({ u: K1, url: RED }), env: env(bucket2), ip: '9.9.9.9' }));
		expect(bad.status).toBe(400);
		expect(bucket2.store.has(U_KEY)).toBe(false);
	});

	it('a lost throttle race → 429, no vote record written', async () => {
		const bucket = conflictBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket) }));
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ ok: false, err: 'slow-down' });
		expect(bucket.put).toHaveBeenCalledTimes(1);
		expect(bucket.put.mock.calls[0][0]).toMatch(/^cover-pick-throttle\//);
	});

	it('a vote put that always loses the race → 409 conflict after exactly 3 attempts', async () => {
		const bucket = fakeBucket();
		const real = bucket.put.getMockImplementation()!;
		bucket.put.mockImplementation(async (key: string, value: string, opts: PutOpts) =>
			key.startsWith('cover-pick-throttle/') ? real(key, value, opts) : null
		);
		const res = await callPOST(fakeEvent('POST', { body: vote({ u: K1 }), env: env(bucket) }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ ok: false, err: 'conflict' });
		expect(bucket.put.mock.calls.filter((c) => c[0] === U_KEY)).toHaveLength(3);
	});
});
