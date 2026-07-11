import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { netease, extractLrcFromJson, extractLrcFromBody } from './netease';
import type { Track } from './types';
import fixture from './__fixtures__/netease.search.json';
import { neteaseHealth, DRY_THRESHOLD } from '../services/netease-health';
import { __resetGovernor } from '../services/api-base';

const ac = new AbortController();

function mockFetchOnce(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': contentType }
		});
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
	// Reset the module-scope health gate + fetch governor so state never leaks across cases (a
	// prior case that trips the gate would otherwise short-circuit a later search to []).
	neteaseHealth.__reset();
	__resetGovernor();
});
afterEach(() => {
	vi.restoreAllMocks();
	neteaseHealth.__reset();
	__resetGovernor();
});

describe('netease.search (fixture-backed)', () => {
	// Test 1: normalization — colon uid, source, audioUrl+lrcUrl populated, songid from ?id=.
	it('normalizes the recorded search fixture into canonical Track[]', async () => {
		vi.stubGlobal('fetch', mockFetchOnce(fixture));

		const tracks = await netease.search('周杰伦', 1, ac.signal);

		expect(tracks.length).toBe(fixture.length);
		const first = tracks[0];
		// songid extracted from the audio url's ?id= param
		const expectedId = new URL(fixture[0].url).searchParams.get('id')!;
		expect(first.songid).toBe(expectedId);
		// canonical COLON-form uid (D-10)
		expect(first.uid).toBe(`netease:${expectedId}`);
		expect(first.source).toBe('netease');
		// Netease returns audioUrl + lrcUrl at SEARCH time
		expect(first.audioUrl).toBe(fixture[0].url);
		expect(first.lrcUrl).toBe(fixture[0].lrc);
		expect(first.cover).toBe(fixture[0].pic);
		expect(first.title).toBe(fixture[0].name);
		expect(first.keyword).toBe('周杰伦');
		expect(first.displayIndex).toBe(1);
		expect(first.detailsLoaded).toBe(false);
	});

	it('hits the same-origin proxy /api/netease/search with id + limit', async () => {
		const spy = mockFetchOnce(fixture);
		vi.stubGlobal('fetch', spy);

		await netease.search('hello', 2, ac.signal);

		expect(spy).toHaveBeenCalled();
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toMatch(/^\/api\/netease\/search\?/);
		expect(calledUrl).toContain('id=hello');
		// page=2 → requestLimit = 2 * 10 = 20 (limit-multiplication pagination)
		expect(calledUrl).toContain('limit=20');
	});

	// Test 3: failure isolation — non-array body THROWS (not swallow-and-return-0).
	it('THROWS on a non-array (contract-drift) body', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ error: 'nope' }));
		await expect(netease.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});
});

describe('netease.resolve', () => {
	function stubTrack(): Track {
		return {
			uid: 'netease:509781655',
			source: 'netease',
			songid: '509781655',
			title: '想你就写信',
			artist: '周杰伦',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1
		};
	}

	// Test 2: resolve sets audioUrl + lrc (sniffed) + quality + detailsLoaded.
	it('sets audioUrl/lrcUrl, fetches a plain-text LRC, infers quality, marks loaded', async () => {
		const lrcText = '[00:01.00]line one\n[00:12.00]line two';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(lrcText, { status: 200, headers: { 'content-type': 'text/plain' } }))
		);

		const track = stubTrack();
		const out = await netease.resolve(track, ac.signal);

		expect(out.audioUrl).toBe('/api/netease/url?id=509781655');
		expect(out.lrcUrl).toBe('/api/netease/lrc?id=509781655');
		expect(out.lrc).toBe(lrcText);
		// audioUrl ends in no lossless ext → 320K
		expect(out.quality).toBe('320k');
		expect(out.qualityLabel).toBe('320K');
		expect(out.detailsLoaded).toBe(true);
	});

	it('content-type-sniffs a JSON-wrapped LRC body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ lrc: '[00:00.00]json-wrapped' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
			)
		);

		const out = await netease.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe('[00:00.00]json-wrapped');
		expect(out.detailsLoaded).toBe(true);
	});

	// quick-260629-nyl Task 3 regression: the live upstream now returns PLAIN LRC text with an
	// intermittent/absent Content-Type, which the proxy defaults to `application/json`. The OLD
	// header-sniff then called lr.json() on plain text → threw → "No lyrics". The fix is
	// content-type-independent (read text, try JSON, fall back to text), so a plain LRC body
	// MISLABELED application/json must now still yield the lyrics.
	it('extracts a plain-text LRC body even when mislabeled application/json (regression fix)', async () => {
		const lrcText = '[00:00.000] 作词 : 林秋离\n[00:37.010] 风到这里就是粘';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(lrcText, {
						status: 200,
						// proxy default-to-json when the upstream omits the header — the regression trigger
						headers: { 'content-type': 'application/json' }
					})
			)
		);

		const out = await netease.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe(lrcText);
		expect(out.detailsLoaded).toBe(true);
	});

	it('extracts a plain-text LRC body with NO content-type header at all', async () => {
		const lrcText = '[00:01.00]line one\n[00:12.00]line two';
		vi.stubGlobal('fetch', vi.fn(async () => new Response(lrcText, { status: 200 })));
		const out = await netease.resolve(stubTrack(), ac.signal);
		expect(out.lrc).toBe(lrcText);
	});
});

