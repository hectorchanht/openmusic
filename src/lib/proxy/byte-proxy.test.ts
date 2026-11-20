import { describe, it, expect, vi } from 'vitest';
import {
	handleByteProxy,
	parseRangeHeader,
	isFullRange,
	resolveRange,
	type ByteProxyDeps
} from './byte-proxy';
import type { EdgeCache } from './edge-cache';

const SIGNED = 'https://car-er.kuwo.cn/deadbeef/6affbbbd/resource/M800002D6AwU0KgO4w.mp3';
const BODY = new TextEncoder().encode('0123456789ABCDEF'); // 16 bytes
const CACHE_KEY = 'https://openmusic.lol/__proxy_cache__/kuwo:493469900@320k';
const enc = new TextEncoder();

/** Map-backed EdgeCache fake (the ytmusic stream.test.ts idiom): put stores a clone so the
 *  caller's copy stays consumable; match returns a clone so reads never disturb the store. */
function fakeCache() {
	const store = new Map<string, Response>();
	const cache: EdgeCache = {
		match: async (req: Request) => store.get(req.url)?.clone(),
		put: async (req: Request, res: Response) => {
			store.set(req.url, res.clone());
		},
		delete: async (req: Request) => store.delete(req.url)
	};
	return { store, cache };
}

/** Upstream stub: honours a Range header with a proper 206 slice, else the full 200 body. */
function makeUpstream(body: Uint8Array = BODY) {
	return vi.fn(async (_url: unknown, init?: RequestInit) => {
		const range = (init?.headers as Record<string, string> | undefined)?.range;
		if (range) {
			const m = /^bytes=(\d+)-(\d*)$/.exec(range);
			if (m) {
				const start = Number(m[1]);
				const end = m[2] === '' ? body.length - 1 : Math.min(Number(m[2]), body.length - 1);
				const slice = body.slice(start, end + 1);
				return new Response(slice, {
					status: 206,
					headers: {
						'content-type': 'audio/mpeg',
						'content-range': `bytes ${start}-${end}/${body.length}`,
						'content-length': String(slice.length)
					}
				});
			}
		}
		return new Response(body, {
			status: 200,
			headers: { 'content-type': 'audio/mpeg', 'content-length': String(body.length) }
		});
	});
}

function makeDeps(over: Partial<ByteProxyDeps> = {}) {
	const waited: Promise<unknown>[] = [];
	const fc = fakeCache();
	const deps: ByteProxyDeps = {
		id: '493469900',
		level: '320k',
		cacheKey: CACHE_KEY,
		resolveUrl: vi.fn(async () => SIGNED),
		cache: fc.cache,
		fetchImpl: makeUpstream() as unknown as typeof fetch,
		waitUntil: (p) => {
			waited.push(p);
		},
		...over
	};
	return { deps, waited, store: fc.store };
}

const req = (range?: string) =>
	new Request(
		'https://openmusic.lol/api/kuwo/stream/493469900?level=320k',
		range ? { headers: { range } } : undefined
	);

describe('byte-proxy — range parsing', () => {
	it('parses open, bounded and suffix ranges; rejects multi/malformed', () => {
		expect(parseRangeHeader(null)).toBeNull();
		expect(parseRangeHeader('bytes=0-')).toEqual({ start: 0, end: null, suffix: null });
		expect(parseRangeHeader('bytes=2-5')).toEqual({ start: 2, end: 5, suffix: null });
		expect(parseRangeHeader('bytes=-4')).toEqual({ start: null, end: null, suffix: 4 });
		expect(parseRangeHeader('bytes=0-1,4-5')).toBeNull();
		expect(parseRangeHeader('bytes=5-2')).toBeNull();
		expect(parseRangeHeader('items=0-1')).toBeNull();
	});

	it('classifies only no-range and bytes=0- as full-object eligible', () => {
		expect(isFullRange(null)).toBe(true);
		expect(isFullRange(parseRangeHeader('bytes=0-'))).toBe(true);
		expect(isFullRange(parseRangeHeader('bytes=0-1'))).toBe(false);
		expect(isFullRange(parseRangeHeader('bytes=4-'))).toBe(false);
		expect(isFullRange(parseRangeHeader('bytes=-4'))).toBe(false);
	});

	it('resolves ranges against a length, clamping the end and rejecting the impossible', () => {
		expect(resolveRange({ start: 2, end: 5, suffix: null }, 16)).toEqual({ start: 2, end: 5 });
		expect(resolveRange({ start: 2, end: 99, suffix: null }, 16)).toEqual({ start: 2, end: 15 });
		expect(resolveRange({ start: null, end: null, suffix: 4 }, 16)).toEqual({ start: 12, end: 15 });
		expect(resolveRange({ start: 99, end: null, suffix: null }, 16)).toBeNull();
	});
});

