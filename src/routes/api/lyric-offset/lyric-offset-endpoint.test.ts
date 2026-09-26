// /api/lyric-offset endpoint tests (quick-260926-mzn) — the GET/POST status matrix driven through
// the exported verb handlers, over an in-memory R2 stand-in WITH etag + conditional-put semantics.
//
// Every reject path asserts the bucket was not touched (neither get nor put), and every response
// body is checked for the absence of `votes` / a voter id / the raw IP.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s at request time,
// see the diag route header). That is a live dev-server check.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { voterId, MAX_VOTE_BODY_BYTES } from '$lib/proxy/lyric-offset';
import { GET, POST } from './+server';

const K = 'ab'.repeat(16);
const OBJ_KEY = `lyric-offset/${K}.json`;

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
	const url = new URL('https://openmusic.lol/api/lyric-offset');
	for (const [k, v] of Object.entries(opts.search ?? {})) url.searchParams.set(k, v);
	const headers = { origin: 'https://openmusic.lol', ...(opts.headers ?? {}) };
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
const vote = (offset: unknown, k: string = K) => JSON.stringify({ k, offset });

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

/** Seed `n` agreeing votes at `o` from distinct fake voters. */
function seed(bucket: Bucket, offsets: number[]) {
	const votes: Record<string, { o: number; t: number }> = {};
	offsets.forEach((o, i) => (votes[`voter${i}`] = { o, t: i }));
	bucket.store.set(OBJ_KEY, { text: JSON.stringify({ v: 1, votes }), etag: 'seed' });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GET /api/lyric-offset', () => {
	it('a bad key is 400 invalid-key and never reaches R2', async () => {
		for (const search of [{}, { k: 'ZZ'.repeat(16) }, { k: 'a'.repeat(31) }, { k: '../x' }]) {
			const bucket = fakeBucket();
			const res = await callGET(fakeEvent('GET', { search, env: env(bucket) }));
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ ok: false, err: 'invalid-key' });
			expect(bucket.get).not.toHaveBeenCalled();
			expect(bucket.put).not.toHaveBeenCalled();
		}
	});

	it('no DIAG binding → 503 unconfigured; no platform at all → 503, not a throw', async () => {
		const a = await callGET(fakeEvent('GET', { search: { k: K }, env: {} }));
		expect(a.status).toBe(503);
		expect(await a.json()).toEqual({ ok: false, err: 'unconfigured' });
		const b = await callGET(fakeEvent('GET', { search: { k: K } }));
		expect(b.status).toBe(503);
	});

	it('no object → cacheable {ok, offset:null, n:0}, read from exactly lyric-offset/<k>.json', async () => {
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
		expect(await res.json()).toEqual({ ok: true, offset: null, n: 0 });
		expect(bucket.get).toHaveBeenCalledTimes(1);
		expect(bucket.get).toHaveBeenCalledWith(OBJ_KEY);
	});

	it('3 agreeing votes → the median; the reply never exposes votes or voter ids', async () => {
		const bucket = fakeBucket();
		seed(bucket, [1, 1.2, 1.1]);
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		const text = await res.text();
		expect(JSON.parse(text)).toEqual({ ok: true, offset: 1.1, n: 3 });
		expect(text).not.toContain('votes');
		expect(text).not.toContain('voter');
	});

	it('an edge-cache hit is served without touching R2', async () => {
		const cache = stubCaches();
		cache.store.set(`https://openmusic.lol/api/lyric-offset?k=${K}`, JSON.stringify({ ok: true, offset: 3, n: 4 }));
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, offset: 3, n: 4 });
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(bucket.get).not.toHaveBeenCalled();
	});

	it('a miss writes the CORS-free body to the edge cache under the own-origin URL', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		expect(cache.put).toHaveBeenCalledTimes(1);
		const [req] = cache.put.mock.calls[0];
		expect(req.url).toBe(`https://openmusic.lol/api/lyric-offset?k=${K}`);
	});
});

