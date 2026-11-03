import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GET as streamGet, OPTIONS as streamOptions } from './+server';
// selectAudioFormat + isPlayable moved to the shared proxy module (SvelteKit +server.ts forbids
// non-HTTP-verb exports — quick-270715).
import {
	selectAudioFormat,
	selectVideoFormat,
	extractCaptionTracks,
	pickCaptionTrack,
	captionsToLrc,
	extractDescription,
	isPlayable,
	playabilityInfo,
	PLAYER_URL,
	SEARCH_URL,
	PLAYER_CLIENT_VERSION,
	PLAYER_UA
} from '$lib/proxy/ytmusic';
import fixture from './__fixtures__/player-response.json';

// The itag-140 (AAC-LC / mp4) direct url and the itag-251 (Opus/webm) url from the OK fixture.
const OK = fixture.ok;
const ITAG_140_URL = OK.streamingData.adaptiveFormats.find((f) => f.itag === 140)!.url!;
const ITAG_251_URL = OK.streamingData.adaptiveFormats.find((f) => f.itag === 251)!.url!;
const ITAG_139_URL = fixture.fallbackNoAac140.streamingData.adaptiveFormats.find(
	(f) => f.itag === 139
)!.url!;

// ─── Task 1: pure selection + playability gate ──────────────────────────────────────────────

describe('selectAudioFormat — itag-140 AAC selection (never Opus, never ciphered)', () => {
	it('returns the itag-140 (AAC/mp4) direct url for an OK player response', () => {
		expect(selectAudioFormat(OK)).toBe(ITAG_140_URL);
	});

	it('never returns the itag-251 (Opus/webm) url — iOS Safari <audio> cannot play it', () => {
		const chosen = selectAudioFormat(OK);
		expect(chosen).not.toBe(ITAG_251_URL);
		expect(chosen).toBe(ITAG_140_URL);
	});

	it('falls back to the highest-bitrate audio/mp4 direct url when itag 140 is absent', () => {
		// fallbackNoAac140 has an Opus itag-251 (higher bitrate, wrong container) + an mp4 itag-139.
		// The Opus format must be skipped; the mp4 fallback (itag 139) is chosen.
		expect(selectAudioFormat(fixture.fallbackNoAac140)).toBe(ITAG_139_URL);
	});

	it('returns null for a ciphered-only format (no direct url to proxy)', () => {
		expect(selectAudioFormat(fixture.cipheredOnly)).toBeNull();
	});

	it('returns null for a LOGIN_REQUIRED response (no streamable formats)', () => {
		expect(selectAudioFormat(fixture.loginRequired)).toBeNull();
	});

	it('returns null for a null / malformed body', () => {
		expect(selectAudioFormat(null)).toBeNull();
		expect(selectAudioFormat({})).toBeNull();
	});
});

describe('selectVideoFormat — avc/mp4 ≤720p pick for the MSE video layer (quick-261024-vid1)', () => {
	const vf = (itag: number, height: number, mime: string, extra: Record<string, unknown> = {}) => ({
		itag,
		height,
		width: Math.round(height * 1.78),
		mimeType: mime,
		bitrate: height * 1500,
		url: `https://googlevideo.example/v${itag}`,
		...extra
	});
	const AVC = 'video/mp4; codecs="avc1.640028"';
	const VP9 = 'video/webm; codecs="vp9"';
	const wrap = (adaptiveFormats: unknown[]) => ({ streamingData: { adaptiveFormats } });

	it('prefers the highest avc rung at or below 720p (720 over 360, capped below 1080)', () => {
		const pick = selectVideoFormat(wrap([vf(134, 360, AVC), vf(136, 720, AVC), vf(137, 1080, AVC)]));
		expect(pick?.itag).toBe(136);
		expect(pick?.height).toBe(720);
		expect(pick?.mimeType).toBe(AVC); // the client needs the codec string for its SourceBuffer
	});

	it('never picks vp9/webm, even at a better rung (Safari MSE)', () => {
		const pick = selectVideoFormat(wrap([vf(247, 720, VP9), vf(134, 360, AVC)]));
		expect(pick?.itag).toBe(134);
	});

	it('skips a ciphered format (no direct url) and uses the next rung', () => {
		const ciphered = vf(136, 720, AVC, { url: undefined, signatureCipher: 's=xyz' });
		const pick = selectVideoFormat(wrap([ciphered, vf(134, 360, AVC)]));
		expect(pick?.itag).toBe(134);
	});

	it('falls back to the smallest avc rung when every rung is above 720p', () => {
		const pick = selectVideoFormat(wrap([vf(137, 1080, AVC), vf(299, 1080, AVC, { bitrate: 4000000 })]));
		expect(pick?.height).toBe(1080);
	});

	it('returns null when only audio or only vp9 formats exist', () => {
		expect(selectVideoFormat(wrap([vf(140, 0, 'audio/mp4; codecs="mp4a.40.2"')]))).toBeNull();
		expect(selectVideoFormat(wrap([vf(248, 1080, VP9)]))).toBeNull();
		expect(selectVideoFormat(null)).toBeNull();
	});
});

