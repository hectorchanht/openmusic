import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audius } from './audius';
import type { Track } from './types';

const ac = new AbortController();

function mockFetchOnce(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': contentType }
		});
	});
}

// A representative upstream row (untrusted shape — every field optional in practice).
const sampleRow = {
	id: 'EJQkAER',
	title: 'Imagine Dragons--Radioactive',
	user: { name: 'Yoryo', handle: 'yoryo98' },
	artwork: {
		'150x150': 'https://cdn.audius.co/150.jpg',
		'480x480': 'https://cdn.audius.co/480.jpg',
		'1000x1000': 'https://cdn.audius.co/1000.jpg'
	},
	duration: 179,
	is_streamable: true
};

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('audius.search', () => {
	it('maps a sample row into a canonical Track', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ data: [sampleRow] }));

		const tracks = await audius.search('radioactive', 1, ac.signal);

		expect(tracks.length).toBe(1);
		const t = tracks[0];
		expect(t.uid).toBe('audius:EJQkAER');
		expect(t.source).toBe('audius');
		expect(t.songid).toBe('EJQkAER');
		expect(t.title).toBe('Imagine Dragons--Radioactive');
		expect(t.artist).toBe('Yoryo');
		expect(t.album).toBe('');
		// prefers 480x480
		expect(t.cover).toBe('https://cdn.audius.co/480.jpg');
		expect(t.duration).toBe(179);
		expect(t.audioUrl).toBeNull();
		expect(t.detailsLoaded).toBe(false);
		expect(t.keyword).toBe('radioactive');
		expect(t.displayIndex).toBe(1);
	});

	it('falls back to 150x150 then null for cover', async () => {
		const only150 = { id: 'A1', title: 'a', user: { name: 'u' }, artwork: { '150x150': 'https://c/150.jpg' }, is_streamable: true };
		const noArt = { id: 'A2', title: 'b', user: { name: 'u' }, artwork: null, is_streamable: true };
		vi.stubGlobal('fetch', mockFetchOnce({ data: [only150, noArt] }));

		const tracks = await audius.search('x', 1, ac.signal);
		expect(tracks[0].cover).toBe('https://c/150.jpg');
		expect(tracks[1].cover).toBeNull();
	});

	it('SKIPS rows with is_streamable:false and rows with no id', async () => {
		const notStreamable = { id: 'B1', title: 'no', user: { name: 'u' }, is_streamable: false };
		const noId = { title: 'no id', user: { name: 'u' }, is_streamable: true };
		vi.stubGlobal('fetch', mockFetchOnce({ data: [notStreamable, noId, sampleRow] }));

		const tracks = await audius.search('x', 1, ac.signal);
		expect(tracks.length).toBe(1);
		expect(tracks[0].songid).toBe('EJQkAER');
	});

	it('hits /api/audius/search with the encoded query', async () => {
		const spy = mockFetchOnce({ data: [] });
		vi.stubGlobal('fetch', spy);

		await audius.search('周杰伦 hi', 1, ac.signal);

		expect(spy).toHaveBeenCalled();
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toBe('/api/audius/search?query=' + encodeURIComponent('周杰伦 hi'));
	});

	it('THROWS on a contract-drift body (no data array)', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ error: 'x' }));
		await expect(audius.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});

	it('returns [] for page > 1 (endpoint does not paginate)', async () => {
		const spy = mockFetchOnce({ data: [sampleRow] });
		vi.stubGlobal('fetch', spy);

		const tracks = await audius.search('x', 2, ac.signal);
		expect(tracks).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('audius.resolve', () => {
	function stubTrack(overrides: Partial<Track> = {}): Track {
		return {
			uid: 'audius:EJQkAER',
			source: 'audius',
			songid: 'EJQkAER',
			title: 'Radioactive',
			artist: 'Yoryo',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: 'radioactive',
			displayIndex: 1,
			...overrides
		};
	}

	it('sets audioUrl to own-origin /api/audius/stream/<songid>, tags quality, marks loaded', async () => {
		const out = await audius.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toMatch(/\/api\/audius\/stream\/EJQkAER$/);
		expect(out.quality).not.toBeNull();
		expect(out.qualityLabel).not.toBeNull();
		expect(out.detailsLoaded).toBe(true);
	});

	it('THROWS when songid is missing', async () => {
		await expect(audius.resolve(stubTrack({ songid: '' }), ac.signal)).rejects.toThrow(/songid/);
	});
});
