import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveArtistImage, __clearArtistImageState } from './artist-image';
import { getCachedArtistCover } from './cover-cache';
import { getArtistChosen, pinArtistImage } from './artist-record';
import { __clearSearchCache } from './ttl-cache';
import { __clearArtistNegCache } from './deezer';

// artist-image (quick-261121-canon) is THE one artist-image resolver. These tests pin the
// Megan Thee Stallion golden case from the brief (§1.4, recorded live probe 2026-11-21):
// Deezer track search for her name returns Maroon 5's "Beautiful Mistakes" at hit #1 (Megan
// is an uncredited feature) and the proxy's top-level artistPicture is MAROON 5's photo.
// The resolver must NEVER return the stranger's photo, must find Megan's real picture (via
// the Deezer artist endpoint, or via the gate-passing hit scan), must share it through the
// cover-cache artist family + the forever ArtistRecord, and must negative-cache a genuine
// miss for ~1h — never 7 days. All network is a routed fetch stub (no live calls).

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
	clear(): void {
		this.m.clear();
	}
}

const MEGAN = 'Megan Thee Stallion';
const MAROON_PIC = 'https://cdn-images.dzcdn.net/images/artist/maroon5/1000x1000-000000-80-0-0.jpg';
const MEGAN_PIC_XL = 'https://cdn-images.dzcdn.net/images/artist/megan/1000x1000-000000-80-0-0.jpg';
const MEGAN_PIC_500 = 'https://cdn-images.dzcdn.net/images/artist/megan/500x500-000000-80-0-0.jpg';
const COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';

/** The recorded probe reshape: hit #1 Maroon 5, hit #2 Megan (per-hit pictures included). */
const SEARCH_PAYLOAD = {
	cover: COVER,
	artistPicture: MAROON_PIC,
	results: [
		{ id: '1', title: 'Beautiful Mistakes', artist: 'Maroon 5', album: 'Jordi', cover: COVER, preview: null, artistPicture: MAROON_PIC },
		{ id: '2', title: 'Sweetest Pie', artist: MEGAN, album: '', cover: COVER, preview: null, artistPicture: MEGAN_PIC_XL }
	]
};

function jsonResponse(body: unknown, ok = true): Response {
	const make = (): Response =>
		({ ok, status: ok ? 200 : 500, json: async () => body, clone: make }) as unknown as Response;
	return make();
}

type Routes = { artist?: unknown; search?: unknown; lastfm?: unknown; failAll?: boolean };
let fetchCounts: Record<string, number> = {};

function stubFetch(routes: Routes) {
	fetchCounts = { artist: 0, search: 0, lastfm: 0, other: 0 };
	const fn = vi.fn(async (input: unknown) => {
		if (routes.failAll) throw new Error('offline');
		const url = String((input as { url?: string })?.url ?? input);
		if (url.includes('/api/deezer/artist')) {
			fetchCounts.artist++;
			return jsonResponse(routes.artist ?? { picture: null, fans: null, albums: null });
		}
		if (url.includes('/api/deezer/search')) {
			fetchCounts.search++;
			return jsonResponse(routes.search ?? SEARCH_PAYLOAD);
		}
		if (url.includes('/api/lastfm/')) {
			fetchCounts.lastfm++;
			return jsonResponse(routes.lastfm ?? { image: null, name: MEGAN, tags: [] });
		}
		fetchCounts.other++;
		return jsonResponse({});
	});
	vi.stubGlobal('fetch', fn);
	return fn;
}

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
	__clearSearchCache();
	__clearArtistImageState();
	__clearArtistNegCache();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearSearchCache();
	__clearArtistImageState();
	__clearArtistNegCache();
});

