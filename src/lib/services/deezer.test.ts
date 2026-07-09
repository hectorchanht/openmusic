import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	buildDeezerSearchUrl,
	deezerSongCover,
	deezerArtistCover,
	deezerArtist,
	deezerAlbum,
	deezerArtistAlbums
} from './deezer';
import { __clearSearchCache } from './ttl-cache';

// deezer.ts (quick-260606-wv8) is the thin, never-throws client that fetches the
// OWN-ORIGIN /api/deezer/search proxy (NOT api.deezer.com directly — the browser fetch to
// Deezer is CORS-blocked). It mirrors the prior cover client's never-throws + AbortSignal contract:
// a miss → null → the caller's gradient. These tests pin the URL build/encoding, the
// song/artist resolve, the empty-term + already-aborted-signal (no fetch) short-circuits,
// and the non-ok / null-field / malformed-JSON / fetch-throws → null paths — all node-
// runnable via vi.stubGlobal('fetch', ...) (NO live network).

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	// deezerArtist/deezerAlbum memoize via cached(); clear between cases so a prior
	// (possibly null) result for the same name does not leak into the next test.
	__clearSearchCache();
});

/** A minimal `Response`-like ok JSON stub. */
function jsonResponse(body: unknown, ok = true): Response {
	// deezer.ts now fetches through the governed apiFetch, whose GET dedupe calls resp.clone() — so a
	// mock Response MUST expose clone() (self-returning: the mock body is read-only in these tests).
	const make = (): Response =>
		({ ok, status: ok ? 200 : 500, json: async () => body, clone: make }) as unknown as Response;
	return make();
}

const COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';
const PIC = 'https://cdn-images.dzcdn.net/images/artist/def/1000x1000-000000-80-0-0.jpg';

describe('buildDeezerSearchUrl — own-origin URL build + encoding', () => {
	it('builds /api/deezer/search?q=... pointed at the own-origin proxy', () => {
		const url = buildDeezerSearchUrl('Jay Chou Simple Love');
		expect(url.startsWith('/api/deezer/search?')).toBe(true);
		// q round-trips via URLSearchParams parsing.
		const params = new URLSearchParams(url.split('?')[1]);
		expect(params.get('q')).toBe('Jay Chou Simple Love');
	});

	it('encodes special chars in q (no raw spaces / & / / leak)', () => {
		const url = buildDeezerSearchUrl('A&B C/D');
		expect(url).not.toContain(' ');
		const params = new URLSearchParams(url.split('?')[1]);
		expect(params.get('q')).toBe('A&B C/D');
	});

	it('does NOT point at api.deezer.com (must go through the proxy for CORS)', () => {
		expect(buildDeezerSearchUrl('x')).not.toContain('api.deezer.com');
	});
});

describe('deezerSongCover — resolve cover via the proxy', () => {
	it('fetches the proxy for `${artist} ${title}` and returns .cover', async () => {
		const fetchMock = vi.fn(async (_url: string) =>
			jsonResponse({ cover: COVER, artistPicture: PIC })
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerSongCover('Jay Chou', 'Simple Love');
		expect(out).toBe(COVER);
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called.startsWith('/api/deezer/search?')).toBe(true);
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('Jay Chou Simple Love');
	});

	it('returns null on an empty term (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ cover: COVER }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerSongCover('', '')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ cover: COVER }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerSongCover('X', 'Y', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: COVER }, false)));
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null when the proxy returns { cover: null }', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: null, artistPicture: null })));
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null on malformed JSON (json() throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						json: async () => {
							throw new Error('bad json');
						},
						clone() {
							return this;
						}
					}) as unknown as Response
			)
		);
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerSongCover('X', 'Y')).resolves.toBeNull();
	});
});

describe('deezerArtistCover — resolve artist picture via the proxy', () => {
	it('fetches the proxy for the artist name and returns .artistPicture', async () => {
		const fetchMock = vi.fn(async (_url: string) =>
			jsonResponse({ cover: COVER, artistPicture: PIC })
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerArtistCover('Taylor Swift');
		expect(out).toBe(PIC);
		const called = String(fetchMock.mock.calls[0][0]);
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('Taylor Swift');
	});

	it('returns null on an empty artist (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ artistPicture: PIC }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtistCover('   ')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ artistPicture: PIC }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerArtistCover('X', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null when the proxy returns { artistPicture: null }', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ cover: COVER, artistPicture: null })));
		await expect(deezerArtistCover('X')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerArtistCover('X')).resolves.toBeNull();
	});
});

