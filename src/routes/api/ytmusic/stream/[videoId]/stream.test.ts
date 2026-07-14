import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GET as streamGet, OPTIONS as streamOptions } from './+server';
// selectAudioFormat + isPlayable moved to the shared proxy module (SvelteKit +server.ts forbids
// non-HTTP-verb exports — quick-270715).
import { selectAudioFormat, isPlayable, PLAYER_URL, SEARCH_URL } from '$lib/proxy/ytmusic';
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

// ─── Task 2: the byte-proxy route (ANDROID_VR player → googlevideo relay) ────────────────────

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
function stubFetch(players: unknown[]) {
	let playerIdx = 0;
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
			const h = new Headers((init?.headers ?? {}) as HeadersInit);
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

describe('GET /api/ytmusic/stream/:videoId — ANDROID_VR player → googlevideo byte-proxy', () => {
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

	it('a non-ranged GET returns 200 with the full body (download path) as audio/mp4', async () => {
		const h = stubFetch([OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('audio/mp4');
		expect(h.mediaRangeHeader()).toBeNull(); // no Range forwarded on a plain GET
		expect(h.mediaUrl()).toBe(ITAG_140_URL);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FULL_BODY);
	});

	it('a first-call LOGIN_REQUIRED triggers exactly ONE visitorData refresh + player retry, then streams', async () => {
		const h = stubFetch([fixture.loginRequired, OK]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(200);
		expect(h.playerCalls()).toBe(2); // exactly one retry — no infinite loop
		// A forced visitorData refresh (getVisitorData(true) → SEARCH_URL) sits BETWEEN the two player POSTs.
		const firstPlayer = h.urls.indexOf(PLAYER_URL);
		const secondPlayer = h.urls.indexOf(PLAYER_URL, firstPlayer + 1);
		const refreshBetween = h.urls
			.slice(firstPlayer + 1, secondPlayer)
			.some((u) => u === SEARCH_URL);
		expect(refreshBetween).toBe(true);
	});

	it('a persistent non-OK returns 502 after exactly one retry (client fallback engages, no media fetch)', async () => {
		const h = stubFetch([fixture.loginRequired, fixture.loginRequired]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(502);
		expect(h.playerCalls()).toBe(2); // one refresh + retry, then give up
		expect(h.mediaUrl()).toBeNull(); // never fetched googlevideo bytes
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});

	it('an OK player with no playable AAC format (ciphered-only) returns 502 without a media fetch', async () => {
		const h = stubFetch([fixture.cipheredOnly]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);

		expect(res.status).toBe(502);
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