describe('POST /api/lyric-offset — rejects touch nothing', () => {
	const rejects = async (e: ReturnType<typeof fakeEvent>, bucket: Bucket, status: number, err: string) => {
		const res = await callPOST(e);
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ ok: false, err });
		expect(bucket.put).not.toHaveBeenCalled();
		expect(bucket.get).not.toHaveBeenCalled();
	};

	it('no binding → 503', async () => {
		const bucket = fakeBucket();
		await rejects(fakeEvent('POST', { body: vote(1), env: {} }), bucket, 503, 'unconfigured');
	});

	it('declared content-length over the cap → 413 before the body is read', async () => {
		const bucket = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: vote(1), headers: { 'content-length': '600' }, env: env(bucket) }),
			bucket,
			413,
			'too-large'
		);
	});

	it('an oversize body with no content-length → 413', async () => {
		const bucket = fakeBucket();
		const body = 'x'.repeat(300);
		expect(body.length).toBeGreaterThan(MAX_VOTE_BODY_BYTES);
		await rejects(fakeEvent('POST', { body, env: env(bucket) }), bucket, 413, 'too-large');
	});

	it('malformed votes → 400 invalid', async () => {
		for (const body of ['not json', vote(1, 'bad'), vote('1'), vote(1e9)]) {
			const bucket = fakeBucket();
			await rejects(fakeEvent('POST', { body, env: env(bucket) }), bucket, 400, 'invalid');
		}
	});

	it('no client address (null, or a throwing getClientAddress) → 400 no-address', async () => {
		const a = fakeBucket();
		await rejects(fakeEvent('POST', { body: vote(1), env: env(a), ip: null }), a, 400, 'no-address');
		const b = fakeBucket();
		const throwing = () => {
			throw new Error('unavailable');
		};
		await rejects(fakeEvent('POST', { body: vote(1), env: env(b), ip: throwing }), b, 400, 'no-address');
	});
});

describe('POST /api/lyric-offset — accepted votes', () => {
	it('first vote creates the record with a create-only conditional put; the raw IP is never stored', async () => {
		const bucket = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote(2.34), env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBeNull();
		expect(await res.json()).toEqual({ ok: true, offset: null, n: 1 });
		expect(bucket.put).toHaveBeenCalledTimes(1);
		const [key, value, opts] = bucket.put.mock.calls[0];
		expect(key).toBe(OBJ_KEY);
		expect(typeof value).toBe('string');
		expect(opts).toEqual({ httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
		const stored = bucket.store.get(OBJ_KEY)!.text;
		expect(stored).not.toContain('1.2.3.4');
		const id = await voterId('1.2.3.4', K);
		expect(JSON.parse(stored).votes[id].o).toBe(2.3);
	});

	it('the same IP re-voting replaces its vote under an etag-matched put', async () => {
		const bucket = fakeBucket();
		await callPOST(fakeEvent('POST', { body: vote(1), env: env(bucket) }));
		const etag = bucket.store.get(OBJ_KEY)!.etag;
		const res = await callPOST(fakeEvent('POST', { body: vote(5), env: env(bucket) }));
		expect(await res.json()).toEqual({ ok: true, offset: null, n: 1 });
		expect(bucket.put.mock.calls[1][2]).toEqual({
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagMatches: etag }
		});
		const id = await voterId('1.2.3.4', K);
		expect(JSON.parse(bucket.store.get(OBJ_KEY)!.text).votes[id].o).toBe(5);
	});

	it('three distinct IPs agreeing → consensus in the third reply; no reply exposes votes or ids', async () => {
		const bucket = fakeBucket();
		const texts: string[] = [];
		for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
			const res = await callPOST(fakeEvent('POST', { body: vote(2), env: env(bucket), ip }));
			expect(res.headers.get('Cache-Control')).toBeNull();
			texts.push(await res.text());
		}
		expect(JSON.parse(texts[2])).toEqual({ ok: true, offset: 2, n: 3 });
		const ids = await Promise.all(['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => voterId(ip, K)));
		for (const t of texts) {
			expect(t).not.toContain('votes');
			for (const id of ids) expect(t).not.toContain(id);
		}
	});

	it('a put that always loses the race → 409 conflict after exactly 3 attempts', async () => {
		const bucket = conflictBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote(1), env: env(bucket) }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ ok: false, err: 'conflict' });
		expect(bucket.put).toHaveBeenCalledTimes(3);
	});

	it('a successful vote busts the GET edge-cache entry for exactly ?k=<k>', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: vote(1), env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(cache.delete).toHaveBeenCalledTimes(1);
		expect(cache.delete.mock.calls[0][0].url).toBe(`https://openmusic.lol/api/lyric-offset?k=${K}`);
	});
});
