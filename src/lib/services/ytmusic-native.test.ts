import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SEARCH_URL, PLAYER_URL, ANDROID_VR_UA } from '$lib/proxy/ytmusic-innertube';

// quick-260915-3ng: node-only tests over a MOCKED @capacitor/core — NO live network, no device.
// Mock shape mirrors the house precedent in blob-store.test.ts.
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@capacitor/core', () => ({
	CapacitorHttp: { post: (o: unknown) => mocks.post(o) },
	Capacitor: { isNativePlatform: () => true }
}));

import { nativeResolveStreamUrl, __resetNativeVisitorCache } from './ytmusic-native';

const DIRECT_URL = 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=140&sparams=ip';

const OK_PLAYER = {
	playabilityStatus: { status: 'OK' },
	streamingData: {
		adaptiveFormats: [
			{
				itag: 251,
				mimeType: 'audio/webm; codecs="opus"',
				url: 'https://rr1---sn-x.googlevideo.com/videoplayback?itag=251'
			},
			{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131112, url: DIRECT_URL }
		]
	}
};
const LOGIN_REQUIRED = { playabilityStatus: { status: 'LOGIN_REQUIRED' } };
const CIPHERED_ONLY = {
	playabilityStatus: { status: 'OK' },
	streamingData: {
		adaptiveFormats: [
			{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', signatureCipher: 's=abc&url=x' }
		]
	}
};

interface PostOpts {
	url: string;
	headers?: Record<string, string>;
	data?: { context?: { client?: Record<string, unknown> }; videoId?: string };
}

/** Route the mock by URL: SEARCH_URL always yields a fresh distinguishable token; PLAYER_URL yields
 *  the next queued player response (the last one repeats). */
function stubPost(playerResponses: unknown[], searchStatus = 200) {
	let searchCalls = 0;
	let playerCalls = 0;
	mocks.post.mockImplementation(async (o: PostOpts) => {
		if (o.url === SEARCH_URL) {
			searchCalls += 1;
			return {
				status: searchStatus,
				data: { responseContext: { visitorData: 'VD-' + searchCalls } },
				headers: {},
				url: o.url
			};
		}
		const body = playerResponses[Math.min(playerCalls, playerResponses.length - 1)];
		playerCalls += 1;
		return { status: 200, data: body, headers: {}, url: o.url };
	});
}

const urlsPosted = () => mocks.post.mock.calls.map(([o]) => (o as PostOpts).url);
const playerCall = (n = 0) =>
	mocks.post.mock.calls.filter(([o]) => (o as PostOpts).url === PLAYER_URL)[n][0] as PostOpts;

beforeEach(() => {
	mocks.post.mockReset();
	__resetNativeVisitorCache();
});

const live = () => new AbortController().signal;

describe('nativeResolveStreamUrl — on-device InnerTube hops via CapacitorHttp (quick-260915-3ng)', () => {
	it('posts SEARCH then PLAYER and returns the itag-140 googlevideo url', async () => {
		stubPost([OK_PLAYER]);

		const url = await nativeResolveStreamUrl('vid1', live());

		expect(url).toBe(DIRECT_URL);
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(urlsPosted()).toEqual([SEARCH_URL, PLAYER_URL]);
	});

	it('sends the ANDROID_VR UA + the InnerTube origin, with body clientVersion agreeing with the UA', async () => {
		stubPost([OK_PLAYER]);
		await nativeResolveStreamUrl('vid2', live());

		const call = playerCall();
		expect(call.headers?.['user-agent']).toBe(ANDROID_VR_UA);
		expect(call.headers?.origin).toBe('https://music.youtube.com');
		// Same posture as the edge route's rotting-pin guard: pin no literal version, only agreement.
		const uaVersion = /oculus\/(\S+) /.exec(ANDROID_VR_UA)?.[1];
		expect(call.data?.context?.client?.clientVersion).toBe(uaVersion);
		expect(call.data?.context?.client?.visitorData).toBe('VD-1');
		expect(call.data?.videoId).toBe('vid2');
	});

	it('caches visitorData across calls — the second resolve posts to PLAYER only', async () => {
		stubPost([OK_PLAYER]);
		await nativeResolveStreamUrl('vid3', live());
		mocks.post.mockClear();

		const url = await nativeResolveStreamUrl('vid4', live());

		expect(url).toBe(DIRECT_URL);
		expect(urlsPosted()).toEqual([PLAYER_URL]);
		expect(playerCall().data?.context?.client?.visitorData).toBe('VD-1');
	});

	it('refreshes visitorData ONCE then gives up — 4 posts, null result, never loops', async () => {
		stubPost([LOGIN_REQUIRED]);

		const url = await nativeResolveStreamUrl('vid5', live());

		expect(url).toBeNull();
		expect(urlsPosted()).toEqual([SEARCH_URL, PLAYER_URL, SEARCH_URL, PLAYER_URL]);
		// The retry must carry the NEW token, else the refresh was pointless.
		expect(playerCall(0).data?.context?.client?.visitorData).toBe('VD-1');
		expect(playerCall(1).data?.context?.client?.visitorData).toBe('VD-2');
	});

	it('returns the url when the refreshed retry succeeds', async () => {
		stubPost([LOGIN_REQUIRED, OK_PLAYER]);

		expect(await nativeResolveStreamUrl('vid6', live())).toBe(DIRECT_URL);
		expect(mocks.post).toHaveBeenCalledTimes(4);
	});

	it('NEVER throws on a rejected post — returns null', async () => {
		mocks.post.mockRejectedValue(new Error('no network'));

		await expect(nativeResolveStreamUrl('vid7', live())).resolves.toBeNull();
	});

	it('returns null on a non-2xx status', async () => {
		mocks.post.mockResolvedValue({ status: 403, data: 'forbidden', headers: {}, url: '' });

		expect(await nativeResolveStreamUrl('vid8', live())).toBeNull();
	});

	it('returns null when the player offers only ciphered formats', async () => {
		stubPost([CIPHERED_ONLY]);

		expect(await nativeResolveStreamUrl('vid9', live())).toBeNull();
	});

	it('returns null on an already-aborted signal without a second hop', async () => {
		stubPost([OK_PLAYER]);
		const ac = new AbortController();
		ac.abort();

		expect(await nativeResolveStreamUrl('vid10', ac.signal)).toBeNull();
		// The signal is checked BETWEEN hops (HttpOptions has no AbortSignal), so at most one request.
		expect(mocks.post.mock.calls.length).toBeLessThanOrEqual(1);
	});

	it('parses a player response delivered as a JSON STRING (non-json content-type)', async () => {
		mocks.post.mockImplementation(async (o: PostOpts) => ({
			status: 200,
			data:
				o.url === SEARCH_URL
					? JSON.stringify({ responseContext: { visitorData: 'VD-s' } })
					: JSON.stringify(OK_PLAYER),
			headers: {},
			url: o.url
		}));

		expect(await nativeResolveStreamUrl('vid11', live())).toBe(DIRECT_URL);
	});

	it('returns null on malformed (unparseable) body', async () => {
		mocks.post.mockResolvedValue({ status: 200, data: '{not json', headers: {}, url: '' });

		expect(await nativeResolveStreamUrl('vid12', live())).toBeNull();
	});
});