// ---- Phase 17, ENRICH-04 — deezerArtist / deezerAlbum info enrichment client fns ----------
// These mirror the cover-client never-throws + own-origin contract: a miss → null → the
// page's Deezer section is silently absent (D-14). Pin the own-origin /api/deezer/* path +
// encoded params, the empty-arg + already-aborted short-circuits, and the non-ok / fetch-throws
// → null paths — all node-runnable via vi.stubGlobal('fetch', ...) (NO live network).

const ARTIST_INFO = { picture: 'https://cdn-images.dzcdn.net/images/artist/x/1000x1000.jpg', fans: 5160298, albums: 36 };
const ALBUM_INFO = {
	cover: 'https://cdn-images.dzcdn.net/images/cover/y/1000x1000.jpg',
	releaseDate: '2001-03-07',
	tracks: 14,
	fans: 333926,
	label: 'Virgin',
	genres: ['Electro'],
	duration: 3662
};

describe('deezerArtist — resolve artist info via the own-origin proxy', () => {
	it('fetches /api/deezer/artist?name=<encoded> and returns the reshape', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ARTIST_INFO));
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerArtist('Daft Punk');
		expect(out).toEqual(ARTIST_INFO);
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called.startsWith('/api/deezer/artist?')).toBe(true);
		// Never api.deezer.com directly (CORS / no-key posture).
		expect(called).not.toContain('api.deezer.com');
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('name')).toBe('Daft Punk');
	});

	it('encodes special chars in name (no raw spaces / & leak)', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ARTIST_INFO));
		vi.stubGlobal('fetch', fetchMock);
		await deezerArtist('A&B Band');
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called).not.toContain(' ');
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('name')).toBe('A&B Band');
	});

	it('returns null on an empty name (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ARTIST_INFO));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtist('   ')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ARTIST_INFO));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerArtist('Aborted Artist', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on a non-ok response (never throws)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ARTIST_INFO, false)));
		await expect(deezerArtist('NonOk Artist')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerArtist('Throwing Artist')).resolves.toBeNull();
	});

	it('returns null on malformed JSON (json() throws — never throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						json: async () => {
							throw new Error('bad json');
						},
						clone() {
							return this;
						}
					}) as unknown as Response
			)
		);
		await expect(deezerArtist('Malformed Artist')).resolves.toBeNull();
	});
});

describe('deezerAlbum — resolve album info via the own-origin proxy', () => {
	it('fetches /api/deezer/album?title=&artist= and returns the reshape', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ALBUM_INFO));
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerAlbum('Discovery', 'Daft Punk');
		expect(out).toEqual(ALBUM_INFO);
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called.startsWith('/api/deezer/album?')).toBe(true);
		expect(called).not.toContain('api.deezer.com');
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('title')).toBe('Discovery');
		expect(params.get('artist')).toBe('Daft Punk');
	});

	it('omits the artist param when no artist is given', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ALBUM_INFO));
		vi.stubGlobal('fetch', fetchMock);
		await deezerAlbum('LonelyAlbum');
		const called = String(fetchMock.mock.calls[0][0]);
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('title')).toBe('LonelyAlbum');
		expect(params.has('artist')).toBe(false);
	});

	it('returns null on an empty title (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ALBUM_INFO));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerAlbum('   ', 'Someone')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ALBUM_INFO));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerAlbum('Aborted Album', 'X', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on a non-ok response (never throws)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ALBUM_INFO, false)));
		await expect(deezerAlbum('NonOk Album', 'X')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerAlbum('Throwing Album', 'X')).resolves.toBeNull();
	});
});

// ---- WR-03 / T-17-13 — transient failures are NEVER negative-cached -----------------------
// The failure→null/[] sentinel mapping lives OUTSIDE cached(): a timeout/non-ok/abort REJECTS
// inside the factory (nothing stored), so the very next call re-fetches instead of serving a
// pinned "no result" for the 7-day TTL. A SUCCESSFUL response (even with null fields) IS cached.

