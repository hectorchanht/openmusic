import { describe, it, expect, vi, afterEach } from 'vitest';
import { isHlsUrl, canPlayNativeHls, parseHlsMedia, stitchHls, _resetHlsSupportForTests } from './hls';

describe('isHlsUrl', () => {
	it('detects an .m3u8 path (query ignored)', () => {
		expect(isHlsUrl('https://h/x/playlist.m3u8?expires=1')).toBe(true);
		expect(isHlsUrl('https://h/x/PLAYLIST.M3U8')).toBe(true);
	});
	it('rejects non-playlist, null and junk', () => {
		expect(isHlsUrl('https://h/x.mp3')).toBe(false);
		expect(isHlsUrl('https://h/m3u8/x.mp3')).toBe(false);
		expect(isHlsUrl(null)).toBe(false);
		expect(isHlsUrl('not a url')).toBe(false);
	});
});

describe('canPlayNativeHls', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		_resetHlsSupportForTests();
	});
	const stubAudio = (answer: string) => {
		const canPlayType = vi.fn((_t: string) => answer);
		vi.stubGlobal('document', { createElement: () => ({ canPlayType }) });
		return canPlayType;
	};
	it('is false with no document (node/SSR)', () => {
		expect(canPlayNativeHls()).toBe(false);
	});
	it('is true when canPlayType answers non-empty', () => {
		const cpt = stubAudio('maybe');
		expect(canPlayNativeHls()).toBe(true);
		expect(cpt).toHaveBeenCalledWith('application/vnd.apple.mpegurl');
	});
	it('is false when canPlayType answers empty', () => {
		stubAudio('');
		expect(canPlayNativeHls()).toBe(false);
	});
	it('memoizes the answer', () => {
		const cpt = stubAudio('probably');
		canPlayNativeHls();
		canPlayNativeHls();
		expect(cpt).toHaveBeenCalledTimes(1);
	});
});

const BASE = 'https://h/a/playlist.m3u8';
const MEDIA = [
	'#EXTM3U',
	'#EXT-X-VERSION:7',
	'#EXT-X-TARGETDURATION:10',
	'#EXT-X-MAP:URI="init.mp4"',
	'',
	'#EXTINF:10.0,',
	'data000.m4s',
	'#EXTINF:4.2,',
	'data001.m4s',
	'#EXT-X-ENDLIST'
].join('\n');

describe('parseHlsMedia', () => {
	it('resolves relative init + segments against the playlist URL', () => {
		expect(parseHlsMedia(MEDIA, BASE)).toEqual({
			init: 'https://h/a/init.mp4',
			segments: ['https://h/a/data000.m4s', 'https://h/a/data001.m4s']
		});
	});
	it('passes absolute URIs through and reads URI past extra MAP attrs', () => {
		const text = '#EXTM3U\n#EXT-X-MAP:URI="https://c/i.mp4",BYTERANGE="100@0"\n#EXTINF:1,\nhttps://c/s0.m4s\n';
		expect(parseHlsMedia(text, BASE)).toEqual({ init: 'https://c/i.mp4', segments: ['https://c/s0.m4s'] });
	});
	it('no EXT-X-MAP → init null', () => {
		expect(parseHlsMedia('#EXTM3U\n#EXTINF:1,\ns.aac\n', BASE)).toEqual({ init: null, segments: ['https://h/a/s.aac'] });
	});
	it('throws on a master playlist', () => {
		expect(() => parseHlsMedia('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n', BASE)).toThrow();
	});
	it('throws on a non-https part (T-43-14)', () => {
		expect(() => parseHlsMedia('#EXTM3U\n#EXTINF:1,\nhttp://evil/s.m4s\n', BASE)).toThrow();
	});
});

describe('stitchHls', () => {
	afterEach(() => vi.unstubAllGlobals());
	const bytes: Record<string, Uint8Array> = {
		'https://h/a/init.mp4': new Uint8Array([1, 2]),
		'https://h/a/data000.m4s': new Uint8Array([3, 4, 5]),
		'https://h/a/data001.m4s': new Uint8Array([6])
	};
	const mockFetch = (fail?: string) =>
		vi.fn(async (u: string) => {
			if (u === fail) return new Response('nope', { status: 403 });
			if (u === BASE) return new Response(MEDIA);
			return new Response(bytes[u] as BodyInit);
		});

	it('fetches playlist, init, segments and concatenates in playlist order as audio/mp4', async () => {
		const f = mockFetch();
		vi.stubGlobal('fetch', f);
		const progress: number[] = [];
		const blob = await stitchHls(BASE, { onProgress: (p) => progress.push(p) });
		expect(f.mock.calls.map((c) => c[0])).toEqual([BASE, ...Object.keys(bytes)]);
		expect(blob.type).toBe('audio/mp4');
		expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(progress.length).toBeGreaterThan(0);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
		expect(progress.at(-1)).toBe(1);
	});
	it('throws when any part is non-ok', async () => {
		vi.stubGlobal('fetch', mockFetch('https://h/a/data001.m4s'));
		await expect(stitchHls(BASE)).rejects.toThrow();
	});
	it('throws when the playlist itself is non-ok', async () => {
		vi.stubGlobal('fetch', mockFetch(BASE));
		await expect(stitchHls(BASE)).rejects.toThrow();
	});
	it('throws on an aborted signal', async () => {
		vi.stubGlobal('fetch', mockFetch());
		const ac = new AbortController();
		ac.abort();
		await expect(stitchHls(BASE, { signal: ac.signal })).rejects.toThrow();
	});
});