describe('lyrics fallback helpers — captions + description (quick-261024-lyr)', () => {
	const TT = 'https://www.youtube.com/api/timedtext?v=x&lang=';
	const track = (languageCode: string, kind?: string) => ({ baseUrl: TT + languageCode, languageCode, kind });

	it('extractCaptionTracks keeps only real timedtext URLs', () => {
		const json = {
			captions: {
				playerCaptionsTracklistRenderer: {
					captionTracks: [track('zh-HK'), { baseUrl: 'https://evil.example/x', languageCode: 'en' }, { languageCode: 'en' }]
				}
			}
		};
		expect(extractCaptionTracks(json)).toHaveLength(1);
		expect(extractCaptionTracks(null)).toEqual([]);
	});

	it('pickCaptionTrack: human beats ASR; zh-Hant/HK beats zh-Hans beats en', () => {
		const tracks = [track('zh-Hans', 'asr'), track('en'), track('zh-HK')];
		expect(pickCaptionTrack(tracks)?.languageCode).toBe('zh-HK');
		expect(pickCaptionTrack([track('zh-Hans', 'asr'), track('en', 'asr')])?.languageCode).toBe('zh-Hans');
		expect(pickCaptionTrack([track('fr'), track('en')])?.languageCode).toBe('en');
		expect(pickCaptionTrack([])).toBeNull();
	});

	it('captionsToLrc stamps lines, drops blanks/window events and consecutive ASR duplicates', () => {
		const json3 = {
			events: [
				{ tStartMs: 0 },
				{ tStartMs: 1050, segs: [{ utf8: '第一句' }] },
				{ tStartMs: 3000, segs: [{ utf8: '第一句' }] },
				{ tStartMs: 3200, segs: [{ utf8: '  ' }] },
				{ tStartMs: 61000, segs: [{ utf8: '第二' }, { utf8: '句\n接住' }] },
				{ tStartMs: 65000, segs: [{ utf8: '第三句' }] },
				{ tStartMs: 70000, segs: [{ utf8: '第四句' }] }
			]
		};
		const lrc = captionsToLrc(json3);
		expect(lrc).toContain('[00:01.05]第一句');
		expect(lrc).toContain('[01:01.00]第二句 接住');
		expect(lrc?.split('\n')).toHaveLength(4);
	});

	it('captionsToLrc returns null below 4 usable lines', () => {
		expect(captionsToLrc({ events: [{ tStartMs: 0, segs: [{ utf8: 'only' }] }] })).toBeNull();
		expect(captionsToLrc(null)).toBeNull();
	});

	it('extractDescription trims and tolerates absence', () => {
		expect(extractDescription({ videoDetails: { shortDescription: '  abc  ' } })).toBe('abc');
		expect(extractDescription({})).toBe('');
	});
});

