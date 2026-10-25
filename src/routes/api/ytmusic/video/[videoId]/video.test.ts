import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as videoGet } from './+server';
import { PLAYER_URL, SEARCH_URL } from '$lib/proxy/ytmusic';

// quick-261024-vid1 — the video byte-proxy: same gated resolve as audio, avc-only pick,
// per-cap URL cache. Stubs mirror stream.test.ts (fetch routed by URL; Map-backed cache).

const ORIGIN = 'https://openmusic.lol';
const BODY = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);

const AVC = 'video/mp4; codecs="avc1.640028"';
const VP9 = 'video/webm; codecs="vp9"';
const fmt = (itag: number, height: number, mimeType = AVC) => ({
	itag,
	height,
	width: height * 2,
	mimeType,
	bitrate: height * 1000,
	url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}`
});
const OK_PLAYER = {
	playabilityStatus: { status: 'OK' },
	streamingData: {
		adaptiveFormats: [
			fmt(137, 1080),
			fmt(136, 720),
			fmt(134, 360),
			fmt(140, 0, 'audio/mp4; codecs="mp4a.40.2"'),
			fmt(248, 1080, VP9)
		]
	}
};
const VP9_ONLY_PLAYER = {
	playabilityStatus: { status: 'OK' },
	streamingData: { adaptiveFormats: [fmt(248, 1080, VP9), fmt(247, 720, VP9)] }
};
const GATED_PLAYER = {
	playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" }
};

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ev(videoId: string, opts: { range?: string; q?: string } = {}) {
	const url = new URL(`https://openmusic.lol/api/ytmusic/video/${encodeURIComponent(videoId)}`);
	if (opts.q) url.searchParams.set('q', opts.q);
	const headers = new Headers({ origin: ORIGIN });
	if (opts.range) headers.set('range', opts.range);
	return { params: { videoId }, url, request: new Request(url, { headers }) };
}

function stubFetch(players: unknown[]) {
	let playerIdx = 0;
	const urls: string[] = [];
	let mediaUrl: string | null = null;
	const spy = vi.fn(async (u: unknown, init?: RequestInit) => {
		const url = String(u);
		urls.push(url);
		if (url === SEARCH_URL) return jsonRes({ responseContext: { visitorData: 'VD-' + playerIdx } });
		if (url === PLAYER_URL) {
			const body = players[Math.min(playerIdx, players.length - 1)];
			playerIdx++;
			return jsonRes(body);
		}
		if (url.includes('googlevideo.com')) {
			mediaUrl = url;
			const h = new Headers((init?.headers ?? {}) as HeadersInit);
			if (h.has('range')) {
				return new Response(BODY, {
					status: 206,
					headers: {
						'content-type': 'video/mp4',
						'accept-ranges': 'bytes',
						'content-range': `bytes 0-${BODY.byteLength - 1}/4000000`,
						'content-length': String(BODY.byteLength)
					}
				});
			}
			return new Response(BODY, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(BODY.byteLength) } });
		}
		throw new Error('unexpected fetch url: ' + url);
	});
	vi.stubGlobal('fetch', spy);
	return { spy, urls, playerCalls: () => playerIdx, mediaUrl: () => mediaUrl };
}

function stubEdgeCache() {
	const store = new Map<string, Response>();
	const fake = {
		match: async (req: Request) => store.get(req.url)?.clone(),
		put: async (req: Request, res: Response) => void store.set(req.url, res.clone()),
		delete: async (req: Request) => store.delete(req.url)
	};
	vi.stubGlobal('caches', { default: fake });
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/ytmusic/video/:videoId (quick-261024-vid1)', () => {
	it('a ranged request proxies the 720p avc pick with pick headers and arms the URL cache', async () => {
		const store = stubEdgeCache();
		const h = stubFetch([OK_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await videoGet(ev('vid123', { range: 'bytes=0-1023' }) as any);
		expect(res.status).toBe(206);
		expect(res.headers.get('content-type')).toBe('video/mp4');
		expect(res.headers.get('x-ytmusic-video-height')).toBe('720');
		expect(res.headers.get('x-ytmusic-video-mime')).toContain('avc1');
		expect(h.mediaUrl()).toContain('itag=136');
		expect([...store.keys()].some((k) => k.includes('__ytmusic__/video-url/vid123@720'))).toBe(true);
	});

	it('a warm URL cache serves the next play with NO player call', async () => {
		stubEdgeCache();
		stubFetch([OK_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await videoGet(ev('vid123', { range: 'bytes=0-1023' }) as any);
		const h2 = stubFetch([OK_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await videoGet(ev('vid123', { range: 'bytes=0-1023' }) as any);
		expect(res.status).toBe(206);
		expect(res.headers.get('x-ytmusic-urlcache')).toBe('hit');
		expect(h2.playerCalls()).toBe(0);
	});

	it('?q=360 caps the pick at the 360p rung', async () => {
		stubEdgeCache();
		const h = stubFetch([OK_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await videoGet(ev('vid123', { range: 'bytes=0-1023', q: '360' }) as any);
		expect(res.status).toBe(206);
		expect(res.headers.get('x-ytmusic-video-height')).toBe('360');
		expect(h.mediaUrl()).toContain('itag=134');
	});

	it('a vp9-only response is a 404 (no watchable picture), not a 503', async () => {
		stubFetch([VP9_ONLY_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await videoGet(ev('vid123', { range: 'bytes=0-1023' }) as any);
		expect(res.status).toBe(404);
		expect(res.headers.get('x-ytmusic-video')).toBe('none');
	});

	it('a persistent gate is a 503 carrying the playability diagnostics', async () => {
		stubFetch([GATED_PLAYER]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await videoGet(ev('vid123', { range: 'bytes=0-1023' }) as any);
		expect(res.status).toBe(503);
		expect(res.headers.get('x-ytmusic-playability')).toBe('LOGIN_REQUIRED');
	});
});
