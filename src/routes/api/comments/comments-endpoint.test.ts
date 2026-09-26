// /api/comments endpoint tests (quick-260926-nsz) — the GET/POST/DELETE status matrix driven
// through the exported verb handlers, over an in-memory R2 stand-in WITH etag + conditional-put
// semantics (harness copied from lyric-offset-endpoint.test.ts). Turnstile siteverify is a stubbed
// global fetch.
//
// Every reject path asserts the bucket was not touched, and public responses are checked for the
// absence of `reporters` / a voter hash / the raw IP.
//
// What these CANNOT prove: that SvelteKit loads the module (a non-verb export 500s at request time).
// That is a live dev-server check.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voterId } from '$lib/proxy/comments';
import { SITEVERIFY_URL } from '$lib/proxy/turnstile';
import { GET, POST, DELETE } from './+server';

const K = 'ab'.repeat(16);
const OBJ_KEY = `comments/${K}.json`;
const TOKEN = 'READ-TOKEN';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);

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

type Bucket = ReturnType<typeof fakeBucket>;

interface EventOpts {
	body?: string;
	headers?: Record<string, string>;
	env?: Record<string, unknown>;
	search?: Record<string, string>;
	ip?: string | null | (() => string);
}

function fakeEvent(method: 'GET' | 'POST' | 'DELETE', opts: EventOpts = {}) {
	const url = new URL('https://openmusic.lol/api/comments');
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callDELETE = (e: ReturnType<typeof fakeEvent>) => DELETE(e as any);

const env = (bucket: Bucket, token?: string, extra: Record<string, unknown> = {}) => ({
	DIAG: bucket,
	DIAG_READ_TOKEN: token,
	TurnstileSecret: 'ts-secret',
	TURNSTILE_HOSTNAMES: 'openmusic.lol',
	...extra
});
const bearer = (tok = TOKEN) => ({ authorization: `Bearer ${tok}` });
const postBody = (o: Record<string, unknown> = {}) => JSON.stringify({ k: K, name: 'Frank', text: 'hi', token: 'cf-token', ...o });
const reportBody = (id: string) => JSON.stringify({ k: K, action: 'report', id });

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

/** siteverify stand-in; the default reply passes for action `comment` on openmusic.lol. */
function stubSiteverify(body: Record<string, unknown> = { success: true, hostname: 'openmusic.lol', action: 'comment' }) {
	const f = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status: 200 }));
	vi.stubGlobal('fetch', f);
	return f;
}

const item = (id: string, t: number, reporters: string[] = []) => ({ id, name: `n-${id}`, text: `x-${id}`, t, reporters });
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const ID_H = '00000000-0000-4000-8000-00000000000c';

function seedThread(bucket: Bucket, items: ReturnType<typeof item>[]) {
	bucket.store.set(OBJ_KEY, { text: JSON.stringify({ v: 1, items }), etag: 'seed' });
}
const storedItems = (bucket: Bucket) => JSON.parse(bucket.store.get(OBJ_KEY)!.text).items as ReturnType<typeof item>[];