describe('playabilityInfo — diagnostics extraction + header sanitization (quick-261024-ytg)', () => {
	it('returns status + reason for a gated response', () => {
		expect(playabilityInfo(fixture.loginRequired).status).toBe('LOGIN_REQUIRED');
		// The fixture reason carries a curly apostrophe — non-ASCII is flattened for header safety.
		expect(playabilityInfo(fixture.loginRequired).reason).toBe('Sign in to confirm you?re not a bot');
	});

	it('returns nulls for an OK-without-reason / malformed body', () => {
		expect(playabilityInfo(OK)).toEqual({ status: 'OK', reason: null });
		expect(playabilityInfo(null)).toEqual({ status: null, reason: null });
		expect(playabilityInfo({})).toEqual({ status: null, reason: null });
	});

	it('a reason can never smuggle a second header (CR/LF flattened, length capped)', () => {
		const evil = { playabilityStatus: { status: 'ERROR', reason: 'x\r\nSet-Cookie: pwned' + 'y'.repeat(300) } };
		const info = playabilityInfo(evil);
		expect(info.reason).not.toContain('\r');
		expect(info.reason).not.toContain('\n');
		expect(info.reason!.length).toBe(120);
	});
});

describe('isPlayable — playabilityStatus gate', () => {
	it('is true only when playabilityStatus.status === "OK"', () => {
		expect(isPlayable(OK)).toBe(true);
	});

	it('is false for LOGIN_REQUIRED (bot gate)', () => {
		expect(isPlayable(fixture.loginRequired)).toBe(false);
	});

	it('is false for a null / malformed body', () => {
		expect(isPlayable(null)).toBe(false);
		expect(isPlayable({})).toBe(false);
	});
});

// ─── Task 2: the byte-proxy route (VISIONOS player → googlevideo relay) ────────────────────

const ORIGIN = 'https://openmusic.lol';
const FULL_BODY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // stand-in AAC file for the download path
const PARTIAL_BODY = new Uint8Array([1, 2, 3, 4]); // stand-in 206 partial content

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

// Minimal RequestEvent stub — the route reads params.videoId + request headers (range/origin).
function ev(videoId: string, opts: { range?: string; origin?: string | null } = {}) {
	const origin = opts.origin === undefined ? ORIGIN : opts.origin;
	const url = new URL(`https://openmusic.lol/api/ytmusic/stream/${encodeURIComponent(videoId)}`);
	const headers = new Headers();
	if (origin) headers.set('origin', origin);
	if (opts.range) headers.set('range', opts.range);
	return { params: { videoId }, url, request: new Request(url, { headers }) };
}

/**
 * Stub global fetch and route by URL: SEARCH_URL (visitorData grab) → a token envelope; PLAYER_URL →
 * the next scripted player response; a googlevideo url → a 206 (when Range forwarded) or a 200 full
 * body. Records the fetched URLs + the media request init so the test can assert Range passthrough
 * and that ONLY the adaptiveFormats url is fetched (no open relay).
 */
