import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jooxProxy } from '$lib/proxy/joox';
import type { Env } from '$lib/proxy/proxy-types';
import { GET } from './[source]/[...path]/+server';
import { handle } from '../../hooks.server';

// The real JOOX token value (from legacy/index.html:2165) must NEVER appear in any
// client-facing artifact. Tests use a fake token so we can also assert the real value's
// absence from the upstream-vs-response boundary.
const FAKE_TOKEN = 'TESTTOKEN';
const REAL_TOKEN = 'f84ao9lMF_q7husBWRfgUw';

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('jooxProxy.buildUrl — token injection from platform.env (DATA-02 / criterion #2)', () => {
	const env: Env = { JOOX_TOKEN: FAKE_TOKEN };

	// Test 1: token + br injected into the upstream URL, sourced from env (not a constant).
	it('injects token from env + br into the JOOX search upstream URL', () => {
		const upstream = jooxProxy.buildUrl('search', new URLSearchParams({ msg: '周杰伦' }), env);
		expect(upstream).toContain('apicx.asia/api/joox_music');
		expect(upstream).toContain(`token=${FAKE_TOKEN}`);
		expect(upstream).toMatch(/[?&]br=4(&|$)/);
		expect(upstream).toContain(`msg=${encodeURIComponent('周杰伦')}`);
		// the real token value is NOT hardcoded into the build output
		expect(upstream).not.toContain(REAL_TOKEN);
	});

	it('injects token + n into the JOOX detail upstream URL', () => {
		const upstream = jooxProxy.buildUrl(
			'detail',
			new URLSearchParams({ msg: 'hello', n: '3' }),
			env
		);
		expect(upstream).toContain('apicx.asia/api/joox_music');
		expect(upstream).toContain(`token=${FAKE_TOKEN}`);
		expect(upstream).toMatch(/[?&]n=3(&|$)/);
		expect(upstream).toMatch(/[?&]br=4(&|$)/);
	});

	// Test 3: env-missing path throws a typed error — never emits token=undefined silently.
	it('THROWS a typed config error when env / JOOX_TOKEN is missing (no token=undefined)', () => {
		expect(() => jooxProxy.buildUrl('search', new URLSearchParams({ msg: 'x' }), undefined)).toThrow(
			/JOOX_TOKEN|config/i
		);
		expect(() =>
			jooxProxy.buildUrl('search', new URLSearchParams({ msg: 'x' }), {} as Env)
		).toThrow(/JOOX_TOKEN|config/i);

		// belt-and-suspenders: even if it somehow returned, it must not contain token=undefined
		let out = '';
		try {
			out = jooxProxy.buildUrl('search', new URLSearchParams({ msg: 'x' }), {} as Env);
		} catch {
			out = '';
		}
		expect(out).not.toContain('token=undefined');
	});
});

