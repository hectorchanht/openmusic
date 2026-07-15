import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ytmusic } from './ytmusic';
import { makeUid, type Track } from './types';
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

	it('parses a VIDEO-ONLY row from the merged Videos shelf into a ytmusic Track (quick-260715-jdj)', async () => {
		vi.stubGlobal('fetch', mockFetch(fixture));

		const tracks = await ytmusic.search('周杰倫 稻香', 1, ac.signal);
		// dUlAfTZkjpE (港耆) lives ONLY in the Videos shelf — the whole reason for the songs+videos merge.
		const videoOnly = tracks.find((t) => t.songid === 'dUlAfTZkjpE');
		expect(videoOnly).toBeTruthy();
		expect(videoOnly?.uid).toBe('ytmusic:dUlAfTZkjpE');
		expect(videoOnly?.title).toBe('港耆');
		expect(videoOnly?.artist).toBe('摩四老年');
	});

	it('dedupes a videoId present in BOTH shelves — emitted once, songs variant wins (quick-260715-jdj)', async () => {
		vi.stubGlobal('fetch', mockFetch(fixture));

		const tracks = await ytmusic.search('周杰倫 稻香', 1, ac.signal);
		// l6a5D6yxqEU is in the Songs shelf (top row) AND duplicated in the Videos shelf.
		const dupes = tracks.filter((t) => t.songid === 'l6a5D6yxqEU');
		expect(dupes.length).toBe(1); // emitted ONCE despite appearing in both shelves
		// The SONGS variant (walked first) won the slot — it carries the album the video row lacks.
		expect(dupes[0].album).toBe('魔杰座');
		expect(dupes[0].title).toBe('稻香');
	});

	it('walks the merged { ytmusicMerged: [songsJson, videosJson] } route shape (quick-260715-jdj)', async () => {
		// The route returns a wrapper array of two envelopes; the recursive walk collects every
		// wrapped shelf, and dedupe keeps the songs variant (first) when a videoId repeats.
		const shelfWith = (videoId: string, title: string) => ({
			contents: {
				sectionListRenderer: {
					contents: [
						{
							musicShelfRenderer: {
								contents: [
									{
										musicResponsiveListItemRenderer: {
											thumbnail: {
												musicThumbnailRenderer: {
													thumbnail: { thumbnails: [{ url: 'https://x/1.jpg', width: 60, height: 60 }] }
												}
											},
											playlistItemData: { videoId },
											flexColumns: [
												{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } }
											]
										}
									}
								]
							}
						}
					]
				}
			}
		});
		const songsJson = shelfWith('SHAREDvid', 'From Songs');
		const videosJson = {
			contents: {
				sectionListRenderer: {
					contents: [shelfWith('VIDEOvid', 'Video Only').contents.sectionListRenderer.contents[0]]
				}
			}
		};
		// videosJson also repeats SHAREDvid to prove cross-envelope dedupe.
		videosJson.contents.sectionListRenderer.contents.push(
			shelfWith('SHAREDvid', 'From Videos').contents.sectionListRenderer.contents[0]
		);
		vi.stubGlobal('fetch', mockFetch({ ytmusicMerged: [songsJson, videosJson] }));

		const tracks = await ytmusic.search('x', 1, ac.signal);
		expect(tracks.map((t) => t.songid).sort()).toEqual(['SHAREDvid', 'VIDEOvid']);
		// SHAREDvid emitted once, from the SONGS envelope (walked first).
		expect(tracks.find((t) => t.songid === 'SHAREDvid')?.title).toBe('From Songs');
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

// A resolve()-input stub, exactly the shape search() emits (Plan 27-01) — audioUrl/lrc null,
// detailsLoaded false; resolve() stamps the deterministic stream URL + best-effort plain lyrics.
function stubTrack(songid: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid('ytmusic', songid),
		source: 'ytmusic',
		songid,
		title: 'Some Song',
		artist: 'Some Artist',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

describe('ytmusic.resolve — deterministic stream stamp + best-effort plain lyrics (YT-LYRICS-01, 27-04)', () => {
	it('stamps the /api/ytmusic/stream/<songid> audioUrl + itag-140 quality, detailsLoaded true', async () => {
		// Lyrics fetch returns nothing meaningful — the stream stamp must still land.
		vi.stubGlobal('fetch', mockFetch({}));
		const out = await ytmusic.resolve(stubTrack('abc123'), new AbortController().signal);

		expect(out.audioUrl).toBe('/api/ytmusic/stream/abc123');
		expect(out.audioUrl?.endsWith('/api/ytmusic/stream/abc123')).toBe(true);
		expect(out.detailsLoaded).toBe(true);
		expect(out.quality).toBeTruthy();
		expect(out.qualityLabel).toBeTruthy();
		expect(out.lrcUrl).toBeNull(); // YTM has no separate timed-lyric URL — never set lrcUrl
	});

	it('populates track.lrc from a { text } lyrics payload (plain lyrics, spike 007 tier 1)', async () => {
		const spy = mockFetch({ text: 'line one\nline two', attribution: 'Musixmatch' });
		vi.stubGlobal('fetch', spy);

		const out = await ytmusic.resolve(stubTrack('vid42'), new AbortController().signal);

		expect(out.lrc).toBe('line one\nline two');
		expect(out.audioUrl).toBe('/api/ytmusic/stream/vid42');
		// The plain-lyrics fetch hit /api/ytmusic/lyrics with the encoded videoId.
		const calledUrl = String(spy.mock.calls[0][0]);
		expect(calledUrl).toBe('/api/ytmusic/lyrics?videoId=' + encodeURIComponent('vid42'));
	});

	it('leaves lrc null on an EMPTY-text lyrics payload (routes to the timed crossSourceLyric fallback)', async () => {
		vi.stubGlobal('fetch', mockFetch({ text: '   ', attribution: 'Musixmatch' }));
		const out = await ytmusic.resolve(stubTrack('vid43'), new AbortController().signal);

		expect(out.lrc).toBeNull();
		expect(out.audioUrl).toBe('/api/ytmusic/stream/vid43'); // still resolved
	});

	it('NEVER throws on a rejected lyrics fetch — lrc stays null, audioUrl still stamped', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('lyrics upstream 500');
			})
		);
		const out = await ytmusic.resolve(stubTrack('vid44'), new AbortController().signal);

		expect(out.lrc).toBeNull();
		expect(out.audioUrl).toBe('/api/ytmusic/stream/vid44');
		expect(out.detailsLoaded).toBe(true);
	});

	it('honors an aborted signal without throwing (superseded resolve bails, lrc null, audioUrl set)', async () => {
		const ac2 = new AbortController();
		ac2.abort();
		// apiFetch rejects immediately on an already-aborted signal; the best-effort catch swallows it.
		const out = await ytmusic.resolve(stubTrack('vid45'), ac2.signal);

		expect(out.lrc).toBeNull();
		expect(out.audioUrl).toBe('/api/ytmusic/stream/vid45');
	});
});
