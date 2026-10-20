import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migu } from './migu';
import type { Track } from './types';
import { settings } from '$lib/stores/settings.svelte';
import searchFixture from './__fixtures__/migu.search.json';

const ac = new AbortController();

// Fixtures are trimmed captures of the real pd.musicapp search_all.do response
// (quick-261020-migu live probe, 2026-10-20): row 0 = 晴天 (studio) — every format
// VIP/paid; row 1 = 晴天 (Live) — chargeAuditions '0', formats free.

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
 * A fetch mock routing by own-origin path: /api/migu/url answers per tone from
 * `urlByTone` (missing tone → { url: null }), /api/migu/lyric answers `lyricBody`.
 * Records every URL it was called with.
 */
function mockResolveFetch(urlByTone: Record<string, unknown>, lyricBody: unknown) {
	const calls: string[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = String(input);
		calls.push(url);
		if (url.startsWith('/api/migu/url')) {
			const m = url.match(/[?&]tone=([A-Z0-9]+)/);
			const body = (m && urlByTone[m[1]]) || { url: null };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.startsWith('/api/migu/lyric')) {
			return new Response(JSON.stringify(lyricBody), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw new Error(`unexpected fetch ${url}`);
	});
	return { fn, calls };
}

const URL_OK_HQ = { url: 'https://freetyst.nf.migu.cn/public/product9th/test.mp3', tone: 'HQ' };

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'migu:600913000007163534|60054704101|2|ZQ',
		source: 'migu',
		songid: '600913000007163534|60054704101|2|ZQ',
		title: '晴天 (Live)',
		artist: '周杰伦',
		album: '周杰伦地表最强世界巡回演唱会',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '晴天',
		displayIndex: 2,
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

describe('migu.search (fixture-backed)', () => {
	it('maps rows into composite songids contentId|copyrightId|resourceType|formatType', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await migu.search('周杰伦 晴天', 1, ac.signal);
		expect(tracks.length).toBe(2);

		const live = tracks[1];
		// Live row: chargeAuditions '0' → formats free; largest by size = ZQ (54 MB, rt '2')
		expect(live.songid).toBe('600913000007163534|60054704101|2|ZQ');
		expect(live.uid).toBe(`migu:${live.songid}`);
		expect(live.title).toBe('晴天 (Live)');
		expect(live.artist).toBe('周杰伦');
		expect(live.album).toBe('周杰伦地表最强世界巡回演唱会');
		expect(live.cover).toContain('d.musicapp.migu.cn');
		expect(live.audioUrl).toBeNull();
		expect(live.detailsLoaded).toBe(false);
	});

	it('keeps an all-VIP song listed with its largest format as identity (fallback covers playback)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await migu.search('周杰伦 晴天', 1, ac.signal);
		const studio = tracks[0];
		// chargeAuditions '1' + price 200 / vip tags → no free format; largest overall = SQ (rt 'E')
		expect(studio.songid).toBe('600902000006889366|60054701923|E|SQ');
	});

	it('throws on contract drift (songResultData.result missing)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ code: '000000' }));
		await expect(migu.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});

	it('skips rows with no rate formats (no playable identity)', async () => {
		vi.stubGlobal(
			'fetch',
			mockJsonFetch({ songResultData: { result: [{ name: 'ghost', contentId: '1', copyrightId: '2' }] } })
		);
		expect(await migu.search('x', 1, ac.signal)).toEqual([]);
	});
});

describe('migu.resolve', () => {
	it("tries the '320' pref tone (HQ) first and labels from the delivered tone", async () => {
		settings.defaultQuality = 'auto'; // node env has no navigator → effective '320'
		const t = stubTrack();
		const { fn, calls } = mockResolveFetch({ HQ: URL_OK_HQ }, { lrc: null });
		vi.stubGlobal('fetch', fn);

		const out = await migu.resolve(t, ac.signal);

		expect(out.audioUrl).toBe(URL_OK_HQ.url);
		expect(out.quality).toBe('320k');
		expect(out.qualityLabel).toBe('320K');
		expect(out.detailsLoaded).toBe(true);
		const urlCalls = calls.filter((u) => u.startsWith('/api/migu/url'));
		expect(urlCalls[0]).toContain('tone=HQ');
		expect(urlCalls[0]).toContain('contentId=600913000007163534');
		expect(urlCalls[0]).toContain('copyrightId=60054704101');
	});

	it('falls back to the stored tone, then PQ, when earlier tones return no url', async () => {
		settings.defaultQuality = 'auto';
		const t = stubTrack();
		const { fn, calls } = mockResolveFetch({ PQ: { url: 'https://freetyst.nf.migu.cn/x.mp3', tone: 'PQ' } }, { lrc: null });
		vi.stubGlobal('fetch', fn);

		const out = await migu.resolve(t, ac.signal);
		expect(out.audioUrl).toContain('freetyst');
		expect(out.qualityLabel).toBe('128K'); // label follows the DELIVERED tone, not the request
		const tones = calls
			.filter((u) => u.startsWith('/api/migu/url'))
			.map((u) => u.match(/[?&]tone=([A-Z0-9]+)/)?.[1]);
		expect(tones).toEqual(['HQ', 'ZQ', 'PQ']);
	});

	it('throws when no tone resolves (VIP/region) so cross-source fallback can take over', async () => {
		const t = stubTrack();
		const { fn } = mockResolveFetch({}, { lrc: null });
		vi.stubGlobal('fetch', fn);
		await expect(migu.resolve(t, ac.signal)).rejects.toThrow(/no playable url/);
	});

	it('throws on a malformed composite songid', async () => {
		const t = stubTrack({ songid: '600913000007163534' });
		vi.stubGlobal('fetch', mockJsonFetch({}));
		await expect(migu.resolve(t, ac.signal)).rejects.toThrow(/malformed composite/);
	});

	it('fills lrc from the lyric route; a lyric miss never fails resolve', async () => {
		settings.defaultQuality = '128';
		const t = stubTrack();
		const { fn } = mockResolveFetch({ PQ: { url: 'https://freetyst.nf.migu.cn/x.mp3', tone: 'PQ' } }, { lrc: '[00:01.00]晴天\n' });
		vi.stubGlobal('fetch', fn);

		const out = await migu.resolve(t, ac.signal);
		expect(out.lrc).toBe('[00:01.00]晴天\n');
		expect(out.audioUrl).toContain('freetyst');
	});
});