describe('netease extractLrcFromBody / extractLrcFromJson (shape-tolerant, never-throw)', () => {
	it('returns a plain-text LRC body as-is (current upstream shape)', () => {
		const lrc = '[00:01.00]line one\n[00:12.00]line two';
		expect(extractLrcFromBody(lrc)).toBe(lrc);
	});

	it('extracts from a json-wrapped {lrc} body (old shape)', () => {
		expect(extractLrcFromBody(JSON.stringify({ lrc: '[00:00.00]old' }))).toBe('[00:00.00]old');
	});

	it('returns null on an empty / whitespace body (true miss)', () => {
		expect(extractLrcFromBody('')).toBeNull();
		expect(extractLrcFromBody('   \n  ')).toBeNull();
	});

	it('returns null when JSON parses but carries no lyric (e.g. {error})', () => {
		expect(extractLrcFromBody(JSON.stringify({ error: 'not found' }))).toBeNull();
		expect(extractLrcFromBody('{}')).toBeNull();
	});

	it('extractLrcFromJson reads the existing keys (old shapes)', () => {
		expect(extractLrcFromJson({ lrc: 'A' })).toBe('A');
		expect(extractLrcFromJson({ lyric: 'B' })).toBe('B');
		expect(extractLrcFromJson({ data: { lrc: 'C' } })).toBe('C');
		expect(extractLrcFromJson({ data: { lyric: 'D' } })).toBe('D');
		expect(extractLrcFromJson({ data: 'E' })).toBe('E');
		expect(extractLrcFromJson('F')).toBe('F');
	});

	it('extractLrcFromJson reads a NESTED lyric object (new shape)', () => {
		expect(extractLrcFromJson({ lyric: { lyric: '[00:00.00]nested' } })).toBe('[00:00.00]nested');
		expect(extractLrcFromJson({ lrc: { lrc: '[00:01.00]nested2' } })).toBe('[00:01.00]nested2');
	});

	it('extractLrcFromJson joins a lines[] array of {time,text} into LRC text (new shape)', () => {
		const out = extractLrcFromJson({
			lines: [
				{ time: 0, text: 'first' },
				{ time: 61.5, text: 'second' }
			]
		});
		expect(out).toContain('[00:00.00]first');
		expect(out).toContain('[01:01.50]second');
	});

	it('extractLrcFromJson treats ms timestamps as ms (lines[] with timestamp)', () => {
		const out = extractLrcFromJson({ lrclist: [{ timestamp: 61500, lyric: 'x' }] });
		expect(out).toBe('[01:01.50]x');
	});

	it('extractLrcFromJson returns null on a genuine no-lyric body', () => {
		expect(extractLrcFromJson({})).toBeNull();
		expect(extractLrcFromJson({ data: {} })).toBeNull();
		expect(extractLrcFromJson(null)).toBeNull();
		expect(extractLrcFromJson(42)).toBeNull();
	});
});

describe('netease.search health-gate (Plan 26-05, NETEASE-01)', () => {
	it('short-circuits to [] WITHOUT calling apiFetch once a dry run trips the gate', async () => {
		// A "dry" upstream: every call returns an empty array (spikes 001/004 behavior).
		const spy = mockFetchOnce([]);
		vi.stubGlobal('fetch', spy);

		// DRY_THRESHOLD live dry searches hit the upstream, return [], and trip the gate.
		for (let i = 0; i < DRY_THRESHOLD; i++) {
			const out = await netease.search('anything', 1, ac.signal);
			expect(out).toEqual([]);
		}
		expect(spy).toHaveBeenCalledTimes(DRY_THRESHOLD);
		expect(neteaseHealth.isGated()).toBe(true);

		// The NEXT search must SHORT-CIRCUIT: still [] but NO new upstream fetch.
		spy.mockClear();
		const gatedOut = await netease.search('anything', 1, ac.signal);
		expect(gatedOut).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('records ok on a non-empty result so a subsequent search still hits the upstream (gate cleared)', async () => {
		// Two drys — below the threshold of 3, so the gate is NOT yet tripped.
		vi.stubGlobal('fetch', mockFetchOnce([]));
		await netease.search('x', 1, ac.signal);
		await netease.search('x', 1, ac.signal);
		expect(neteaseHealth.isGated()).toBe(false);

		// A non-empty result records ok → resets the accumulated dry streak.
		const live = mockFetchOnce(fixture);
		vi.stubGlobal('fetch', live);
		const out = await netease.search('周杰伦', 1, ac.signal);
		expect(live).toHaveBeenCalled();
		expect(out.length).toBe(fixture.length);
		expect(neteaseHealth.isGated()).toBe(false);

		// One more dry after the ok must NOT trip (the streak was reset), so the upstream is still hit.
		const after = mockFetchOnce([]);
		vi.stubGlobal('fetch', after);
		await netease.search('x', 1, ac.signal);
		expect(after).toHaveBeenCalled();
		expect(neteaseHealth.isGated()).toBe(false);
	});

	it('a non-array (contract-drift) body still THROWS and is NOT recorded as dry', async () => {
		vi.stubGlobal('fetch', mockFetchOnce({ error: 'nope' }));
		// Even repeated drift throws must never trip the DRY gate — drift ≠ dry spell.
		for (let i = 0; i < DRY_THRESHOLD + 1; i++) {
			await expect(netease.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
		}
		expect(neteaseHealth.isGated()).toBe(false);
	});
});