let now = T0;
beforeEach(() => {
	now = T0;
	vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/comments — public', () => {
	it('a bad key is 400 invalid-key and never reaches R2', async () => {
		for (const search of [{} as Record<string, string>, { k: 'ZZ'.repeat(16) }, { k: 'a'.repeat(31) }, { k: '../x' }]) {
			const bucket = fakeBucket();
			const res = await callGET(fakeEvent('GET', { search, env: env(bucket) }));
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ ok: false, err: 'invalid-key' });
			expect(bucket.get).not.toHaveBeenCalled();
		}
	});

	it('no DIAG binding → 503 unconfigured; no platform at all → 503, not a throw', async () => {
		const a = await callGET(fakeEvent('GET', { search: { k: K }, env: {} }));
		expect(a.status).toBe(503);
		expect(await a.json()).toEqual({ ok: false, err: 'unconfigured' });
		const b = await callGET(fakeEvent('GET', { search: { k: K } }));
		expect(b.status).toBe(503);
	});

	it('no object → cacheable {ok, items:[]}, read from exactly comments/<k>.json', async () => {
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
		expect(await res.json()).toEqual({ ok: true, items: [] });
		expect(bucket.get).toHaveBeenCalledTimes(1);
		expect(bucket.get).toHaveBeenCalledWith(OBJ_KEY);
	});

	it('hidden items are dropped, newest first, and no reporter data leaks', async () => {
		const bucket = fakeBucket();
		const hashes = ['aaaa1111bbbb2222', 'cccc3333dddd4444', 'eeee5555ffff6666'];
		seedThread(bucket, [item(ID_A, 1, [hashes[0]]), item(ID_H, 3, hashes), item(ID_B, 2)]);
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		const text = await res.text();
		expect(JSON.parse(text).items.map((i: { id: string }) => i.id)).toEqual([ID_B, ID_A]);
		expect(text).not.toContain('reporters');
		for (const h of hashes) expect(text).not.toContain(h);
	});

	it('an edge-cache hit is served without touching R2', async () => {
		const cache = stubCaches();
		cache.store.set(`https://openmusic.lol/api/comments?k=${K}`, JSON.stringify({ ok: true, items: [] }));
		const bucket = fakeBucket();
		const res = await callGET(fakeEvent('GET', { search: { k: K }, env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(bucket.get).not.toHaveBeenCalled();
	});

	it('a miss writes the body to the edge cache under the own-origin URL', async () => {
		const cache = stubCaches();
		await callGET(fakeEvent('GET', { search: { k: K }, env: env(fakeBucket()) }));
		expect(cache.put).toHaveBeenCalledTimes(1);
		expect(cache.put.mock.calls[0][0].url).toBe(`https://openmusic.lol/api/comments?k=${K}`);
	});
});

describe('GET /api/comments?all=1 — maintainer', () => {
	it('no token, a wrong token, or an unset DIAG_READ_TOKEN → 401 before cache or R2', async () => {
		for (const [headers, token] of [
			[{}, TOKEN],
			[bearer('wrong'), TOKEN],
			[bearer(), undefined]
		] as const) {
			const cache = stubCaches();
			const bucket = fakeBucket();
			const res = await callGET(fakeEvent('GET', { search: { k: K, all: '1' }, headers, env: env(bucket, token) }));
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ ok: false, err: 'unauthorized' });
			expect(bucket.get).not.toHaveBeenCalled();
			expect(cache.match).not.toHaveBeenCalled();
		}
	});

	it('the correct token shows hidden items with counts, uncached, without the hashes', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		const hashes = ['aaaa1111bbbb2222', 'cccc3333dddd4444', 'eeee5555ffff6666'];
		seedThread(bucket, [item(ID_A, 1), item(ID_H, 3, hashes)]);
		const res = await callGET(fakeEvent('GET', { search: { k: K, all: '1' }, headers: bearer(), env: env(bucket, TOKEN) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBeNull();
		const text = await res.text();
		expect(JSON.parse(text).items).toEqual([
			{ id: ID_H, name: `n-${ID_H}`, text: `x-${ID_H}`, t: 3, reports: 3, hidden: true },
			{ id: ID_A, name: `n-${ID_A}`, text: `x-${ID_A}`, t: 1, reports: 0, hidden: false }
		]);
		for (const h of hashes) expect(text).not.toContain(h);
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
	});
});

describe('POST /api/comments — rejects touch nothing', () => {
	const rejects = async (e: ReturnType<typeof fakeEvent>, bucket: Bucket, status: number, err: string) => {
		const res = await callPOST(e);
		expect(res.status).toBe(status);
		expect(await res.json()).toEqual({ ok: false, err });
		expect(bucket.put).not.toHaveBeenCalled();
		expect(bucket.get).not.toHaveBeenCalled();
	};

	it('no binding → 503', async () => {
		await rejects(fakeEvent('POST', { body: postBody(), env: {} }), fakeBucket(), 503, 'unconfigured');
	});

	it('a foreign Origin → 403 forbidden-origin', async () => {
		const bucket = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: postBody(), headers: { origin: 'https://evil.example' }, env: env(bucket) }),
			bucket,
			403,
			'forbidden-origin'
		);
	});

	it('a non-JSON content type → 415', async () => {
		for (const ct of ['text/plain', '']) {
			const bucket = fakeBucket();
			await rejects(
				fakeEvent('POST', { body: postBody(), headers: { 'content-type': ct }, env: env(bucket) }),
				bucket,
				415,
				'unsupported-type'
			);
		}
	});

	it('declared content-length over the cap → 413; an oversize body with no length → 413', async () => {
		const a = fakeBucket();
		await rejects(
			fakeEvent('POST', { body: postBody(), headers: { 'content-length': '5000' }, env: env(a) }),
			a,
			413,
			'too-large'
		);
		const b = fakeBucket();
		await rejects(fakeEvent('POST', { body: 'x'.repeat(4200), env: env(b) }), b, 413, 'too-large');
	});

	it('malformed bodies → 400 invalid', async () => {
		for (const body of [
			'not json',
			postBody({ k: 'bad' }),
			postBody({ name: '' }),
			postBody({ text: 'x'.repeat(281) }),
			postBody({ token: undefined }),
			reportBody('x')
		]) {
			const bucket = fakeBucket();
			await rejects(fakeEvent('POST', { body, env: env(bucket) }), bucket, 400, 'invalid');
		}
	});

	it('no client address → 400 no-address', async () => {
		const a = fakeBucket();
		await rejects(fakeEvent('POST', { body: postBody(), env: env(a), ip: null }), a, 400, 'no-address');
		const b = fakeBucket();
		const throwing = () => {
			throw new Error('unavailable');
		};
		await rejects(fakeEvent('POST', { body: postBody(), env: env(b), ip: throwing }), b, 400, 'no-address');
	});

	it('Turnstile rejected → 403 turnstile; unconfigured → 503; neither touches R2', async () => {
		for (const verdict of [
			{ success: false },
			{ success: true, hostname: 'openmusic.lol', action: 'login' },
			{ success: true, hostname: 'evil.example', action: 'comment' }
		]) {
			stubSiteverify(verdict);
			const bucket = fakeBucket();
			await rejects(fakeEvent('POST', { body: postBody(), env: env(bucket) }), bucket, 403, 'turnstile');
		}
		for (const extra of [{ TurnstileSecret: undefined }, { TURNSTILE_HOSTNAMES: '' }]) {
			const f = stubSiteverify();
			const bucket = fakeBucket();
			await rejects(fakeEvent('POST', { body: postBody(), env: env(bucket, undefined, extra) }), bucket, 503, 'unconfigured');
			expect(f).not.toHaveBeenCalled();
		}
	});
});

