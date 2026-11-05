import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bandcamp } from './bandcamp';
import { bandcampHealth } from '../services/bandcamp-health';
import { apiUrl } from '../services/api-base';
import type { Track } from './types';
import searchFixture from './__fixtures__/bandcamp.search.json';

const ac = new AbortController();

function mockJsonFetch(body: unknown, status = 200) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	});
}

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'bandcamp:2636669871-2834446269',
		source: 'bandcamp',
		songid: '2636669871-2834446269',
		title: 'LOFI (w/ DJ Earl)',
		artist: 'INVT',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'lofi',
		displayIndex: 1,
		...overrides
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	bandcampHealth.__reset();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	bandcampHealth.__reset();
});

describe('bandcamp.search', () => {
	it('maps route rows into Track stubs keyed bandcamp:<band>-<track>', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await bandcamp.search('lofi', 1, ac.signal);
		expect(tracks.length).toBe(searchFixture.rows.length);
		const r = searchFixture.rows[1];
		const t = tracks[1];
		expect(t.uid).toBe(`bandcamp:${r.id}`);
		expect(t.source).toBe('bandcamp');
		expect(t.songid).toBe(r.id);
		expect(t.title).toBe(r.title);
		expect(t.artist).toBe(r.artist);
		expect(t.album).toBe(r.album);
		expect(t.cover).toBe(r.cover);
		expect(t.audioUrl).toBeNull();
		expect(t.detailsLoaded).toBe(false);
		expect(t.displayIndex).toBe(2);
		expect(t.keyword).toBe('lofi');
		expect(tracks[2].cover).toBeNull();
	});

	it('drops rows without id or title', async () => {
		vi.stubGlobal(
			'fetch',
			mockJsonFetch({ rows: [{ title: 'no id' }, { id: '1-2' }, searchFixture.rows[0]] })
		);
		const tracks = await bandcamp.search('lofi', 1, ac.signal);
		expect(tracks.map((t) => t.songid)).toEqual([searchFixture.rows[0].id]);
	});

	it('ignores page: one fetch, no page/limit param, full list returned', async () => {
		const f = mockJsonFetch(searchFixture);
		vi.stubGlobal('fetch', f);
		const tracks = await bandcamp.search('lofi', 8, ac.signal);
		expect(f).toHaveBeenCalledTimes(1);
		const url = String(f.mock.calls[0][0]);
		expect(url).toContain('/api/bandcamp/search?q=lofi');
		expect(url).not.toMatch(/page|limit|offset/);
		expect(tracks.length).toBe(searchFixture.rows.length);
	});

	it('returns [] without fetching while gated', async () => {
		const f = mockJsonFetch(searchFixture);
		vi.stubGlobal('fetch', f);
		vi.spyOn(bandcampHealth, 'isGated').mockReturnValue(true);
		expect(await bandcamp.search('lofi', 1, ac.signal)).toEqual([]);
		expect(f).not.toHaveBeenCalled();
	});

	it('a resolved 503 records a failure and throws', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ error: 'x' }, 503));
		const fail = vi.spyOn(bandcampHealth, 'recordFail');
		await expect(bandcamp.search('lofi', 1, ac.signal)).rejects.toThrow();
		expect(fail).toHaveBeenCalled();
	});

	it('throws on contract drift and records a failure', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({}));
		const fail = vi.spyOn(bandcampHealth, 'recordFail');
		await expect(bandcamp.search('lofi', 1, ac.signal)).rejects.toThrow(/contract-drift/);
		expect(fail).toHaveBeenCalled();
	});

	it('empty rows is a healthy answer', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ rows: [] }));
		const ok = vi.spyOn(bandcampHealth, 'recordOk');
		expect(await bandcamp.search('周杰伦', 1, ac.signal)).toEqual([]);
		expect(ok).toHaveBeenCalled();
	});
});

describe('bandcamp.resolve', () => {
	it('stamps the direct bcbits url for <audio> and the own-origin stream route for downloads', async () => {
		const url = 'https://t4.bcbits.com/stream/abc/mp3-128/2834446269?p=0&ts=1&t=x&token=y';
		const f = mockJsonFetch({ url, duration: 213 });
		vi.stubGlobal('fetch', f);
		const out = await bandcamp.resolve(stubTrack(), ac.signal);
		expect(String(f.mock.calls[0][0])).toContain('/api/bandcamp/resolve?id=2636669871-2834446269');
		expect(out.audioUrl).toBe(url);
		expect(out.proxyUrl).toBe(apiUrl('/api/bandcamp/stream?id=2636669871-2834446269'));
		expect(out.duration).toBe(213);
		expect(out.quality).toBe('128k');
		expect(out.qualityLabel).toBe('128K');
		expect(out.lrc).toBeNull();
		expect(out.detailsLoaded).toBe(true);
	});

	it('throws on a non-ok response', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ error: 'unstreamable' }, 503));
		await expect(bandcamp.resolve(stubTrack(), ac.signal)).rejects.toThrow();
	});

	it('throws on a non-https url', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ url: 'http://t4.bcbits.com/x', duration: 1 }));
		await expect(bandcamp.resolve(stubTrack(), ac.signal)).rejects.toThrow();
	});
});
