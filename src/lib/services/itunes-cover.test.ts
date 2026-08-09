import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildItunesSearchUrl,
	upgradeArtwork,
	itunesSongCover,
	itunesArtistCover,
	itunesArtworkKey,
	recallItunesId
} from './itunes-cover';

// itunes-cover (quick-260606-v7k) is the no-auth, CORS-open Western-catalog + artist
// fallback cover SOURCE. It only BUILDS the iTunes Search URL and does a bounded fetch;
// every network path NEVER throws (a miss → null → the caller's gradient). These tests
// pin the URL shape + encoding, the 100→600 artwork upgrade, the results[0] selection,
// the song + artist resolve paths, and the never-throws / abort contract — all
// node-runnable via vi.stubGlobal('fetch', ...) like discovery.test.ts (NO live network).

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/** A minimal `Response`-like ok JSON stub. */
function jsonResponse(body: unknown, ok = true): Response {
	return {
		ok,
		json: async () => body
	} as unknown as Response;
}

describe('buildItunesSearchUrl — URL build + encoding', () => {
	it('builds an itunes.apple.com/search URL with term, entity and limit=1', () => {
		const url = buildItunesSearchUrl('Ariana Grande thank u next', 'song');
		const u = new URL(url);
		expect(u.origin + u.pathname).toBe('https://itunes.apple.com/search');
		expect(u.searchParams.get('term')).toBe('Ariana Grande thank u next');
		expect(u.searchParams.get('entity')).toBe('song');
		expect(u.searchParams.get('limit')).toBe('1');
	});

	it('encodeURIComponent-encodes the term (no raw spaces / special chars leak)', () => {
		const url = buildItunesSearchUrl('A&B C/D', 'song');
		// URLSearchParams encodes space as + and & / as %26 %2F — never raw in the query string.
		expect(url).not.toContain(' ');
		expect(url).toContain('term=');
		// Round-trips back to the original via URL parsing.
		expect(new URL(url).searchParams.get('term')).toBe('A&B C/D');
	});

	it('includes an optional attribute when provided', () => {
		const url = buildItunesSearchUrl('Drake', 'album', 'artistTerm');
		const u = new URL(url);
		expect(u.searchParams.get('entity')).toBe('album');
		expect(u.searchParams.get('attribute')).toBe('artistTerm');
	});

	it('omits attribute when not provided', () => {
		const url = buildItunesSearchUrl('Drake', 'musicArtist');
		expect(new URL(url).searchParams.has('attribute')).toBe(false);
	});
});

describe('upgradeArtwork — 100x100bb → 1200x1200bb', () => {
	it('upgrades a standard artworkUrl100 to 1200x1200bb (D-11)', () => {
		const u = 'https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg';
		expect(upgradeArtwork(u)).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/abc/1200x1200bb.jpg'
		);
	});

	it('returns the URL unchanged when the 100x100bb token is absent', () => {
		const u = 'https://is1-ssl.mzstatic.com/image/thumb/abc/170x170.jpg';
		expect(upgradeArtwork(u)).toBe(u);
	});

	it('returns null for empty / whitespace / null / undefined', () => {
		expect(upgradeArtwork('')).toBeNull();
		expect(upgradeArtwork('   ')).toBeNull();
		expect(upgradeArtwork(null)).toBeNull();
		expect(upgradeArtwork(undefined)).toBeNull();
	});
});

describe('itunesSongCover — entity=song resolve', () => {
	it('fetches entity=song and returns the upgraded artworkUrl100', async () => {
		const fetchMock = vi.fn(async (_input: string) =>
			jsonResponse({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://cdn.example/100x100bb.jpg' }]
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await itunesSongCover('Ariana Grande', 'thank u, next');
		expect(out).toBe('https://cdn.example/1200x1200bb.jpg');
		// The requested URL is an entity=song iTunes search of `${artist} ${title}`.
		const called = new URL(fetchMock.mock.calls[0][0]);
		expect(called.origin + called.pathname).toBe('https://itunes.apple.com/search');
		expect(called.searchParams.get('entity')).toBe('song');
		expect(called.searchParams.get('term')).toBe('Ariana Grande thank u, next');
	});

	it('returns null on empty results', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ resultCount: 0, results: [] })));
		await expect(itunesSongCover('Nobody', 'Nothing')).resolves.toBeNull();
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] }, false)));
		await expect(itunesSongCover('X', 'Y')).resolves.toBeNull();
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
						}
					}) as unknown as Response
			)
		);
		await expect(itunesSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch itself throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(itunesSongCover('X', 'Y')).resolves.toBeNull();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(itunesSongCover('X', 'Y', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null when results[0] has no artworkUrl100', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ trackName: 'x' }] })));
		await expect(itunesSongCover('X', 'Y')).resolves.toBeNull();
	});
});