function stubFetch(players: unknown[], opts: { media403s?: number } = {}) {
	let playerIdx = 0;
	let media403s = opts.media403s ?? 0;
	const urls: string[] = [];
	let mediaUrl: string | null = null;
	let mediaInit: RequestInit | undefined;

	const spy = vi.fn(async (u: unknown, init?: RequestInit) => {
		const url = String(u);
		urls.push(url);
		if (url === SEARCH_URL) {
			return jsonRes({ responseContext: { visitorData: 'VD-' + playerIdx + '-' + urls.length } });
		}
		if (url === PLAYER_URL) {
			const body = players[Math.min(playerIdx, players.length - 1)];
			playerIdx++;
			return jsonRes(body);
		}
		if (url.includes('googlevideo.com')) {
			mediaUrl = url;
			mediaInit = init;
			if (media403s > 0) {
				media403s--;
				// The edge IP-lock refusal: gzip text with a content-length that would not match the body.
				return new Response('Forbidden', {
					status: 403,
					headers: { 'content-type': 'text/plain', 'content-length': '999' }
				});
			}
			const h = new Headers((init?.headers ?? {}) as HeadersInit);
			if (h.get('range') === 'bytes=0-') {
				return new Response(FULL_BODY, {
					status: 206,
					headers: {
						'content-type': 'application/octet-stream',
						'accept-ranges': 'bytes',
						'content-range': `bytes 0-${FULL_BODY.byteLength - 1}/${FULL_BODY.byteLength}`,
						'content-length': String(FULL_BODY.byteLength)
					}
				});
			}
			if (h.has('range')) {
				return new Response(PARTIAL_BODY, {
					status: 206,
					headers: {
						'content-type': 'application/octet-stream', // route must OVERRIDE to audio/mp4
						'accept-ranges': 'bytes',
						'content-range': 'bytes 0-3/4218164',
						'content-length': String(PARTIAL_BODY.byteLength)
					}
				});
			}
			return new Response(FULL_BODY, {
				status: 200,
				headers: {
					'content-type': 'application/octet-stream',
					'accept-ranges': 'bytes',
					'content-length': String(FULL_BODY.byteLength)
				}
			});
		}
		throw new Error('unexpected fetch url: ' + url);
	});

	vi.stubGlobal('fetch', spy);
	return {
		spy,
		urls,
		playerCalls: () => playerIdx,
		mediaUrl: () => mediaUrl,
		mediaRangeHeader: () => new Headers((mediaInit?.headers ?? {}) as HeadersInit).get('range')
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** quick-261024-ytc — a Map-backed `caches.default` fake + an event whose platform.ctx.waitUntil
 *  CAPTURES its promises so the test can await the background cache fill. */
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

function evp(videoId: string, opts: { range?: string } = {}) {
	const waited: Promise<unknown>[] = [];
	const base = ev(videoId, opts);
	const event = {
		...base,
		platform: { ctx: { waitUntil: (p: Promise<unknown>) => void waited.push(p) } }
	};
	return { event, waited };
}

describe('GET /api/ytmusic/stream/:videoId — full-audio edge cache (quick-261024-ytc)', () => {
	it('a full-coverage play stores the audio; later range + range-less requests are cache hits with NO upstream fetch', async () => {
		const store = stubEdgeCache();
		const h = stubFetch([OK]);
		// First play: <audio>'s opening `bytes=0-` — the stub answers a FULL-coverage 206.
		const first = evp('vid123', { range: 'bytes=0-' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await streamGet(first.event as any);
		expect(res1.status).toBe(206);
		expect(new Uint8Array(await res1.arrayBuffer())).toEqual(FULL_BODY); // tee'd serve branch intact
		await Promise.all(first.waited); // background fill lands
		expect([...store.keys()].some((k) => k.includes('__ytmusic__/audio/vid123'))).toBe(true);

		// Second request — a mid-song seek. A FRESH fetch stub proves zero upstream traffic.
		const h2 = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await streamGet(ev('vid123', { range: 'bytes=2-5' }) as any);
		expect(res2.status).toBe(206);
		expect(res2.headers.get('x-ytmusic-cache')).toBe('hit');
		expect(res2.headers.get('content-range')).toBe('bytes 2-5/8');
		expect(new Uint8Array(await res2.arrayBuffer())).toEqual(FULL_BODY.slice(2, 6));
		expect(h2.spy).not.toHaveBeenCalled();

		// Range-less (download shape) — also a hit, answered 200 with the whole body.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res3 = await streamGet(ev('vid123') as any);
		expect(res3.status).toBe(200);
		expect(res3.headers.get('x-ytmusic-cache')).toBe('hit');
		expect(new Uint8Array(await res3.arrayBuffer())).toEqual(FULL_BODY);
		expect(h.spy.mock.calls.length).toBeGreaterThan(0); // sanity: the FIRST flow did go upstream
	});

	it('a PARTIAL range success never populates the cache (no truncated entry can poison later plays)', async () => {
		const store = stubEdgeCache();
		stubFetch([OK]);
		const { event, waited } = evp('vid123', { range: 'bytes=0-3' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(event as any);
		expect(res.status).toBe(206);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PARTIAL_BODY);
		expect(waited).toHaveLength(0); // waitUntil never even scheduled
		expect([...store.keys()].some((k) => k.includes('__ytmusic__/audio'))).toBe(false);
	});

	it('an unparseable range on a warm cache falls through to the live flow instead of guessing', async () => {
		stubEdgeCache();
		const h = stubFetch([OK]);
		const first = evp('vid123', { range: 'bytes=0-' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await streamGet(first.event as any);
		await Promise.all(first.waited);
		// Multi-range is not provable from a flat buffer slice — the live flow must answer it
		// (its stub answers any non-`bytes=0-` range with the partial body).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123', { range: 'bytes=0-1,4-5' }) as any);
		expect(res.headers.get('x-ytmusic-cache')).toBeNull();
		expect(h.playerCalls()).toBeGreaterThan(1); // went upstream again
	});
});

describe('GET /api/ytmusic/stream/:videoId — resolved-URL edge cache (quick-261024-ytu)', () => {
	it('a partial first play still arms the URL cache; the next play skips the player entirely', async () => {
		const store = stubEdgeCache();
		stubFetch([OK]);
		// A partial range play never fills the AUDIO cache (ytc posture) — but it resolves a
		// URL, and that URL is exactly what the next invocation needs to dodge the gate.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res1 = await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any);
		expect(res1.status).toBe(206);
		expect([...store.keys()].some((k) => k.includes('__ytmusic__/url/vid123'))).toBe(true);
		expect([...store.keys()].some((k) => k.includes('__ytmusic__/audio'))).toBe(false);

		const h2 = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any);
		expect(res2.status).toBe(206);
		expect(res2.headers.get('x-ytmusic-urlcache')).toBe('hit');
		expect(h2.playerCalls()).toBe(0); // NO player call — the gate was never faced
		expect(new Uint8Array(await res2.arrayBuffer())).toEqual(PARTIAL_BODY);
	});

	it('a dead cached URL (media non-OK) is invalidated and the live player flow answers', async () => {
		stubEdgeCache();
		stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any); // arms the URL cache

		// The fast path's media fetch 403s (IP-lock drift); the route must NOT serve the
		// error — it drops the entry and runs the full player → bytes flow instead.
		const h2 = stubFetch([OK], { media403s: 1 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any);
		expect(res.status).toBe(206);
		expect(res.headers.get('x-ytmusic-urlcache')).toBeNull();
		expect(h2.playerCalls()).toBe(1); // fell through to a fresh resolve
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PARTIAL_BODY);
	});
});

describe('GET /api/ytmusic/stream/:videoId — VISIONOS player → googlevideo byte-proxy', () => {
	it('a ranged request forwards Range upstream and returns 206 with range headers + audio/mp4', async () => {
		const h = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any);

		expect(res.status).toBe(206);
		expect(res.headers.get('content-type')).toBe('audio/mp4');
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('content-range')).toBe('bytes 0-3/4218164');
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		// Range was forwarded to googlevideo, and ONLY the adaptiveFormats itag-140 url was fetched.
		expect(h.mediaRangeHeader()).toBe('bytes=0-3');
		expect(h.mediaUrl()).toBe(ITAG_140_URL);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PARTIAL_BODY);
	});

	it('a non-ranged GET asks upstream for bytes=0- and answers 200 with the full body (download path)', async () => {
		const h = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('audio/mp4');
		// googlevideo throttles a range-less GET to a trickle; bytes=0- is served at full speed.
		expect(h.mediaRangeHeader()).toBe('bytes=0-');
		expect(res.headers.get('content-range')).toBeNull(); // a whole-file answer, not a partial
		expect(h.mediaUrl()).toBe(ITAG_140_URL);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FULL_BODY);
	});

	it('a googlevideo 403 (edge IP-lock) re-calls the player for a fresh url and streams', async () => {
		const h = stubFetch([OK], { media403s: 1 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123', { range: 'bytes=0-3' }) as any);

		expect(res.status).toBe(206);
		expect(h.playerCalls()).toBe(2);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PARTIAL_BODY);
	});

	it('a persistent 403 gives up after 3 urls with an EMPTY body + our headers (no upstream length relayed)', async () => {
		const h = stubFetch([OK], { media403s: 99 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123', { range: 'bytes=0-' }) as any);

		expect(res.status).toBe(403);
		expect(h.playerCalls()).toBe(3);
		expect(res.headers.get('content-length')).toBeNull();
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		expect((await res.arrayBuffer()).byteLength).toBe(0);
	});

	it('a first-call LOGIN_REQUIRED races BOTH fresh-token retries in parallel, then streams (quick-261024-ytr)', async () => {
		const h = stubFetch([fixture.loginRequired, OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(200);
		// ytr: once the cached-token call is gated, the remaining gate budget fires in
		// parallel (was: sequential early-exit after ONE retry -> playerCalls 2). The stub
		// clamps its script, so the second parallel call also sees OK; the first playable
		// response wins and the stream proceeds.
		expect(h.playerCalls()).toBe(3);
		// A forced visitorData refresh (getVisitorData(true) → SEARCH_URL) sits BETWEEN the
		// first player POST and the retry POSTs.
		const firstPlayer = h.urls.indexOf(PLAYER_URL);
		const secondPlayer = h.urls.indexOf(PLAYER_URL, firstPlayer + 1);
		const refreshBetween = h.urls
			.slice(firstPlayer + 1, secondPlayer)
			.some((u) => u === SEARCH_URL);
		expect(refreshBetween).toBe(true);
	});

	it('a persistent non-OK returns 503 after the full gate budget (client fallback engages, no media fetch)', async () => {
		const h = stubFetch([fixture.loginRequired, fixture.loginRequired]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		// Never 502/504: the edge would replace the body AND headers of a 502/504 with its own
		// text page — 503 carries the error through intact.
		expect(res.status).toBe(503);
		// quick-261024-ytg: cached token + TWO fresh-token retries, then give up (was: one retry —
		// a ~40% per-call gate made a single retry a coin flip).
		expect(h.playerCalls()).toBe(3);
		expect(h.mediaUrl()).toBeNull(); // never fetched googlevideo bytes
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		// Diagnostics: the upstream playability rides as headers (the curly apostrophe in the
		// fixture reason is header-sanitized to '?').
		expect(res.headers.get('x-ytmusic-playability')).toBe('LOGIN_REQUIRED');
		expect(res.headers.get('x-ytmusic-reason')).toBe('Sign in to confirm you?re not a bot');
	});

	it('two gated calls then an OK streams — the gate retry rescues a would-be 503 (quick-261024-ytg)', async () => {
		const h = stubFetch([fixture.loginRequired, fixture.loginRequired, OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(200);
		expect(h.playerCalls()).toBe(3);
		expect(h.mediaUrl()).toBe(ITAG_140_URL);
	});

	it('an OK player with no playable AAC format (ciphered-only) returns 503 without a media fetch', async () => {
		const h = stubFetch([fixture.cipheredOnly]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(503);
		expect(h.playerCalls()).toBe(1); // status was OK → no refresh/retry
		expect(h.mediaUrl()).toBeNull();
	});

	it('an empty / whitespace videoId returns 400 with no upstream fetch', async () => {
		const h = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('   ') as any);

		expect(res.status).toBe(400);
		expect(h.spy).not.toHaveBeenCalled();
	});

	// Wire-level guard for the PLAYER_CLIENT_VERSION pin (see the ROTTING PIN comment in ytmusic-innertube.ts).
	it('the player POST sends the VISIONOS client + the shared UA, with visitorData (rotting pin guard, quick-260915-30m)', async () => {
		const h = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await streamGet(ev('vid123') as any);

		const call = h.spy.mock.calls.find(([u]) => String(u) === PLAYER_URL);
		expect(call).toBeDefined();
		const init = call![1] as RequestInit;
		const client = JSON.parse(init.body as string).context.client;

		// ANDROID_VR now needs a GVS PoToken (only ~1 MB served) — guard against a silent revert.
		expect(client.clientName).toBe('VISIONOS');
		// Deliberately pins NO literal version — this test must not rot at the next bump.
		expect(client.clientVersion).toBe(PLAYER_CLIENT_VERSION);
		expect(new Headers((init.headers ?? {}) as HeadersInit).get('user-agent')).toBe(PLAYER_UA);
		// visitorData stays mandatory — a current clientVersion without it is still LOGIN_REQUIRED.
		expect(typeof client.visitorData).toBe('string');
		expect(client.visitorData.length).toBeGreaterThan(0);
	});

	it('OPTIONS → 204 with allowlisted corsHeaders', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamOptions(ev('vid123') as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});
});

describe('media path uses raw fetch — no apiFetch / governor on the byte stream', () => {
	it('+server.ts never imports or calls apiFetch (a long-lived media stream must not hold a slot)', () => {
		const src = readFileSync(fileURLToPath(new URL('./+server.ts', import.meta.url)), 'utf8');
		expect(src).not.toContain('apiFetch');
	});
});