describe('resolveArtistImage — the Megan golden case (brief §1.4)', () => {
	it('resolves Megan via the Deezer ARTIST endpoint — never Maroon 5’s photo', async () => {
		stubFetch({ artist: { picture: MEGAN_PIC_XL, fans: 100, albums: 3 }, search: SEARCH_PAYLOAD });
		const url = await resolveArtistImage(MEGAN);
		expect(url).toBe(MEGAN_PIC_500); // display rung (downsizeDeezerCover), her photo
		expect(url).not.toContain('maroon5');
	});

	it('falls back to the gate-passing HIT SCAN when the artist endpoint has no picture', async () => {
		stubFetch({ artist: { picture: null, fans: null, albums: null }, search: SEARCH_PAYLOAD });
		const url = await resolveArtistImage(MEGAN);
		// Hit #2 IS Megan and passes the gate; hit #1 (Maroon 5) must be skipped, not served.
		expect(url).toBe(MEGAN_PIC_500);
	});

	it('returns null — never a stranger’s photo — when only Maroon 5 answers', async () => {
		stubFetch({
			artist: { picture: null, fans: null, albums: null },
			search: {
				cover: COVER,
				artistPicture: MAROON_PIC,
				results: [
					{ id: '1', title: 'Beautiful Mistakes', artist: 'Maroon 5', album: 'Jordi', cover: COVER, preview: null, artistPicture: MAROON_PIC }
				]
			}
		});
		expect(await resolveArtistImage(MEGAN)).toBeNull();
	});
});

describe('resolveArtistImage — sharing + forever + offline', () => {
	it('writes the shared artist cache + the record (brief test 5: search ↔ home sharing)', async () => {
		stubFetch({ artist: { picture: MEGAN_PIC_XL, fans: 1, albums: 1 } });
		const url = await resolveArtistImage(MEGAN);
		// The home path reads getCachedArtistCover — the value is there with no second resolve.
		expect(getCachedArtistCover(MEGAN)).toBe(url);
		expect(getArtistChosen(MEGAN)).toBe(url);
	});

	it('resolve → go offline → renders identically from the record (no fetch)', async () => {
		stubFetch({ artist: { picture: MEGAN_PIC_XL, fans: 1, albums: 1 } });
		const online = await resolveArtistImage(MEGAN);
		expect(online).toBe(MEGAN_PIC_500);
		// Offline: every fetch throws, in-memory TTL caches are cold (fresh session).
		__clearSearchCache();
		stubFetch({ failAll: true });
		const offline = await resolveArtistImage(MEGAN);
		expect(offline).toBe(online);
	});

	it('a record pin wins with zero network (pin leg leads the order)', async () => {
		const PIN = 'https://cdn-images.dzcdn.net/images/artist/pinned/1000x1000-000000-80-0-0.jpg';
		pinArtistImage(MEGAN, PIN);
		stubFetch({ failAll: true });
		expect(await resolveArtistImage(MEGAN)).toBe(PIN);
	});
});

describe('resolveArtistImage — negative caching (1h, canonical key — never 7 days)', () => {
	it('a total miss is memoised ~1h, then retried', async () => {
		stubFetch({
			artist: { picture: null, fans: null, albums: null },
			search: { cover: null, artistPicture: null, results: [] },
			lastfm: { image: null, name: MEGAN, tags: [] }
		});
		expect(await resolveArtistImage(MEGAN)).toBeNull();
		const afterFirst = { ...fetchCounts };
		expect(afterFirst.artist).toBeGreaterThan(0);
		// Second call within the hour: the negative memo answers — no new network.
		expect(await resolveArtistImage(MEGAN)).toBeNull();
		expect(fetchCounts).toEqual(afterFirst);
		// After the hour (fresh in-memory caches, as a later session would see): it retries.
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000);
		__clearSearchCache();
		expect(await resolveArtistImage(MEGAN)).toBeNull();
		expect(fetchCounts.artist).toBeGreaterThan(afterFirst.artist);
	});

	it('force bypasses the negative memo (point-of-use force refresh)', async () => {
		stubFetch({
			artist: { picture: null, fans: null, albums: null },
			search: { cover: null, artistPicture: null, results: [] }
		});
		expect(await resolveArtistImage(MEGAN)).toBeNull();
		stubFetch({ artist: { picture: MEGAN_PIC_XL, fans: 1, albums: 1 } });
		__clearSearchCache();
		expect(await resolveArtistImage(MEGAN, undefined, { force: true })).toBe(MEGAN_PIC_500);
	});
});
