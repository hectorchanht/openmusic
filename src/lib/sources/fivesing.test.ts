// quick-261101-gate: adapter tests for the 5sing client adapter — created with the
// universal health-gate rollout (2026-11-01); before this the adapter had no test file.
// Scope is deliberately the gate wiring + the identity-critical mapping (compound
// songid), not a full re-verification of the port (live-probed 2026-06-07).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fivesing } from './fivesing';
import { fivesingHealth } from '../services/fivesing-health';
import type { Track } from './types';

const ac = new AbortController();

const SEARCH = {
	list: [
		{
			songId: 12345,
			songName: '<em class="keyword">晴天</em> (cover)',
			singer: '翻唱歌手',
			typeEname: 'fc',
			typeName: '翻唱'
		}
	]
};
const URL_OK = {
	code: 1000,
	data: { squrl: '', hqurl: 'https://fs.example/hq.mp3', lqurl: 'https://fs.example/lq.mp3' }
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
		uid: 'fivesing:fc-12345',
		source: 'fivesing',
		songid: 'fc-12345',
		title: '晴天 (cover)',
		artist: '翻唱歌手',
		album: '翻唱',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '晴天',
		displayIndex: 1,
		fivesingSongType: 'fc',
		...overrides
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	fivesingHealth.__reset(); // the gate is module-scope — never let a trip leak between tests
});
afterEach(() => {
	vi.restoreAllMocks();
	fivesingHealth.__reset();
	vi.unstubAllGlobals();
});

describe('fivesing.search (mapping)', () => {
	it('maps rows to compound songids <type>-<id> and strips <em> tags', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(SEARCH));
		const tracks = await fivesing.search('晴天', 1, ac.signal);
		expect(tracks).toHaveLength(1);
		expect(tracks[0].uid).toBe('fivesing:fc-12345');
		expect(tracks[0].songid).toBe('fc-12345');
		expect(tracks[0].title).toBe('晴天 (cover)');
		expect(tracks[0].fivesingSongType).toBe('fc');
	});
});

describe('fivesing health gate (fivesing-health wiring)', () => {
	it('search short-circuits to [] without a fetch once the gate is tripped', async () => {
		const fetchMock = mockJsonFetch(SEARCH);
		vi.stubGlobal('fetch', fetchMock);
		fivesingHealth.recordFail();
		fivesingHealth.recordFail();
		fivesingHealth.recordFail();
		expect(fivesingHealth.isGated()).toBe(true);

		const tracks = await fivesing.search('晴天', 1, ac.signal);

		expect(tracks).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('empty list searches are drys — 3 in a row trip the gate (route outage shape)', async () => {
		const fetchMock = mockJsonFetch({ list: [] });
		vi.stubGlobal('fetch', fetchMock);
		for (let i = 0; i < 3; i++) {
			await expect(fivesing.search('nothing', 1, ac.signal)).resolves.toEqual([]);
		}
		expect(fivesingHealth.isGated()).toBe(true);
		await expect(fivesing.search('nothing', 1, ac.signal)).resolves.toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('resolve with a playable tier recordOk; the route failure shape {code:0} recordFails', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(URL_OK));
		const t = await fivesing.resolve(stubTrack(), ac.signal);
		expect(t.audioUrl).toBe('https://fs.example/hq.mp3');
		expect(fivesingHealth.isGated()).toBe(false);

		vi.stubGlobal('fetch', mockJsonFetch({ code: 0, data: {} }));
		for (let i = 0; i < 3; i++) {
			await expect(fivesing.resolve(stubTrack(), ac.signal)).rejects.toThrow(/detail failed/);
		}
		expect(fivesingHealth.isGated()).toBe(true);
	});
});