describe('POST /api/comments — posting', () => {
	it('siteverify gets the token, the secret and the client address', async () => {
		const f = stubSiteverify();
		await callPOST(fakeEvent('POST', { body: postBody(), env: env(fakeBucket()) }));
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(SITEVERIFY_URL);
		const form = new URLSearchParams(init.body as URLSearchParams);
		expect(form.get('response')).toBe('cf-token');
		expect(form.get('secret')).toBe('ts-secret');
		expect(form.get('remoteip')).toBe('1.2.3.4');
	});

	it('an absent Origin (non-browser client) is still accepted', async () => {
		stubSiteverify();
		const res = await callPOST(fakeEvent('POST', { body: postBody(), headers: { origin: '' }, env: env(fakeBucket()) }));
		expect(res.status).toBe(200);
	});

	it('first post: throttle put then thread put, both create-only; raw IP never stored', async () => {
		stubSiteverify();
		const cache = stubCaches();
		const bucket = fakeBucket();
		const res = await callPOST(fakeEvent('POST', { body: postBody(), env: env(bucket) }));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBeNull();
		const out = (await res.json()) as { ok: boolean; items: Array<Record<string, unknown>> };
		expect(out.ok).toBe(true);
		expect(out.items).toHaveLength(1);
		expect(Object.keys(out.items[0]).sort()).toEqual(['id', 'name', 't', 'text']);
		expect(out.items[0]).toMatchObject({ name: 'Frank', text: 'hi', t: T0 });
		expect(out.items[0].id).toMatch(UUID_RE);

		const voter = await voterId('1.2.3.4');
		expect(bucket.put).toHaveBeenCalledTimes(2);
		const [[k1, v1, o1], [k2, v2, o2]] = bucket.put.mock.calls;
		expect(k1).toBe(`comments-throttle/${voter}.json`);
		expect(o1).toEqual({ httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
		expect(k2).toBe(OBJ_KEY);
		expect(o2).toEqual({ httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
		for (const v of [v1, v2]) expect(v).not.toContain('1.2.3.4');
		expect(storedItems(bucket)[0].reporters).toEqual([]);

		expect(cache.delete).toHaveBeenCalledTimes(1);
		expect(cache.delete.mock.calls[0][0].url).toBe(`https://openmusic.lol/api/comments?k=${K}`);
	});

	it('same address again at once → 429 slow-down; 30 s later → accepted, newest first', async () => {
		stubSiteverify();
		const bucket = fakeBucket();
		await callPOST(fakeEvent('POST', { body: postBody({ text: 'one' }), env: env(bucket) }));
		const again = await callPOST(fakeEvent('POST', { body: postBody({ text: 'two' }), env: env(bucket) }));
		expect(again.status).toBe(429);
		expect(await again.json()).toEqual({ ok: false, err: 'slow-down' });
		expect(bucket.put).toHaveBeenCalledTimes(2);

		now = T0 + 30_000;
		const later = await callPOST(fakeEvent('POST', { body: postBody({ text: 'three' }), env: env(bucket) }));
		expect(later.status).toBe(200);
		expect(storedItems(bucket).map((i) => i.text)).toEqual(['three', 'one']);
	});

	it('the daily cap holds even after the gap', async () => {
		stubSiteverify();
		const bucket = fakeBucket();
		const voter = await voterId('1.2.3.4');
		bucket.store.set(`comments-throttle/${voter}.json`, {
			text: JSON.stringify({ last: T0 - 60_000, day: '2026-09-26', n: 30 }),
			etag: 'th'
		});
		const res = await callPOST(fakeEvent('POST', { body: postBody(), env: env(bucket) }));
		expect(res.status).toBe(429);
		expect(bucket.store.has(OBJ_KEY)).toBe(false);
	});

	it('a lost throttle race → 429, thread untouched', async () => {
		stubSiteverify();
		const bucket = fakeBucket();
		bucket.put.mockImplementation(async () => null);
		const res = await callPOST(fakeEvent('POST', { body: postBody(), env: env(bucket) }));
		expect(res.status).toBe(429);
		expect(bucket.put).toHaveBeenCalledTimes(1);
		expect(bucket.put.mock.calls[0][0]).toMatch(/^comments-throttle\//);
	});

	it('a thread put that always loses → 409 after exactly 3 thread attempts (throttle slot consumed)', async () => {
		stubSiteverify();
		const bucket = fakeBucket();
		const real = bucket.put.getMockImplementation()!;
		bucket.put.mockImplementation(async (key, value, opts) => (key.startsWith('comments/') ? null : real(key, value, opts)));
		const res = await callPOST(fakeEvent('POST', { body: postBody(), env: env(bucket) }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ ok: false, err: 'conflict' });
		expect(bucket.put.mock.calls.filter(([k]) => k.startsWith('comments/'))).toHaveLength(3);
	});
});

describe('POST /api/comments — reports', () => {
	it('unknown id → 404 with no put', async () => {
		const bucket = fakeBucket();
		seedThread(bucket, [item(ID_A, 1)]);
		const res = await callPOST(fakeEvent('POST', { body: reportBody(ID_B), env: env(bucket) }));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ ok: false, err: 'not-found' });
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('idempotent per address; 3 distinct addresses hide it; no throttle, no Turnstile; busts the cache', async () => {
		const f = stubSiteverify();
		const cache = stubCaches();
		const bucket = fakeBucket();
		seedThread(bucket, [item(ID_A, 1), item(ID_B, 2)]);

		const first = await callPOST(fakeEvent('POST', { body: reportBody(ID_A), env: env(bucket), ip: '1.1.1.1' }));
		expect(first.status).toBe(200);
		expect(storedItems(bucket).find((i) => i.id === ID_A)!.reporters).toHaveLength(1);
		await callPOST(fakeEvent('POST', { body: reportBody(ID_A), env: env(bucket), ip: '1.1.1.1' }));
		expect(storedItems(bucket).find((i) => i.id === ID_A)!.reporters).toHaveLength(1);

		await callPOST(fakeEvent('POST', { body: reportBody(ID_A), env: env(bucket), ip: '2.2.2.2' }));
		const third = await callPOST(fakeEvent('POST', { body: reportBody(ID_A), env: env(bucket), ip: '3.3.3.3' }));
		const text = await third.text();
		expect(JSON.parse(text).items.map((i: { id: string }) => i.id)).toEqual([ID_B]);
		expect(text).not.toContain('reporters');
		for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) expect(text).not.toContain(await voterId(ip));

		const all = await callGET(fakeEvent('GET', { search: { k: K, all: '1' }, headers: bearer(), env: env(bucket, TOKEN) }));
		const allItems = ((await all.json()) as { items: Array<{ id: string }> }).items;
		expect(allItems.find((i) => i.id === ID_A)).toMatchObject({ reports: 3, hidden: true });

		expect(bucket.put.mock.calls.some(([k]) => k.startsWith('comments-throttle/'))).toBe(false);
		expect(f).not.toHaveBeenCalled();
		expect(cache.delete).toHaveBeenCalled();
		expect(cache.delete.mock.calls[0][0].url).toBe(`https://openmusic.lol/api/comments?k=${K}`);
	});
});

describe('DELETE /api/comments — maintainer', () => {
	it('no/wrong token or unset DIAG_READ_TOKEN → 401 and R2 untouched', async () => {
		for (const [headers, token] of [
			[{}, TOKEN],
			[bearer('wrong'), TOKEN],
			[bearer(), undefined]
		] as const) {
			const bucket = fakeBucket();
			seedThread(bucket, [item(ID_A, 1)]);
			const res = await callDELETE(fakeEvent('DELETE', { search: { k: K, id: ID_A }, headers, env: env(bucket, token) }));
			expect(res.status).toBe(401);
			expect(bucket.get).not.toHaveBeenCalled();
			expect(bucket.put).not.toHaveBeenCalled();
		}
	});

	it('bad key → 400 invalid-key; bad id → 400 invalid; no binding → 503', async () => {
		const bucket = fakeBucket();
		const a = await callDELETE(fakeEvent('DELETE', { search: { k: 'bad', id: ID_A }, headers: bearer(), env: env(bucket, TOKEN) }));
		expect(a.status).toBe(400);
		expect(await a.json()).toEqual({ ok: false, err: 'invalid-key' });
		const b = await callDELETE(fakeEvent('DELETE', { search: { k: K, id: 'x' }, headers: bearer(), env: env(bucket, TOKEN) }));
		expect(b.status).toBe(400);
		expect(await b.json()).toEqual({ ok: false, err: 'invalid' });
		const c = await callDELETE(
			fakeEvent('DELETE', { search: { k: K, id: ID_A }, headers: bearer(), env: { DIAG_READ_TOKEN: TOKEN } })
		);
		expect(c.status).toBe(503);
		expect(bucket.get).not.toHaveBeenCalled();
	});

	it('unknown id → 404; known id → removed under an etag-matched put, cache busted', async () => {
		const cache = stubCaches();
		const bucket = fakeBucket();
		seedThread(bucket, [item(ID_A, 1), item(ID_B, 2)]);
		const miss = await callDELETE(fakeEvent('DELETE', { search: { k: K, id: ID_H }, headers: bearer(), env: env(bucket, TOKEN) }));
		expect(miss.status).toBe(404);

		const res = await callDELETE(fakeEvent('DELETE', { search: { k: K, id: ID_A }, headers: bearer(), env: env(bucket, TOKEN) }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(storedItems(bucket).map((i) => i.id)).toEqual([ID_B]);
		expect(bucket.put.mock.calls[0][2]).toEqual({
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagMatches: 'seed' }
		});
		expect(cache.delete).toHaveBeenCalledTimes(1);
		expect(cache.delete.mock.calls[0][0].url).toBe(`https://openmusic.lol/api/comments?k=${K}`);
	});
});
