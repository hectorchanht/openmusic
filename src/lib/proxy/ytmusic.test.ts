import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	WEB_REMIX_KEY,
	SONGS_FILTER,
	SEARCH_URL,
	NEXT_URL,
	BROWSE_URL,
	PLAYER_URL,
	WEB_REMIX_CONTEXT,
	innerTubePost,
	getVisitorData,
	findLyricsTab,
	extractLyrics
} from './ytmusic';

// A JSON Response with a chosen status (Response body is single-use — build fresh per call).
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ytmusic edge constants (verified, spikes 005/006/007 — one rotation point)', () => {
	it('exposes the verified WEB_REMIX key + songs filter + endpoint URLs', () => {
		expect(WEB_REMIX_KEY).toBe('AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30');
		expect(SONGS_FILTER).toBe('EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D');
		// URLs carry the key SERVER-side only (never sent to the client).
		expect(SEARCH_URL).toContain(WEB_REMIX_KEY);
		expect(SEARCH_URL).toContain('music.youtube.com/youtubei/v1/search');
		expect(NEXT_URL).toContain('music.youtube.com/youtubei/v1/next');
		expect(BROWSE_URL).toContain('music.youtube.com/youtubei/v1/browse');
		// player endpoint (27-03) lives on www.youtube.com
		expect(PLAYER_URL).toContain('www.youtube.com/youtubei/v1/player');
		expect(WEB_REMIX_CONTEXT.client.clientName).toBe('WEB_REMIX');
	});
});

describe('innerTubePost', () => {
	it('POSTs JSON with InnerTube headers, honors a custom UA header, and returns parsed JSON', async () => {
		let capturedUrl = '';
		let capturedInit: RequestInit | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: unknown, init?: RequestInit) => {
				capturedUrl = String(u);
				capturedInit = init;
				return jsonRes({ ok: 1 });
			})
		);

		const out = await innerTubePost(
			SEARCH_URL,
			{ context: WEB_REMIX_CONTEXT, query: 'x' },
			{ headers: { 'user-agent': 'CustomUA/1.0' } }
		);

		expect(out).toEqual({ ok: 1 });
		expect(capturedUrl).toBe(SEARCH_URL);
		expect(capturedInit?.method).toBe('POST');
		const h = capturedInit?.headers as Record<string, string>;
		expect(h['content-type']).toContain('application/json');
		expect(h['user-agent']).toBe('CustomUA/1.0'); // custom UA honored (27-03 ANDROID_VR path)
		expect(String(capturedInit?.body)).toContain('"query":"x"');
	});

	it('THROWS on a non-OK upstream (caller decides the sentinel) — no leaked key in the message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 }))
		);
		await expect(
			innerTubePost(SEARCH_URL, { context: WEB_REMIX_CONTEXT, query: 'x' })
		).rejects.toThrow();
		// the error message must not carry the query-string (which holds the key)
		try {
			await innerTubePost(SEARCH_URL, { context: WEB_REMIX_CONTEXT, query: 'x' });
		} catch (e) {
			expect(String((e as Error).message)).not.toContain(WEB_REMIX_KEY);
		}
	});
});

describe('getVisitorData (anonymous visitor token — NOT a user credential)', () => {
	it('grabs responseContext.visitorData, caches it (no 2nd fetch), and re-fetches on refresh', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonRes({ responseContext: { visitorData: 'VD_ONE' } }))
			.mockResolvedValueOnce(jsonRes({ responseContext: { visitorData: 'VD_TWO' } }));
		vi.stubGlobal('fetch', fetchSpy);

		// refresh:true forces a clean grab regardless of any leftover module-scope cache.
		const first = await getVisitorData(true);
		expect(first).toBe('VD_ONE');
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// cached: a second (non-refresh) call issues NO fetch.
		const second = await getVisitorData();
		expect(second).toBe('VD_ONE');
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// refresh:true re-fetches (27-03 LOGIN_REQUIRED path).
		const third = await getVisitorData(true);
		expect(third).toBe('VD_TWO');
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('returns null (never throws) when the grab yields no visitorData', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonRes({ responseContext: {} }))
		);
		// refresh:true bypasses any token cached by a prior test.
		const vd = await getVisitorData(true);
		expect(vd).toBeNull();
	});

	it('returns null (never throws) when the grab request fails upstream', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		const vd = await getVisitorData(true);
		expect(vd).toBeNull();
	});
});

describe('findLyricsTab (ported from spike 007)', () => {
	const withLyrics = {
		contents: {
			singleColumnMusicWatchNextResultsRenderer: {
				tabbedRenderer: {
					watchNextTabbedResultsRenderer: {
						tabs: [
							{ tabRenderer: { title: 'Up next' } },
							{
								tabRenderer: {
									title: 'Lyrics',
									endpoint: { browseEndpoint: { browseId: 'MPLYt_LYRICS123' } }
								}
							}
						]
					}
				}
			}
		}
	};

	it('returns the lyrics-tab browseId', () => {
		expect(findLyricsTab(withLyrics)).toEqual({ browseId: 'MPLYt_LYRICS123', disabled: false });
	});

	it('returns {browseId:null,disabled:true} when there is no lyrics tab', () => {
		const noLyrics = {
			contents: {
				singleColumnMusicWatchNextResultsRenderer: {
					tabbedRenderer: {
						watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { title: 'Up next' } }] }
					}
				}
			}
		};
		expect(findLyricsTab(noLyrics)).toEqual({ browseId: null, disabled: true });
	});

	it('treats a present-but-unselectable lyrics tab (no browseId) as disabled', () => {
		const disabledTab = {
			contents: {
				singleColumnMusicWatchNextResultsRenderer: {
					tabbedRenderer: {
						watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { title: 'Lyrics' } }] }
					}
				}
			}
		};
		expect(findLyricsTab(disabledTab)).toEqual({ browseId: null, disabled: true });
	});
});

describe('extractLyrics (ported from spike 007 — plain path)', () => {
	const browseWithLyrics = {
		contents: {
			sectionListRenderer: {
				contents: [
					{
						musicDescriptionShelfRenderer: {
							description: { runs: [{ text: 'line one\n' }, { text: 'line two' }] },
							footer: { runs: [{ text: 'Source: Musixmatch' }] }
						}
					}
				]
			}
		}
	};

	it('joins the description runs into text and carries the footer attribution', () => {
		const r = extractLyrics(browseWithLyrics);
		expect(r.text).toBe('line one\nline two');
		expect(r.attribution).toBe('Source: Musixmatch');
	});

	it('returns {text:null,attribution:null} when the shelf is missing', () => {
		expect(extractLyrics({ contents: {} })).toEqual({ text: null, attribution: null });
	});
});
