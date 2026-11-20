// quick-261101-ccm: adapter tests for the CCMixter client adapter — gate wiring
// (mirrors jamendo.test.ts), row mapping, and the resolve() stream-URL stamp.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ccmixter } from './ccmixter';
import { ccmixterHealth } from '../services/ccmixter-health';
import type { Track } from './types';

const ac = new AbortController();

const SEARCH = {
	rows: [
		{
			id: '71314',
			title: 'One Love (Only One)',
			artist: 'Admiral Bob',
			cover: 'https://ccmixter.org/content/admiralbob77/IMG_039093x94.jpg'
		},
		{ id: '71305', title: 'Only one Love', artist: 'reiswerk', cover: null }
	]
};

function mockJsonFetch(body: unknown) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'ccmixter:71314',
		source: 'ccmixter',
		songid: '71314',
		title: 'One Love (Only One)',
		artist: 'Admiral Bob',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'love',
		displayIndex: 1,
		...overrides
	};
}

beforeEach(() => {
	ccmixterHealth.__reset();
});
afterEach(() => {
	vi.unstubAllGlobals();
	ccmixterHealth.__reset();
});

describe('ccmixter.search', () => {
	it('maps edge rows to Tracks (audioUrl null — media never crosses to the client)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(SEARCH));
		const tracks = await ccmixter.search('love', 1, ac.signal);
		expect(tracks).toHaveLength(2);
		expect(tracks[0]).toMatchObject({
			uid: 'ccmixter:71314',
			source: 'ccmixter',
			songid: '71314',
			title: 'One Love (Only One)',
			artist: 'Admiral Bob',
			cover: 'https://ccmixter.org/content/admiralbob77/IMG_039093x94.jpg',
			audioUrl: null
		});
		// No duration: the XSPF <duration> field is bytes, never surfaced.
		expect(tracks[0].duration).toBeUndefined();
		expect(tracks[1].cover).toBeNull();
	});

	it('records ok on a well-formed body — empty included (never dry-counted)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ rows: [] }));
		await expect(ccmixter.search('周杰伦', 1, ac.signal)).resolves.toEqual([]);
		expect(ccmixterHealth.isGated()).toBe(false);
	});

	it('records fail + throws on contract drift (no rows anchor)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ results: [] }));
		await expect(ccmixter.search('love', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});

	it('records fail on a fetch reject, but never on a caller abort', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
		await expect(ccmixter.search('love', 1, ac.signal)).rejects.toThrow('boom');

		const aborted = new AbortController();
		aborted.abort();
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
		// apiFetch normalizes the rejection to its own 'Aborted' error.
		await expect(ccmixter.search('love', 1, aborted.signal)).rejects.toThrow(/borted/);
		// Only ONE counted fail so far — the gate (threshold 3) must still be open.
		expect(ccmixterHealth.isGated()).toBe(false);
	});

	it('short-circuits to [] while gated (no fetch issued)', async () => {
		const spy = mockJsonFetch(SEARCH);
		vi.stubGlobal('fetch', spy);
		ccmixterHealth.recordFail();
		ccmixterHealth.recordFail();
		ccmixterHealth.recordFail();
		expect(ccmixterHealth.isGated()).toBe(true);
		await expect(ccmixter.search('love', 1, ac.signal)).resolves.toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('ccmixter.resolve', () => {
	it('stamps the own-origin stream URL + quality, no network', async () => {
		const spy = mockJsonFetch({});
		vi.stubGlobal('fetch', spy);
		const out = await ccmixter.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe('/api/ccmixter/stream?id=71314');
		expect(out.proxyUrl).toBe('/api/ccmixter/stream?id=71314');
		expect(out.detailsLoaded).toBe(true);
		expect(out.quality).not.toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it('throws on a missing songid', async () => {
		await expect(ccmixter.resolve(stubTrack({ songid: '' }), ac.signal)).rejects.toThrow(/missing songid/);
	});
});
