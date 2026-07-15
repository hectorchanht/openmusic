import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as searchGet, OPTIONS as searchOptions } from './search/+server';
import { GET as lyricsGet, OPTIONS as lyricsOptions } from './lyrics/+server';
import {
	WEB_REMIX_KEY,
	SEARCH_URL,
	NEXT_URL,
	BROWSE_URL,
	SONGS_FILTER,
	VIDEOS_FILTER
} from '$lib/proxy/ytmusic';

const ORIGIN = 'https://openmusic.lol';

// Minimal RequestEvent stub — the routes only read `url` + `request` (like the audius route).
function ev(path: string, params: Record<string, string>, origin: string | null = ORIGIN) {
	const url = new URL(`https://openmusic.lol${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const headers = new Headers();
	if (origin) headers.set('origin', origin);
	return { url, request: new Request(url, { headers }) };
}
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

describe('GET /api/ytmusic/search — edge InnerTube songs+videos merge (quick-260715-jdj)', () => {
	// Two minimal-but-valid InnerTube shelves with marker videoIds so we can prove the merge order
	// (songs first) and that a videos-only row survives into the merged envelope.
	const SONGS_SHELF = {
		contents: {
			sectionListRenderer: {
				contents: [
					{
						musicShelfRenderer: {
							contents: [{ musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'SONGvid' } } }]
						}
					}
				]
			}
		}
	};
	const VIDEOS_SHELF = {
		contents: {
			sectionListRenderer: {
				contents: [
					{
						musicShelfRenderer: {
							contents: [{ musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'VIDvid' } } }]
						}
					}
				]
			}
		}
	};

	// Route the mocked fetch by which filter chip is in the POST body. A numeric value simulates that
	// filter's upstream returning an HTTP error status; an object is a 200 JSON body.
	function routeByFilter(songs: unknown, videos: unknown) {
		return vi.fn(async (_u: unknown, init?: RequestInit) => {
			const pick = String(init?.body).includes(VIDEOS_FILTER) ? videos : songs;
			if (typeof pick === 'number') return new Response('boom', { status: pick });
			return jsonRes(pick);
		});
	}

	it('POSTs BOTH filters edge-side and merges (songs first); a videos-only id survives, CORS allowlisted', async () => {
		const urls: string[] = [];
		const bodies: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: unknown, init?: RequestInit) => {
				urls.push(String(u));
				const body = String(init?.body);
				bodies.push(body);
				return jsonRes(body.includes(VIDEOS_FILTER) ? VIDEOS_SHELF : SONGS_SHELF);
			})
		);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: '周杰倫' }) as any);
		expect(res.status).toBe(200);

		const merged = (await res.json()) as { ytmusicMerged: unknown[] };
		// SONGS FIRST, then videos — the merge order the client dedupe relies on.
		expect(merged.ytmusicMerged).toEqual([SONGS_SHELF, VIDEOS_SHELF]);
		// The videos-only row is carried through into the merged envelope.
		expect(JSON.stringify(merged)).toContain('VIDvid');

		// Two fixed-URL POSTs to SEARCH_URL; BOTH filters present, query in the body only.
		expect(urls).toEqual([SEARCH_URL, SEARCH_URL]);
		expect(bodies.some((b) => b.includes(SONGS_FILTER))).toBe(true);
		expect(bodies.some((b) => b.includes(VIDEOS_FILTER))).toBe(true);
		expect(bodies.every((b) => b.includes('周杰倫'))).toBe(true);
		// CORS allowlisted for the requesting origin (never '*').
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});

	it('one filter failing still returns the OTHER shelf (songs 500 → videos only)', async () => {
		vi.stubGlobal('fetch', routeByFilter(500, VIDEOS_SHELF));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		expect(res.status).toBe(200);
		const merged = (await res.json()) as { ytmusicMerged: unknown[] };
		expect(merged.ytmusicMerged).toEqual([VIDEOS_SHELF]); // only the successful shelf
	});

	it('one filter failing still returns the OTHER shelf (videos 500 → songs only)', async () => {
		vi.stubGlobal('fetch', routeByFilter(SONGS_SHELF, 500));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		const merged = (await res.json()) as { ytmusicMerged: unknown[] };
		expect(merged.ytmusicMerged).toEqual([SONGS_SHELF]);
	});

	it('BOTH filters failing → empty (shelf-shaped) sentinel, HTTP 200, no throw', async () => {
		vi.stubGlobal('fetch', routeByFilter(500, 503));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		// The shelf-shaped sentinel (so the client parse yields [] instead of contract-drift), NOT a merge.
		expect(JSON.stringify(body)).toContain('musicShelfRenderer');
		expect((body as { ytmusicMerged?: unknown }).ytmusicMerged).toBeUndefined();
	});

	it('empty / whitespace q issues ZERO upstream fetches', async () => {
		const fetchSpy = vi.fn(async () => jsonRes(SONGS_SHELF));
		vi.stubGlobal('fetch', fetchSpy);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: '   ' }) as any);
		expect(res.status).toBe(200);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('never leaks the WEB_REMIX key into the client-facing response body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonRes(SONGS_SHELF))
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		const body = await res.text();
		expect(body).not.toContain(WEB_REMIX_KEY);
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(WEB_REMIX_KEY);
	});

	it('OPTIONS → 204 with allowlisted corsHeaders', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchOptions(ev('/api/ytmusic/search', {}) as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});
});

describe('GET /api/ytmusic/lyrics — next -> browse two-hop', () => {
	const NEXT_WITH_LYRICS = {
		contents: {
			singleColumnMusicWatchNextResultsRenderer: {
				tabbedRenderer: {
					watchNextTabbedResultsRenderer: {
						tabs: [
							{ tabRenderer: { title: 'Up next' } },
							{
								tabRenderer: {
									title: 'Lyrics',
									endpoint: { browseEndpoint: { browseId: 'MPLYtBROWSE' } }
								}
							}
						]
					}
				}
			}
		}
	};
	const NEXT_NO_LYRICS = {
		contents: {
			singleColumnMusicWatchNextResultsRenderer: {
				tabbedRenderer: {
					watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { title: 'Up next' } }] }
				}
			}
		}
	};
	const BROWSE_LYRICS = {
		contents: {
			sectionListRenderer: {
				contents: [
					{
						musicDescriptionShelfRenderer: {
							description: { runs: [{ text: 'la la la' }] },
							footer: { runs: [{ text: 'Source: LyricFind' }] }
						}
					}
				]
			}
		}
	};

	// Route the mocked fetch by the fixed endpoint URL (next vs browse).
	function routeFetch(nextBody: unknown) {
		return vi.fn(async (u: unknown) => {
			const s = String(u);
			if (s === NEXT_URL) return jsonRes(nextBody);
			if (s === BROWSE_URL) return jsonRes(BROWSE_LYRICS);
			throw new Error('unexpected upstream url: ' + s);
		});
	}

	it('a track WITH lyrics returns { text, attribution } via next -> browse', async () => {
		const fetchSpy = routeFetch(NEXT_WITH_LYRICS);
		vi.stubGlobal('fetch', fetchSpy);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await lyricsGet(ev('/api/ytmusic/lyrics', { videoId: 'abc' }) as any);
		const body = (await res.json()) as { text?: string; attribution?: string };
		expect(body.text).toBe('la la la');
		expect(body.attribution).toBe('Source: LyricFind'); // licensor attribution carried
		expect(fetchSpy).toHaveBeenCalledTimes(2); // both hops
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		// key never leaks into the response body
		const raw = JSON.stringify(body);
		expect(raw).not.toContain(WEB_REMIX_KEY);
	});

	it('a track with NO lyrics tab returns {} and issues no browse fetch', async () => {
		const fetchSpy = routeFetch(NEXT_NO_LYRICS);
		vi.stubGlobal('fetch', fetchSpy);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await lyricsGet(ev('/api/ytmusic/lyrics', { videoId: 'abc' }) as any);
		expect(await res.json()).toEqual({});
		expect(fetchSpy).toHaveBeenCalledTimes(1); // next only — no browse hop
	});

	it('empty videoId → {} with no upstream fetch', async () => {
		const fetchSpy = vi.fn(async () => jsonRes({}));
		vi.stubGlobal('fetch', fetchSpy);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await lyricsGet(ev('/api/ytmusic/lyrics', { videoId: '' }) as any);
		expect(await res.json()).toEqual({});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('an upstream error yields {} (never a 500 to the client)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await lyricsGet(ev('/api/ytmusic/lyrics', { videoId: 'abc' }) as any);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
	});

	it('OPTIONS → 204 with allowlisted corsHeaders', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await lyricsOptions(ev('/api/ytmusic/lyrics', {}) as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});
});
