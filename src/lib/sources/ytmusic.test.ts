import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ytmusic } from './ytmusic';
import { __resetGovernor } from '../services/api-base';
// A REAL captured InnerTube WEB_REMIX songs-filter envelope (query "周杰倫 稻香"), trimmed to the
// shelf + first 4 rows with the parse-irrelevant menu/trackingParams stripped (spike 005 capture).
import fixture from './__fixtures__/ytmusic-search.json';

const ac = new AbortController();

// Mirror audius.test.ts: stub the GLOBAL fetch (apiFetch → governor → fetch) with a JSON Response.
function mockFetch(body: unknown, contentType = 'application/json') {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': contentType }
		});
	});
}

beforeEach(() => {
	__resetGovernor(); // no inflight-dedupe / breaker state leaking across tests
	vi.restoreAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('ytmusic.search — parse over the captured InnerTube fixture (YT-SEARCH-01)', () => {
	it('parses the fixture shelf into ≥1 Track stub, all with a videoId==songid and colon uid', async () => {
		vi.stubGlobal('fetch', mockFetch(fixture));

		const tracks = await ytmusic.search('周杰倫 稻香', 1, ac.signal);

		expect(tracks.length).toBeGreaterThanOrEqual(1);
		for (const t of tracks) {
			expect(t.source).toBe('ytmusic');
			expect(t.songid).toBeTruthy(); // non-null videoId
			expect(t.uid).toBe('ytmusic:' + t.songid); // COLON form, songid = videoId
			expect(t.title).toBeTruthy();
			expect(t.cover).toBeTruthy(); // resizable thumbnail always present (27-CONTEXT)
			expect(t.cover).toMatch(/^https:\/\//);
			expect(t.audioUrl).toBeNull(); // stub — resolve() stamps the URL later
			expect(t.detailsLoaded).toBe(false);
			expect(t.keyword).toBe('周杰倫 稻香');
		}
		// 1-based displayIndex, in order.
		expect(tracks.map((t) => t.displayIndex)).toEqual(tracks.map((_, i) => i + 1));
	});

	it('is CJK-safe — the top row parses 稻香 / 周杰倫 / 魔杰座 with no mojibake', async () => {
		vi.stubGlobal('fetch', mockFetch(fixture));

		const tracks = await ytmusic.search('周杰倫 稻香', 1, ac.signal);
		const top = tracks[0];
		expect(top.title).toBe('稻香');
		// artist/album are disambiguated by each run's browseEndpoint pageType (ARTIST vs ALBUM).
		expect(top.artist).toBe('周杰倫');
		expect(top.album).toBe('魔杰座');
		expect(top.songid).toBe('l6a5D6yxqEU');
		expect(top.uid).toBe('ytmusic:l6a5D6yxqEU');
		// duration parsed from the m:ss run (3:44 → 224s).
		expect(top.duration).toBe(224);
	});

	it('hits /api/ytmusic/search with the encoded query', async () => {
		const spy = mockFetch({ contents: {} }); // empty (no shelf) — we only assert the URL here
		vi.stubGlobal('fetch', spy);

		// Empty envelope has no shelf → contract-drift throw; catch so we can still assert the URL.
		await ytmusic.search('周杰倫 hi', 1, ac.signal).catch(() => {});

		expect(spy).toHaveBeenCalled();
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toBe('/api/ytmusic/search?q=' + encodeURIComponent('周杰倫 hi'));
	});

	it('returns [] for page > 1 with NO upstream call (single shelf, no pagination — audius rule)', async () => {
		const spy = mockFetch(fixture);
		vi.stubGlobal('fetch', spy);

		const tracks = await ytmusic.search('x', 2, ac.signal);
		expect(tracks).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('SKIPS rows with no resolvable videoId (never emits a null-uid Track)', async () => {
		// One good row (overlay videoId) + one row with no videoId anywhere → only the good one emits.
		const goodRow = {
			musicResponsiveListItemRenderer: {
				overlay: {
					musicItemThumbnailOverlayRenderer: {
						content: {
							musicPlayButtonRenderer: {
								playNavigationEndpoint: { watchEndpoint: { videoId: 'GOODvid' } }
							}
						}
					}
				},
				thumbnail: {
					musicThumbnailRenderer: {
						thumbnail: { thumbnails: [{ url: 'https://x/1.jpg', width: 60, height: 60 }] }
					}
				},
				flexColumns: [
					{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Good' }] } } }
				]
			}
		};
		const noIdRow = {
			musicResponsiveListItemRenderer: {
				flexColumns: [
					{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Orphan' }] } } }
				]
			}
		};
		const envelope = {
			contents: {
				sectionListRenderer: {
					contents: [{ musicShelfRenderer: { contents: [goodRow, noIdRow] } }]
				}
			}
		};
		vi.stubGlobal('fetch', mockFetch(envelope));

		const tracks = await ytmusic.search('x', 1, ac.signal);
		expect(tracks.length).toBe(1);
		expect(tracks[0].songid).toBe('GOODvid');
		expect(tracks.every((t) => t.songid)).toBe(true);
	});

	it('THROWS a typed contract-drift error on an envelope with no search shelf', async () => {
		vi.stubGlobal('fetch', mockFetch({ contents: { somethingElse: true } }));
		await expect(ytmusic.search('x', 1, ac.signal)).rejects.toThrow(/ytmusic: contract-drift/);
	});

	it('THROWS on a null / non-object body (contract-drift)', async () => {
		vi.stubGlobal('fetch', mockFetch('null'));
		await expect(ytmusic.search('x', 1, ac.signal)).rejects.toThrow(/ytmusic: contract-drift/);
	});
});
