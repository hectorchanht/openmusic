import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kugou } from './kugou';
import type { Track } from './types';
import { settings } from '$lib/stores/settings.svelte';
import searchFixture from './__fixtures__/kugou.search.json';
import detailFixture from './__fixtures__/kugou.detail.json';

const ac = new AbortController();

// The adapter talks to the OWN-ORIGIN edge routes; the fixtures are trimmed captures of
// the real upstreams those routes wrap (quick-261020-kugo live probes, 2026-10-20).

/** A fetch mock that returns one JSON body for every call. */
function mockJsonFetch(body: unknown) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

/**
 * A fetch mock routing by own-origin path: /api/kugou/url answers per-hash from
 * `urlByHash` (missing hash → { url: null } = the paid/unavailable shape), and
 * /api/kugou/lyric answers `lyricBody`. Records every URL it was called with.
 */
function mockResolveFetch(urlByHash: Record<string, unknown>, lyricBody: unknown) {
	const calls: string[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = String(input);
		calls.push(url);
		if (url.startsWith('/api/kugou/url')) {
			const m = url.match(/[?&]hash=([0-9A-Fa-f]{32})/);
			const body = (m && urlByHash[m[1]]) || { url: null };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.startsWith('/api/kugou/lyric')) {
			return new Response(JSON.stringify(lyricBody), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw new Error(`unexpected fetch ${url}`);
	});
	return { fn, calls };
}

/** The normalized /api/kugou/url success body, built from the getSongInfo fixture. */
const URL_OK = {
	url: detailFixture.url,
	backupUrl: null,
	bitRate: detailFixture.bitRate,
	extName: detailFixture.extName,
	cover: 'http://imge.kugou.com/stdmusic/240/20181127/20181127161714796314.jpg'
};

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'kugou:8267B85E29D936AE8FFBA797F64D5B0A',
		source: 'kugou',
		songid: '8267B85E29D936AE8FFBA797F64D5B0A',
		title: '理想三旬',
		artist: '陈鸿宇',
		album: '一如年少模样',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '理想三旬',
		displayIndex: 1,
		duration: 269,
		kugouAlbumId: '647158',
		kugouHqHash: 'D5F22262D50389EEF6894C2D732CC698',
		kugouSqHash: '2146999DF447B6012599756CDF3A8E6D',
		...overrides
	};
}

let prevQuality: typeof settings.defaultQuality;
beforeEach(() => {
	vi.restoreAllMocks();
	prevQuality = settings.defaultQuality;
});
afterEach(() => {
	vi.restoreAllMocks();
	settings.defaultQuality = prevQuality;
});

describe('kugou.search (fixture-backed)', () => {
	it('maps song_search_v2 rows into canonical Track[] keyed kugou:${FileHash}', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));

		const tracks = await kugou.search('理想三旬', 1, ac.signal);

		expect(tracks.length).toBe(searchFixture.data.lists.length);
		const first = tracks[0];
		const f0 = searchFixture.data.lists[0];
		expect(first.uid).toBe(`kugou:${f0.FileHash}`);
		expect(first.source).toBe('kugou');
		expect(first.songid).toBe(f0.FileHash);
		// <em> highlight tags stripped from display fields
		expect(first.title).toBe('理想三旬');
		expect(first.artist).toBe('陈鸿宇');
		expect(first.album).toBe(f0.AlbumName);
		expect(first.duration).toBe(f0.Duration);
		// quality-ladder extras captured for resolve()
		expect(first.kugouAlbumId).toBe(String(f0.AlbumID));
		expect(first.kugouHqHash).toBe(f0.HQFileHash);
		expect(first.kugouSqHash).toBe(f0.SQFileHash);
		expect(first.kugouResHash).toBe(f0.ResFileHash);
		expect(first.audioUrl).toBeNull();
		expect(first.detailsLoaded).toBe(false);
		expect(first.keyword).toBe('理想三旬');
		expect(first.displayIndex).toBe(1);
	});

	it('throws on contract drift (status !== 1 or lists missing)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ status: 0, data: {} }));
		await expect(kugou.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});

	it('skips rows without a FileHash (no playable identity)', async () => {
		vi.stubGlobal(
			'fetch',
			mockJsonFetch({ status: 1, data: { lists: [{ SongName: 'ghost', FileHash: '' }] } })
		);
		const tracks = await kugou.search('x', 1, ac.signal);
		expect(tracks).toEqual([]);
	});
});

describe('kugou.resolve', () => {
	it('resolves via the std hash when the track carries no extras (restored-library shape)', async () => {
		settings.defaultQuality = 'lossless';
		const bare = stubTrack({ kugouAlbumId: undefined, kugouHqHash: undefined, kugouSqHash: undefined, kugouResHash: undefined });
		const { fn, calls } = mockResolveFetch({ [bare.songid]: URL_OK }, { lrc: null });
		vi.stubGlobal('fetch', fn);

		const out = await kugou.resolve(bare, ac.signal);

		expect(out.audioUrl).toBe(detailFixture.url);
		expect(out.detailsLoaded).toBe(true);
		// bitRate 128 from the fixture → 128K label (labels follow the RETURNED bitrate)
		expect(out.quality).toBe('128k');
		expect(out.qualityLabel).toBe('128K');
		// cover filled from the resolve body when search had none
		expect(out.cover).toBe(URL_OK.cover);
		expect(calls.some((u) => u.startsWith('/api/kugou/url') && u.includes(bare.songid))).toBe(true);
	});

	it("honours the quality pref: '320' tries the HQ hash first", async () => {
		const t = stubTrack();
		const { fn, calls } = mockResolveFetch({ [t.kugouHqHash as string]: URL_OK }, { lrc: null });
		vi.stubGlobal('fetch', fn);

		await kugou.resolve(t, ac.signal, '320');

		const urlCalls = calls.filter((u) => u.startsWith('/api/kugou/url'));
		expect(urlCalls[0]).toContain(t.kugouHqHash as string);
	});

	it('falls through the ladder when a tier returns no url (paid top tier, free std tier)', async () => {
		settings.defaultQuality = 'lossless';
		const t = stubTrack();
		const { fn, calls } = mockResolveFetch({ [t.songid]: URL_OK }, { lrc: null });
		vi.stubGlobal('fetch', fn);

		const out = await kugou.resolve(t, ac.signal);

		expect(out.audioUrl).toBe(detailFixture.url);
		const urlCalls = calls.filter((u) => u.startsWith('/api/kugou/url'));
		// SQ (flac) tried before the std hash under the lossless pref; std delivered.
		expect(urlCalls[0]).toContain(t.kugouSqHash as string);
		expect(urlCalls[urlCalls.length - 1]).toContain(t.songid);
	});

	it('throws when every tier is unplayable (paid song) so cross-source fallback can take over', async () => {
		const t = stubTrack();
		const { fn } = mockResolveFetch({}, { lrc: null });
		vi.stubGlobal('fetch', fn);
		await expect(kugou.resolve(t, ac.signal)).rejects.toThrow(/no playable url/);
	});

	it('fills lrc from the lyric route when it returns one; a lyric miss never fails resolve', async () => {
		const t = stubTrack();
		const { fn } = mockResolveFetch({ [t.songid]: URL_OK }, { lrc: '[00:01.00]理想三旬\n' });
		vi.stubGlobal('fetch', fn);
		settings.defaultQuality = '128';

		const out = await kugou.resolve(t, ac.signal);
		expect(out.lrc).toBe('[00:01.00]理想三旬\n');
		expect(out.audioUrl).toBe(detailFixture.url);
	});
});
