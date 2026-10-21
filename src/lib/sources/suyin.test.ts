// quick-261020-suyin: unit tests for the 溯音 Kuwo adapter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { suyin, normalizeSuyinItems } from './suyin';
import type { Track } from './types';

const ac = new AbortController();

// Trimmed capture of the real oiapi response (live probe 2026-10-20, br=4).
const SEARCH_ONE = {
	code: 1,
	message: '…',
	data: {
		album: '十一月的萧邦',
		bitrate: '320',
		format: 'mp3',
		id: 118980,
		level: 'p',
		picture: 'https://img1.kuwo.cn/star/albumcover/800/s4s11/89/774616642.jpg',
		rid: 'MUSIC_118980',
		singer: '周杰伦',
		size: '8.66Mb',
		song: '夜曲',
		time: 226,
		url: 'http://kw-er.kuwo.cn/aad191cf669c4fe74d785051bc984c5a/6ad7fd92/resource/1307392909/trackmedia/F000001zMQr71F1Qo8_1.mp3',
		types: [{ level: 'p', bitrate: '320', format: 'mp3', size: '8.66Mb' }]
	}
};

function mockJsonFetch(body: unknown) {
	return vi.fn(async () => {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'suyin:118980',
		source: 'suyin',
		songid: '118980',
		title: '夜曲',
		artist: '周杰伦',
		album: '十一月的萧邦',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '夜曲',
		displayIndex: 1,
		...overrides
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('normalizeSuyinItems', () => {
	it('unwraps the n=1 object shape', () => {
		const items = normalizeSuyinItems(SEARCH_ONE);
		expect(items).toHaveLength(1);
		expect(items[0].song).toBe('夜曲');
	});
	it('passes through the n>1 array shape', () => {
		const items = normalizeSuyinItems({ code: 1, data: [SEARCH_ONE.data, SEARCH_ONE.data] });
		expect(items).toHaveLength(2);
	});
	it('returns [] for missing/garbage data', () => {
		expect(normalizeSuyinItems({ code: 1 })).toEqual([]);
		expect(normalizeSuyinItems(null)).toEqual([]);
		expect(normalizeSuyinItems({ code: 1, data: 'nope' })).toEqual([]);
	});
});

describe('suyin.search', () => {
	it('maps rows to Tracks with https-upgraded audioUrl', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(SEARCH_ONE));
		const tracks = await suyin.search('夜曲', 1, ac.signal);
		expect(tracks).toHaveLength(1);
		const t = tracks[0];
		expect(t.uid).toBe('suyin:118980');
		expect(t.source).toBe('suyin');
		expect(t.title).toBe('夜曲');
		expect(t.artist).toBe('周杰伦');
		expect(t.album).toBe('十一月的萧邦');
		// http:// → https:// upgrade (the CDN serves https; verified 200).
		expect(t.audioUrl).toBe(
			'https://kw-er.kuwo.cn/aad191cf669c4fe74d785051bc984c5a/6ad7fd92/resource/1307392909/trackmedia/F000001zMQr71F1Qo8_1.mp3'
		);
		expect(t.cover).toBe('https://img1.kuwo.cn/star/albumcover/800/s4s11/89/774616642.jpg');
		expect(t.quality).toBe('320k');
		expect(t.detailsLoaded).toBe(true);
	});
	it('skips rows without rid or title', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ code: 1, data: [{ song: '', rid: 'MUSIC_1' }, { song: 'x' }] }));
		const tracks = await suyin.search('x', 1, ac.signal);
		expect(tracks).toEqual([]);
	});
	it('throws contract-drift on a non-object body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('"nope"', { status: 200, headers: { 'content-type': 'application/json' } }))
		);
		await expect(suyin.search('x', 1, ac.signal)).rejects.toThrow('contract-drift');
	});
});

describe('suyin.resolve', () => {
	it('passes through a track that already has audioUrl', async () => {
		const t = stubTrack({ audioUrl: 'https://kw-er.kuwo.cn/x.mp3' });
		const out = await suyin.resolve(t, ac.signal);
		expect(out.audioUrl).toBe('https://kw-er.kuwo.cn/x.mp3');
		expect(out.detailsLoaded).toBe(true);
	});
	it('marks detailsLoaded false when the url is missing (fallback covers it)', async () => {
		const out = await suyin.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBeNull();
		expect(out.detailsLoaded).toBe(false);
	});
});