describe('itunesArtistCover — artist image via album-by-artistTerm', () => {
	it('resolves an artist image from entity=album&attribute=artistTerm top result', async () => {
		const fetchMock = vi.fn(async (_input: string) =>
			jsonResponse({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://cdn.example/art/100x100bb.jpg' }]
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const out = await itunesArtistCover('Taylor Swift');
		expect(out).toBe('https://cdn.example/art/1200x1200bb.jpg');
		const called = new URL(fetchMock.mock.calls[0][0]);
		expect(called.searchParams.get('entity')).toBe('album');
		expect(called.searchParams.get('attribute')).toBe('artistTerm');
		expect(called.searchParams.get('term')).toBe('Taylor Swift');
	});

	it('returns null on empty results', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ resultCount: 0, results: [] })));
		await expect(itunesArtistCover('Nobody')).resolves.toBeNull();
	});

	it('returns null on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] }, false)));
		await expect(itunesArtistCover('X')).resolves.toBeNull();
	});

	it('returns null (never throws) when fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(itunesArtistCover('X')).resolves.toBeNull();
	});

	it('returns null immediately on an already-aborted signal (no fetch)', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
		vi.stubGlobal('fetch', fetchMock);
		const ac = new AbortController();
		ac.abort();
		await expect(itunesArtistCover('X', ac.signal)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// =============================================================================================
// quick-260809-3uo — retaining the NUMERIC id alongside the artwork URL
// =============================================================================================
// The share carrier tokenizes an iTunes cover by its numeric id (`i:<digits>`), never by its
// ~90-char mzstatic path. The id is NOT derivable from the artwork URL, so it has to be retained at
// the one moment it is known: the search response that also produced the URL.

/** In-memory localStorage (no jsdom project — the cover-cache.test.ts stub, verbatim in shape). */
class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
}

// The REAL response shape, live-probed 2026-08-09 for 你瞞我瞞 / 陳柏宇 (the reported song).
const QUIN_100 =
	'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/44/ab/f4/44abf48c-3f51-31b9-469a-6d99548070e1/886443102378.jpg/100x100bb.jpg';
const QUIN_1200 = QUIN_100.replace('100x100bb', '1200x1200bb');
const QUIN_600 = QUIN_100.replace('100x100bb', '600x600bb');

describe('itunes id retention (quick-260809-3uo)', () => {
	const original = (globalThis as { localStorage?: Storage }).localStorage;
	let store: MemStorage;
	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
	});
	afterEach(() => {
		if (original) Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
		else delete (globalThis as { localStorage?: Storage }).localStorage;
	});

	it('itunesArtworkKey is SIZE-INDEPENDENT, so any variant recalls the same id', () => {
		const k = itunesArtworkKey(QUIN_100);
		expect(k).not.toBeNull();
		expect(itunesArtworkKey(QUIN_600)).toBe(k);
		expect(itunesArtworkKey(QUIN_1200)).toBe(k);
	});

	it('itunesArtworkKey returns null for a non-mzstatic / malformed / empty URL', () => {
		for (const bad of [
			'https://cdn-images.dzcdn.net/images/cover/aa/500x500-000000-80-0-0.jpg',
			'https://is1-ssl.mzstatic.com.evil.example/image/thumb/a/b/600x600bb.jpg',
			'http://is1-ssl.mzstatic.com/image/thumb/a/b/600x600bb.jpg',
			'not a url',
			'',
			null,
			undefined
		])
			expect(itunesArtworkKey(bad)).toBeNull();
	});

	it('a song resolve REMEMBERS the id, and recallItunesId reads it back at any size', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					results: [{ trackId: 446760995, collectionId: 446760418, artworkUrl100: QUIN_100 }]
				})
			)
		);
		expect(await itunesSongCover('陳柏宇', '你瞞我瞞')).toBe(QUIN_1200);
		// The COLLECTION (album) id is preferred — /lookup?id= on it returns the same artwork and it
		// is the album-art identity, live-probed identical for both ids.
		expect(recallItunesId(QUIN_1200)).toBe('446760418');
		expect(recallItunesId(QUIN_600)).toBe('446760418');
	});

	it('falls back to trackId when the response carries no collectionId', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ results: [{ trackId: 446760995, artworkUrl100: QUIN_100 }] }))
		);
		await itunesSongCover('陳柏宇', '你瞞我瞞');
		expect(recallItunesId(QUIN_1200)).toBe('446760995');
	});

	it('remembers NOTHING when the response carries no usable numeric id (never junk)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ results: [{ collectionId: 'abc', artworkUrl100: QUIN_100 }] }))
		);
		await itunesSongCover('陳柏宇', '你瞞我瞞');
		expect(recallItunesId(QUIN_1200)).toBeNull();
	});

	it('recallItunesId is null for an unseen cover (a cover cached BEFORE this change)', () => {
		expect(recallItunesId(QUIN_1200)).toBeNull();
		expect(recallItunesId('https://cdn-images.dzcdn.net/images/cover/aa/500x500-000000-80-0-0.jpg')).toBeNull();
		expect(recallItunesId(null)).toBeNull();
	});

	it('never throws when storage is unavailable (SSR / privacy mode)', async () => {
		delete (globalThis as { localStorage?: Storage }).localStorage;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ results: [{ collectionId: 446760418, artworkUrl100: QUIN_100 }] }))
		);
		expect(await itunesSongCover('陳柏宇', '你瞞我瞞')).toBe(QUIN_1200);
		expect(recallItunesId(QUIN_1200)).toBeNull();
	});
});
