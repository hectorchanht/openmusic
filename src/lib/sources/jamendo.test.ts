// quick-261101-gate: adapter tests for the Jamendo client adapter — created with the
// universal health-gate rollout (2026-11-01); before this the adapter had no test file.
// Scope is deliberately the gate wiring + a mapping sanity check, not a full
// re-verification of the port (live-probed 2026-06-07).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jamendo } from './jamendo';
import { jamendoHealth } from '../services/jamendo-health';
import type { Track } from './types';

const ac = new AbortController();

const SEARCH = {
	headers: { status: 'success', code: 0 },
	results: [
		{
			id: '1234',
			name: 'Indie Song',
			artist_name: 'Indie Artist',
			album_name: 'Indie Album',
			image: 'https://img.example/cover.jpg',
			audio: 'https://cdn.example/track.mp3'
		}
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
		uid: 'jamendo:1234',
		source: 'jamendo',
		songid: '1234',
		title: 'Indie Song',
		artist: 'Indie Artist',
		album: 'Indie Album',
		cover: null,
		audioUrl: 'https://cdn.example/track.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'indie',
		displayIndex: 1,
		...overrides
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	jamendoHealth.__reset(); // the gate is module-scope — never let a trip leak between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	jamendoHealth.__reset();
	vi.unstubAllGlobals();
});

describe('jamendo.search (mapping)', () => {
	it('maps results into Tracks with the search-time audio url', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(SEARCH));
		const tracks = await jamendo.search('indie', 1, ac.signal);
		expect(tracks).toHaveLength(1);
		expect(tracks[0].uid).toBe('jamendo:1234');
		expect(tracks[0].audioUrl).toBe('https://cdn.example/track.mp3');
	});
});

describe('jamendo health gate (jamendo-health wiring)', () => {
	it('search short-circuits to [] without a fetch once the gate is tripped', async () => {
		const fetchMock = mockJsonFetch(SEARCH);
		vi.stubGlobal('fetch', fetchMock);
		jamendoHealth.recordFail();
		jamendoHealth.recordFail();
		jamendoHealth.recordFail();
		expect(jamendoHealth.isGated()).toBe(true);

		const tracks = await jamendo.search('indie', 1, ac.signal);

		expect(tracks).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('drift searches throw AND count toward the gate (3 trips it)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ headers: { status: 'failed', code: 5 }, results: [] }));
		for (let i = 0; i < 3; i++) {
			await expect(jamendo.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
		}
		expect(jamendoHealth.isGated()).toBe(true);
	});

	it('a well-formed EMPTY results[] is a legit no-hit — recordOk, never counted', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ headers: { status: 'success', code: 0 }, results: [] }));
		for (let i = 0; i < 3; i++) {
			await expect(jamendo.search('周杰伦', 1, ac.signal)).resolves.toEqual([]);
		}
		expect(jamendoHealth.isGated()).toBe(false);
	});

	it('resolve makes no network call and no health record (deterministic stamp)', async () => {
		const fetchMock = mockJsonFetch(SEARCH);
		vi.stubGlobal('fetch', fetchMock);
		const t = await jamendo.resolve(stubTrack(), ac.signal);
		expect(t.detailsLoaded).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(jamendoHealth.isGated()).toBe(false);
	});
});