describe('WR-03 — failed Deezer lookups retry on the next call (no negative caching)', () => {
	it('deezerArtist: a non-ok response is not cached — the next call refetches and succeeds', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({}, false)) // first call: upstream 500 → null
			.mockResolvedValueOnce(jsonResponse(ARTIST_INFO)); // second call: healthy again
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtist('Flaky Artist')).resolves.toBeNull();
		await expect(deezerArtist('Flaky Artist')).resolves.toEqual(ARTIST_INFO);
		expect(fetchMock).toHaveBeenCalledTimes(2); // second call hit the network (no pinned null)
	});

	it('deezerAlbum: a thrown fetch (timeout/abort) is not cached — the next call refetches', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('aborted'))
			.mockResolvedValueOnce(jsonResponse(ALBUM_INFO));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerAlbum('Flaky Album', 'X')).resolves.toBeNull();
		await expect(deezerAlbum('Flaky Album', 'X')).resolves.toEqual(ALBUM_INFO);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('deezerSongCover: a SUCCESSFUL { cover: null } answer IS cached (genuine miss, no refetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ cover: null, artistPicture: null }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerSongCover('A', 'T')).resolves.toBeNull();
		await expect(deezerSongCover('A', 'T')).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1); // a real answer is memoized; only failures retry
	});
});

// ---- Phase 23, ART-01 / D-19 — deezerArtistAlbums (artist-albums list with nb_tracks) -------
// Mirrors the never-throws + own-origin + cached() + WR-03 posture of the other Deezer client
// fns: success → reshaped { title, nb_tracks, cover } array; any failure/abort/malformed → []
// (never throws), and that failure is NOT negative-cached (rejects inside the cached factory).

const ARTIST_ALBUMS = {
	data: [
		{ title: 'Discovery', nb_tracks: 14, cover: 'https://cdn-images.dzcdn.net/images/cover/a/1000x1000.jpg' },
		{ title: 'Homework', nb_tracks: 16, cover: 'https://cdn-images.dzcdn.net/images/cover/b/1000x1000.jpg' }
	]
};

describe('deezerArtistAlbums — resolve an artist album list (with nb_tracks) via the own-origin proxy', () => {
	it('fetches /api/deezer/artist-albums?q=<encoded> and returns the reshaped array', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ARTIST_ALBUMS));
		vi.stubGlobal('fetch', fetchMock);

		const out = await deezerArtistAlbums('Daft Punk');
		expect(out).toEqual(ARTIST_ALBUMS.data);
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called.startsWith('/api/deezer/artist-albums?')).toBe(true);
		// Never api.deezer.com directly (CORS / no-key posture).
		expect(called).not.toContain('api.deezer.com');
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('Daft Punk');
		// Each reshaped album carries nb_tracks (D-19).
		expect(out[0].nb_tracks).toBe(14);
	});

	it('encodes special chars in the name (no raw spaces / & leak)', async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(ARTIST_ALBUMS));
		vi.stubGlobal('fetch', fetchMock);
		await deezerArtistAlbums('A&B Band');
		const called = String(fetchMock.mock.calls[0][0]);
		expect(called).not.toContain(' ');
		const params = new URLSearchParams(called.split('?')[1]);
		expect(params.get('q')).toBe('A&B Band');
	});

	it('returns [] on an empty name (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ARTIST_ALBUMS));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtistAlbums('   ')).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns [] immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(ARTIST_ALBUMS));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(deezerArtistAlbums('Aborted Artist', ac.signal)).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns [] on a non-ok response (never throws)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ARTIST_ALBUMS, false)));
		await expect(deezerArtistAlbums('NonOk Artist')).resolves.toEqual([]);
	});

	it('returns [] (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(deezerArtistAlbums('Throwing Artist')).resolves.toEqual([]);
	});

	it('returns [] on malformed JSON (json() throws — never throws)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						json: async () => {
							throw new Error('bad json');
						},
						clone() {
							return this;
						}
					}) as unknown as Response
			)
		);
		await expect(deezerArtistAlbums('Malformed Artist')).resolves.toEqual([]);
	});

	it('a SUCCESSFUL empty ({ data: [] }) result IS cached (genuine miss, no refetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtistAlbums('Empty Artist')).resolves.toEqual([]);
		await expect(deezerArtistAlbums('Empty Artist')).resolves.toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1); // a real answer is memoized; only failures retry
	});

	it('WR-03: a failed lookup is NOT cached — the next call refetches and succeeds', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({}, false)) // first call: upstream 500 → []
			.mockResolvedValueOnce(jsonResponse(ARTIST_ALBUMS)); // second call: healthy again
		vi.stubGlobal('fetch', fetchMock);
		await expect(deezerArtistAlbums('Flaky Artist')).resolves.toEqual([]);
		await expect(deezerArtistAlbums('Flaky Artist')).resolves.toEqual(ARTIST_ALBUMS.data);
		expect(fetchMock).toHaveBeenCalledTimes(2); // second call hit the network (no pinned [])
	});
});
