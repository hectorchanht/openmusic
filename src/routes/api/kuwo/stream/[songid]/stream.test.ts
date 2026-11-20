import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import { fetchKuwoDetail } from '$lib/proxy/kuwo';

// The route must resolve through the EXISTING server seam — mock only that seam; the
// kuwo host gate (isAllowedKuwoAudioUrl) stays REAL so the no-open-relay tests bite.
vi.mock('$lib/proxy/kuwo', async (importOriginal) => {
	const orig = await importOriginal<typeof import('$lib/proxy/kuwo')>();
	return { ...orig, fetchKuwoDetail: vi.fn() };
});
const mockDetail = vi.mocked(fetchKuwoDetail);

const SIGNED = 'https://car-er.kuwo.cn/deadbeef/6affbbbd/resource/M800002D6AwU0KgO4w.mp3';
const BODY = new TextEncoder().encode('0123456789ABCDEF');

/** Map-backed `caches.default` fake + waitUntil capture (the ytmusic stream.test.ts idiom). */
function stubEdgeCache() {
	const store = new Map<string, Response>();
	const fake = {
		match: async (req: Request) => store.get(req.url)?.clone(),
		put: async (req: Request, res: Response) => {
			store.set(req.url, res.clone());
		},
		delete: async (req: Request) => store.delete(req.url)
	};
	vi.stubGlobal('caches', { default: fake });
	return store;
}

function ev(songid: string, qs = 'level=320k', range?: string) {
	const waited: Promise<unknown>[] = [];
	const url = new URL(`https://openmusic.lol/api/kuwo/stream/${songid}?${qs}`);
	const headers = new Headers();
	if (range) headers.set('range', range);
	const event = {
		params: { songid },
		url,
		request: new Request(url, { headers }),
		platform: { ctx: { waitUntil: (p: Promise<unknown>) => void waited.push(p) } }
	};
	return { event, waited };
}

/** Global fetch stub for the UPSTREAM bytes only (the resolver seam is mocked). Records
 *  every URL it was asked for so the open-relay test can prove the evil one never appears. */
function stubUpstream() {
	const urls: string[] = [];
	const spy = vi.fn(async (u: unknown) => {
		urls.push(String(u));
		return new Response(BODY, {
			status: 200,
			headers: { 'content-type': 'audio/mpeg', 'content-length': String(BODY.length) }
		});
	});
	vi.stubGlobal('fetch', spy);
	return { spy, urls };
}

beforeEach(() => {
	mockDetail.mockReset();
	mockDetail.mockResolvedValue({
		status: 200,
		body: { code: 200, data: { url: SIGNED, name: 'x', artist: 'y' } }
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GET /api/kuwo/stream/:songid — validation (no upstream work on bad input)', () => {
	it('400s a non-numeric songid without resolving', async () => {
		const { event } = ev('abc');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(400);
		expect(mockDetail).not.toHaveBeenCalled();
	});

	it('400s a missing or non-whitelisted level', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((await GET(ev('493469900', '').event as any)).status).toBe(400);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((await GET(ev('493469900', 'level=flac').event as any)).status).toBe(400);
		expect(mockDetail).not.toHaveBeenCalled();
	});
});

describe('GET /api/kuwo/stream/:songid — resolve-from-uid, never an open relay', () => {
	it('resolves the signed URL server-side from the uid and streams its bytes', async () => {
		stubEdgeCache();
		const { urls } = stubUpstream();
		const { event, waited } = ev('493469900');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-om-proxy')).toBe('MISS');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BODY);
		expect(mockDetail).toHaveBeenCalledWith('493469900', '320k');
		expect(urls).toEqual([SIGNED]);
		await Promise.all(waited);
	});

	it('IGNORES a url= parameter — the only upstream ever fetched is the resolver’s kuwo URL', async () => {
		stubEdgeCache();
		const { urls } = stubUpstream();
		const { event } = ev('493469900', 'level=320k&url=https://evil.example/steal.mp3');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(200);
		expect(urls).toEqual([SIGNED]);
		expect(urls.join(' ')).not.toContain('evil.example');
	});

	it('502s when the resolver yields a non-kuwo host (host gate stays shut)', async () => {
		stubUpstream();
		mockDetail.mockResolvedValue({
			status: 200,
			body: { code: 200, data: { url: 'https://evil.example/x.mp3' } }
		});
		const { event } = ev('493469900');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(502);
	});

	it('502s when the resolver itself fails', async () => {
		stubUpstream();
		mockDetail.mockResolvedValue({ status: 502, body: { code: 502, msg: 'no playable url' } });
		const { event } = ev('493469900');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET(event as any);
		expect(res.status).toBe(502);
	});

	it('a second fetch of the same uid|tier is a cache HIT with zero upstream traffic; a seek range slices it', async () => {
		const store = stubEdgeCache();
		const { spy } = stubUpstream();
		const first = ev('493469900');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await GET(first.event as any);
		expect(res1.headers.get('x-om-proxy')).toBe('MISS');
		await res1.arrayBuffer();
		await Promise.all(first.waited); // tee'd cache fill lands
		expect([...store.keys()].some((k) => k.includes('__proxy_cache__/kuwo:493469900@320k'))).toBe(true);

		spy.mockClear();
		mockDetail.mockClear();
		const second = ev('493469900');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await GET(second.event as any);
		expect(res2.headers.get('x-om-proxy')).toBe('HIT');
		expect(new Uint8Array(await res2.arrayBuffer())).toEqual(BODY);
		expect(spy).not.toHaveBeenCalled();
		expect(mockDetail).not.toHaveBeenCalled();

		const seek = ev('493469900', 'level=320k', 'bytes=4-7');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res3 = await GET(seek.event as any);
		expect(res3.status).toBe(206);
		expect(res3.headers.get('content-range')).toBe('bytes 4-7/16');
		expect(new TextDecoder().decode(await res3.arrayBuffer())).toBe('4567');
	});
});