describe('/api/joox proxy route — token injected upstream, ABSENT from the client response (no-leak)', () => {
	function fakeEvent(source: string, path: string, search: Record<string, string>, env?: Env) {
		const url = new URL(`https://openmusic.lol/api/${source}/${path}`);
		for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
		return {
			params: { source, path },
			url,
			platform: env ? { env } : undefined,
			request: new Request(url, { headers: { origin: 'https://openmusic.lol' } })
		};
	}

	// Test 2 (no-leak): the upstream fetch is mocked; the upstream URL must carry the token,
	// but the Response body returned to the client must NOT contain the token.
	it('injects the token into the upstream fetch but never echoes it to the client body', async () => {
		let capturedUpstreamUrl = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				capturedUpstreamUrl = String(input);
				// upstream responds with a normal JSON body that does NOT contain the token
				return new Response(JSON.stringify({ code: 200, data: { songs: [] } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);

		const event = fakeEvent('joox', 'search', { msg: '周杰伦' }, { JOOX_TOKEN: FAKE_TOKEN });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		const body = await res.text();

		// upstream URL carries the injected token (server → upstream only)
		expect(capturedUpstreamUrl).toContain(`token=${FAKE_TOKEN}`);
		// the client-facing response body does NOT contain the token (no leak)
		expect(body).not.toContain(FAKE_TOKEN);
		expect(body).not.toContain(REAL_TOKEN);
		// and no response header leaks it either
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(FAKE_TOKEN);
		expect(headerBlob).not.toContain(REAL_TOKEN);
	});

	it('returns 400 (bad request) when JOOX_TOKEN is missing — never proxies token=undefined', async () => {
		const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchSpy);

		const event = fakeEvent('joox', 'search', { msg: 'x' }); // no platform.env
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(400);
		// the route must NOT have fetched an upstream with token=undefined
		const calledWithUndefinedToken = fetchSpy.mock.calls.some((c) =>
			String(c[0]).includes('token=undefined')
		);
		expect(calledWithUndefinedToken).toBe(false);
	});
});

describe('/api/[source]/[...path] — search edge cache (CONCERNS perf #1)', () => {
	const PRIME_ORIGIN = 'https://openmusic.lol';

	// A minimal event with a configurable request origin (defaults to the prime origin).
	function fakeEvent(
		source: string,
		path: string,
		search: Record<string, string>,
		origin: string = PRIME_ORIGIN,
		env?: Env
	) {
		const url = new URL(`https://openmusic.lol/api/${source}/${path}`);
		for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
		return {
			params: { source, path },
			url,
			platform: env ? { env } : undefined,
			request: new Request(url, { headers: { origin } })
		};
	}

	// In-memory Map-backed fake Cache API. A Response body is single-use, so store the
	// buffered text + content-type and reconstruct a fresh Response on each match().
	function makeFakeCache() {
		const store = new Map<string, { text: string; contentType: string }>();
		const put = vi.fn(async (req: Request, res: Response) => {
			store.set(req.url, {
				text: await res.text(),
				contentType: res.headers.get('content-type') ?? 'application/json'
			});
		});
		const match = vi.fn(async (req: Request): Promise<Response | undefined> => {
			const entry = store.get(req.url);
			if (!entry) return undefined;
			return new Response(entry.text, { headers: { 'content-type': entry.contentType } });
		});
		return { store, put, match, default: { match, put } };
	}

	function okFetch(payload: unknown = { data: [{ id: 1 }] }) {
		return vi.fn(async () =>
			new Response(JSON.stringify(payload), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
	}

	afterEach(() => {
		// restoreAllMocks does NOT auto-reset vi.stubGlobal — unstub explicitly per test.
		vi.unstubAllGlobals();
	});

	it('caches a 200 search result — a second identical call is served from cache (no re-fetch)', async () => {
		const fetchSpy = okFetch();
		const cache = makeFakeCache();
		vi.stubGlobal('fetch', fetchSpy);
		vi.stubGlobal('caches', cache);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(fakeEvent('netease', 'search', { keywords: '周杰伦' }) as any);
		const body1 = await res1.text();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(fakeEvent('netease', 'search', { keywords: '周杰伦' }) as any);
		const body2 = await res2.text();

		expect(fetchSpy).toHaveBeenCalledTimes(1); // upstream hit only once
		expect(cache.put).toHaveBeenCalledTimes(1); // written once
		expect(body2).toBe(body1); // same body served from cache
		expect(res2.status).toBe(200);
		expect(res2.headers.get('cache-control')).toBe('public, max-age=300');
	});

	it('NEVER caches url/detail/lrc — each call streams from upstream (no cache put)', async () => {
		const fetchSpy = okFetch();
		const cache = makeFakeCache();
		vi.stubGlobal('fetch', fetchSpy);
		vi.stubGlobal('caches', cache);

		// netease url twice
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(fakeEvent('netease', 'url', { id: '1' }) as any);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(fakeEvent('netease', 'url', { id: '1' }) as any);
		// joox detail once
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(fakeEvent('joox', 'detail', { msg: 'x' }, PRIME_ORIGIN, { JOOX_TOKEN: 'TESTTOKEN' }) as any);

		expect(cache.put).not.toHaveBeenCalled(); // never cached
		expect(cache.match).not.toHaveBeenCalled(); // never even read the cache for non-search
		expect(fetchSpy).toHaveBeenCalledTimes(3); // every call hits upstream (no cache)
		// non-search responses carry NO Cache-Control header (byte-identical to today)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(fakeEvent('netease', 'url', { id: '2' }) as any);
		expect(res.headers.get('cache-control')).toBeNull();
	});

	it('does NOT cache a non-200 search response — the next identical call re-fetches upstream', async () => {
		const fetchSpy = vi.fn(async () =>
			new Response('upstream boom', { status: 500, headers: { 'content-type': 'text/plain' } })
		);
		const cache = makeFakeCache();
		vi.stubGlobal('fetch', fetchSpy);
		vi.stubGlobal('caches', cache);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(fakeEvent('kuwo', 'search', { key: 'x' }) as any);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET(fakeEvent('kuwo', 'search', { key: 'x' }) as any);

		expect(res1.status).toBe(500);
		expect(cache.put).not.toHaveBeenCalled(); // transient error never frozen
		// fetchWithRetry retries 500 (retries=2 → up to 3 per call); assert re-fetch across calls.
		expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('re-applies CORS for the REQUESTING origin on a cache hit (never a prior requester, never *)', async () => {
		const fetchSpy = okFetch();
		const cache = makeFakeCache();
		vi.stubGlobal('fetch', fetchSpy);
		vi.stubGlobal('caches', cache);

		// Prime from the prod origin.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const primed = await GET(fakeEvent('qq', 'search', { w: 'x' }, PRIME_ORIGIN) as any);
		expect(primed.headers.get('access-control-allow-origin')).toBe(PRIME_ORIGIN);

		// HIT served to a DIFFERENT allowed origin.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const hit = await GET(fakeEvent('qq', 'search', { w: 'x' }, 'https://localhost') as any);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // served from cache
		expect(hit.headers.get('access-control-allow-origin')).toBe('https://localhost');
		expect(hit.headers.get('access-control-allow-origin')).not.toBe(PRIME_ORIGIN);
		expect(hit.headers.get('access-control-allow-origin')).not.toBe('*');
	});

	it('dev fallback: with caches undefined, a search call still returns the live upstream body (no crash)', async () => {
		const fetchSpy = okFetch({ data: [{ id: 42 }] });
		vi.stubGlobal('fetch', fetchSpy);
		vi.stubGlobal('caches', undefined);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(fakeEvent('netease', 'search', { keywords: 'x' }) as any);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe(JSON.stringify({ data: [{ id: 42 }] }));
	});
});

describe('hooks.server handle() — single CORS seam for all /api/* (D-02)', () => {
	// Synthetic RequestEvent + a resolve() stub returning a plain Response, exercising the
	// hook in isolation (the real route logic is irrelevant to the CORS contract).
	function hookEvent(method: string, pathname: string, origin: string | null) {
		const url = new URL(`https://openmusic.lol${pathname}`);
		const headers = new Headers();
		if (origin) headers.set('origin', origin);
		return {
			url,
			request: new Request(url, { method, headers })
		};
	}
	const resolveStub = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

	beforeEach(() => resolveStub.mockClear());

	it('echoes Access-Control-Allow-Origin for an allowlisted origin on a GET /api/* (incl. https://localhost — Capacitor)', async () => {
		const event = hookEvent('GET', '/api/translate', 'https://localhost');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await handle({ event, resolve: resolveStub } as any);
		expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
		expect(res.headers.get('vary')).toContain('Origin');
		expect(resolveStub).toHaveBeenCalledTimes(1); // non-OPTIONS resolves the route
	});

	it('OMITS Access-Control-Allow-Origin for an unknown origin on /api/*', async () => {
		const event = hookEvent('GET', '/api/translate', 'https://evil.example');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await handle({ event, resolve: resolveStub } as any);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('vary')).toContain('Origin');
	});

	it('allows a POST preflight for /api/translate from https://localhost (Capacitor native — CR-01)', async () => {
		const event = hookEvent('OPTIONS', '/api/translate', 'https://localhost');
		const headers = new Headers(event.request.headers);
		headers.set('access-control-request-method', 'POST');
		headers.set('access-control-request-headers', 'content-type');
		const reqEvent = {
			url: event.url,
			request: new Request(event.url, { method: 'OPTIONS', headers })
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await handle({ event: reqEvent, resolve: resolveStub } as any);
		expect(res.status).toBe(204);
		const allowMethods = res.headers.get('access-control-allow-methods') ?? '';
		expect(allowMethods).toContain('POST');
		expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
		expect(resolveStub).not.toHaveBeenCalled();
	});

	it('answers OPTIONS preflight on /api/* with 204 WITHOUT resolving downstream', async () => {
		const event = hookEvent('OPTIONS', '/api/joox/search', 'https://localhost');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await handle({ event, resolve: resolveStub } as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
		expect(resolveStub).not.toHaveBeenCalled(); // workerd: OPTIONS must not fall through
	});

	it('NEVER emits Access-Control-Allow-Origin: * (open-relay forbidden — T-999.1-01)', async () => {
		for (const origin of ['https://localhost', 'https://evil.example', null]) {
			const event = hookEvent('GET', '/api/translate', origin);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res = await handle({ event, resolve: resolveStub } as any);
			expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
		}
	});

	it('passes non-/api/* paths through untouched (no CORS headers added)', async () => {
		const event = hookEvent('GET', '/search', 'https://localhost');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await handle({ event, resolve: resolveStub } as any);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(resolveStub).toHaveBeenCalledTimes(1);
	});
});