describe('byte-proxy — MISS stream-tee + HIT serving', () => {
	it('a range-less MISS streams the full body, stores it, and the next request is a HIT with no upstream traffic', async () => {
		const { deps, waited } = makeDeps();
		const res1 = await handleByteProxy(req(), deps);
		expect(res1.status).toBe(200);
		expect(res1.headers.get('x-om-proxy')).toBe('MISS');
		expect(new Uint8Array(await res1.arrayBuffer())).toEqual(BODY);
		await Promise.all(waited); // tee'd cache branch lands

		const res2 = await handleByteProxy(req(), deps);
		expect(res2.status).toBe(200);
		expect(res2.headers.get('x-om-proxy')).toBe('HIT');
		expect(new Uint8Array(await res2.arrayBuffer())).toEqual(BODY);
		expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
		expect(deps.resolveUrl).toHaveBeenCalledTimes(1);
		expect(deps.resolveUrl).toHaveBeenCalledWith('493469900', '320k');
	});

	it('an open-ended bytes=0- attach takes the same full tee path (200, not a range pass-through)', async () => {
		const { deps } = makeDeps();
		const res = await handleByteProxy(req('bytes=0-'), deps);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-om-proxy')).toBe('MISS');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BODY);
	});

	it('STREAM-TEE: the first bytes reach the client while the upstream is still mid-body (no spike-style buffering)', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let upstreamFinished = false;
		const stream = new ReadableStream<Uint8Array>({
			async start(c) {
				c.enqueue(enc.encode('AAAA'));
				await gate; // upstream stalls here — a buffering proxy would starve the client
				c.enqueue(enc.encode('BBBB'));
				upstreamFinished = true;
				c.close();
			}
		});
		const fetchImpl = vi.fn(
			async () =>
				new Response(stream, {
					status: 200,
					headers: { 'content-type': 'audio/mpeg', 'content-length': '8' }
				})
		);
		const { deps, waited } = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
		const res = await handleByteProxy(req(), deps);
		expect(res.status).toBe(200);
		const reader = res.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe('AAAA');
		expect(upstreamFinished).toBe(false); // ← proof the client was NOT made to wait for the whole object
		release();
		let rest = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			rest += new TextDecoder().decode(value);
		}
		expect(rest).toBe('BBBB');
		await Promise.all(waited);
		// The tee'd branch stored the complete object despite the mid-body stall.
		const res2 = await handleByteProxy(req(), deps);
		expect(res2.headers.get('x-om-proxy')).toBe('HIT');
		expect(new TextDecoder().decode(await res2.arrayBuffer())).toBe('AAAABBBB');
	});
});

describe('byte-proxy — Range behaviour', () => {
	it('a HIT serves bounded + suffix ranges as exact 206 slices, and 416s the unsatisfiable', async () => {
		const { deps, waited } = makeDeps();
		await (await handleByteProxy(req(), deps)).arrayBuffer(); // prime the cache
		await Promise.all(waited);

		const bounded = await handleByteProxy(req('bytes=2-5'), deps);
		expect(bounded.status).toBe(206);
		expect(bounded.headers.get('content-range')).toBe('bytes 2-5/16');
		expect(bounded.headers.get('x-om-proxy')).toBe('HIT');
		expect(new TextDecoder().decode(await bounded.arrayBuffer())).toBe('2345');

		const suffix = await handleByteProxy(req('bytes=-4'), deps);
		expect(suffix.status).toBe(206);
		expect(suffix.headers.get('content-range')).toBe('bytes 12-15/16');
		expect(new TextDecoder().decode(await suffix.arrayBuffer())).toBe('CDEF');

		const impossible = await handleByteProxy(req('bytes=99-100'), deps);
		expect(impossible.status).toBe(416);
		expect(impossible.headers.get('content-range')).toBe('bytes */16');
	});

	it('a partial-range MISS forwards the Range upstream (206 PASS) and warms the cache in the background — the partial is never stored as the object', async () => {
		const upstream = makeUpstream();
		const { deps, waited, store } = makeDeps({ fetchImpl: upstream as unknown as typeof fetch });
		const res = await handleByteProxy(req('bytes=4-7'), deps);
		expect(res.status).toBe(206);
		expect(res.headers.get('x-om-proxy')).toBe('PASS');
		expect(res.headers.get('content-range')).toBe('bytes 4-7/16');
		expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('4567');
		// The upstream saw the client's exact Range on the partial fetch…
		expect(upstream.mock.calls[0][1]?.headers).toMatchObject({ range: 'bytes=4-7' });
		// …and a SECOND, range-less fetch (the background warm) filled the cache.
		await Promise.all(waited);
		expect(upstream).toHaveBeenCalledTimes(2);
		expect(store.has(CACHE_KEY)).toBe(true);
		const after = await handleByteProxy(req(), deps);
		expect(after.headers.get('x-om-proxy')).toBe('HIT');
		expect(new Uint8Array(await after.arrayBuffer())).toEqual(BODY); // full object, not the 4-byte partial
	});
});

describe('byte-proxy — failure + no-cache shapes', () => {
	it('a failed resolve answers 502 and never fetches', async () => {
		const fetchImpl = makeUpstream();
		const { deps } = makeDeps({
			resolveUrl: vi.fn(async () => null),
			fetchImpl: fetchImpl as unknown as typeof fetch
		});
		const res = await handleByteProxy(req(), deps);
		expect(res.status).toBe(502);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('an upstream failure answers 502', async () => {
		const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
		const { deps } = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
		const res = await handleByteProxy(req(), deps);
		expect(res.status).toBe(502);
	});

	it('with no cache available (dev runtime) a MISS still streams the full body', async () => {
		const { deps } = makeDeps({ cache: null });
		const res = await handleByteProxy(req(), deps);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-om-proxy')).toBe('MISS');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BODY);
	});
});
