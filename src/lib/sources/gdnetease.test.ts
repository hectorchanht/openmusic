// quick-261020-gdnt: unit tests for the GD音乐台 Netease client adapter.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { gdnetease } from './gdnetease';
import type { Track } from './types';

const ac = new AbortController();

// Trimmed captures of the real gdstudio responses (live probes 2026-10-20).
const SEARCH = [
	{
		id: '5257138',
		name: '屋顶',
		artist: ['周杰伦', '温岚'],
		album: '男女情歌对唱冠军全记录',
		pic_id: '109951165671182684',
		url_id: '5257138',
		lyric_id: '5257138',
		source: 'netease'
	}
];
const URL_320 = {
	url: 'https://m801.music.126.net/20261021081736/190ba81f6f8e910dca896cfd0406e88a/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/9444693488/94b2/45cb/21d6/9e34cbd9902ee8a917e6d0781557b94e.mp3',
	br: 320,
	size: 12764517
};
const LRC = { lyric: '[00:00.00] 作曲 : 周杰伦\n[00:23.97]半夜睡不着觉把心情哼成歌\n' };

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
		uid: 'gdnetease:5257138',
		source: 'gdnetease',
		songid: '5257138',
		title: '屋顶',
		artist: '周杰伦 / 温岚',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: '/api/gdnetease/lrc?id=5257138',
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '屋顶',
		displayIndex: 1,
		...overrides
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('gdnetease.search', () => {
	it('maps rows to Tracks with meting-pic covers and proxy lrcUrls', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(SEARCH));
		const tracks = await gdnetease.search('屋顶', 1, ac.signal);
		expect(tracks).toHaveLength(1);
		const t = tracks[0];
		expect(t.uid).toBe('gdnetease:5257138');
		expect(t.title).toBe('屋顶');
		expect(t.artist).toBe('周杰伦 / 温岚');
		expect(t.cover).toBe('https://api.qijieya.cn/meting/?server=netease&type=pic&id=109951165671182684');
		// audioUrl stays null — the url leg returns JSON, so only resolve() (which
		// parses it) may set the DIRECT url. An <audio> tag cannot play JSON.
		expect(t.audioUrl).toBeNull();
		expect(t.lrcUrl).toBe('/api/gdnetease/lrc?id=5257138');
		expect(t.detailsLoaded).toBe(false);
	});
	it('skips rows without a usable id or name', async () => {
		vi.stubGlobal('fetch', mockJsonFetch([{ name: 'x' }, { url_id: '1' }]));
		expect(await gdnetease.search('x', 1, ac.signal)).toEqual([]);
	});
	it('throws contract-drift on a non-array body', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ error: 'nope' }));
		await expect(gdnetease.search('x', 1, ac.signal)).rejects.toThrow('contract-drift');
	});
});

describe('gdnetease.resolve', () => {
	it('sets audioUrl to the DIRECT url parsed from the JSON leg (br=320)', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				const body = url.includes('/api/gdnetease/url') ? URL_320 : LRC;
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		const out = await gdnetease.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(URL_320.url);
		expect(out.quality).toBe('320k');
		expect(out.qualityLabel).toBe('320K');
		expect(out.lrc).toContain('半夜睡不着觉把心情哼成歌');
		expect(out.detailsLoaded).toBe(true);
		// Streaming default passes br=320…
		expect(calls.find((c) => c.includes('/api/gdnetease/url'))).toContain('br=320');
	});
	it('omits br for a lossless resolve (upstream returns FLAC)', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				return new Response(JSON.stringify(URL_320), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		await gdnetease.resolve(stubTrack({ lrcUrl: null }), ac.signal, 'lossless');
		const urlCall = calls.find((c) => c.includes('/api/gdnetease/url')) ?? '';
		expect(urlCall).not.toContain('br=');
	});
	it('leaves audioUrl null when the url leg has no url (fallback covers it)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ url: null }));
		const out = await gdnetease.resolve(stubTrack({ lrcUrl: null }), ac.signal);
		expect(out.audioUrl).toBeNull();
		expect(out.detailsLoaded).toBe(false);
	});
});
