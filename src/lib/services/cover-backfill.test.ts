import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	backfillCovers,
	backfillArtistCovers,
	resolveCoverForTrack,
	resolveHqCover,
	collectCoverCandidates,
	__resetCoverMissCache
} from './cover-backfill';
import * as catalog from './catalog';
import * as deezer from './deezer';
import * as itunes from './itunes-cover';
import {
	getCachedCover,
	getCachedCoverByUid,
	getCachedArtistCover,
	setCachedArtistCover,
	artistCoverCacheKey
} from './cover-cache';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// cover-backfill (quick-260607-0bb supersedes wv8; quick-260919-0mw reordered the TRACK chain).
// These tests pin the multi-tier chains:
//   TRACK:  YTM → iTunes → Deezer → CN, stop at first SOLID (https, non-empty);
//   ARTIST: Deezer → iTunes, stop at first SOLID (deliberately NOT reordered).
// Each tier never-throws (a throw in one tier falls through to the next, whole call never rejects);
// only https covers are cached/notified; already-cached items are skipped; the fan-out is capped to
// `max`. searchAll + the deezer + itunes resolvers are spied; the cover-cache reads/writes a real
// in-memory localStorage stub (no jsdom, no live network), mirroring discovery.test.ts.

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

function mk(source: SourceId, songid: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: `${source}-${songid}`,
		artist: 'a',
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

function result(tracks: Track[]): catalog.SearchResult {
	return { perSource: [], interleaved: tracks };
}

// quick-260919-0mw — tier 1 (ytmusic) and the last tier (CN) are the SAME `searchAll` function; the
// prefs arg is the only thing that tells them apart (`onlySource('ytmusic')` vs `{}`). A plain
// mockResolvedValue therefore answers for BOTH, which would make the CN tier unobservable — so tier
// tests mock by prefs and count by prefs.
function mockSearch(opts: { ytm?: Track[]; cn?: Track[] } = {}) {
	return vi
		.spyOn(catalog, 'searchAll')
		.mockImplementation(async (_kw, _page, prefs) =>
			result(prefs?.ytmusic ? (opts.ytm ?? []) : (opts.cn ?? []))
		);
}
const ytmCalls = () => vi.mocked(catalog.searchAll).mock.calls.filter((c) => c[2]?.ytmusic === true);
const cnCalls = () => vi.mocked(catalog.searchAll).mock.calls.filter((c) => c[2]?.ytmusic !== true);

const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', {
		value: new MemStorage(),
		configurable: true,
		writable: true
	});
	// The negative-miss cache is module-scoped + session-lived — reset it so a miss recorded in one
	// test can't skip the re-search another test expects (many tests reuse the same X/Y key).
	__resetCoverMissCache();
	// quick-260919-0mw: tier 1 is now a `searchAll` walk, so EVERY chain test issues one even when it
	// only cares about iTunes/Deezer. Default it to a miss so an unmocked test can never reach the
	// real network; tests that pin a tier re-mock it with mockSearch().
	vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Object.defineProperty(globalThis, 'localStorage', {
		value: originalLocalStorage,
		configurable: true,
		writable: true
	});
});

describe('backfillCovers — YTM → iTunes → Deezer → CN track chain (quick-260919-0mw)', () => {
	const YTM = 'https://lh3.googleusercontent.com/ytm.jpg';

	it('uses the YouTube Music cover when present and calls NO iTunes, NO Deezer, NO CN tier (tier-1 short-circuit)', async () => {
		const searchSpy = mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Drake', title: 'Hotline Bling' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		// The YTM tier is searchAll pinned to ONE source via onlySource() — every other source is
		// explicitly false, so a user-enabled source cannot leak into the tier-1 walk.
		expect(searchSpy).toHaveBeenCalledWith(
			'Drake Hotline Bling',
			1,
			expect.objectContaining({ ytmusic: true, netease: false }),
			undefined
		);
		expect(itunesSpy).not.toHaveBeenCalled(); // YTM hit → no iTunes
		expect(deezerSpy).not.toHaveBeenCalled(); // YTM hit → no Deezer
		expect(cnCalls()).toHaveLength(0); // YTM hit → no CN search
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe(YTM);
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe(YTM);
	});

	it('falls back to iTunes when YTM misses (and calls NEITHER Deezer NOR the CN tier)', async () => {
		mockSearch(); // both searchAll tiers miss
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it-cover.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Adele', title: 'Hello' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(ytmCalls()).toHaveLength(1);
		// iTunes receives the caller's signal (undefined here — no signal supplied).
		expect(itunesSpy).toHaveBeenCalledWith('Adele', 'Hello', undefined);
		expect(deezerSpy).not.toHaveBeenCalled(); // iTunes hit → no Deezer
		expect(cnCalls()).toHaveLength(0); // iTunes hit → no CN search
		expect(getCachedCover('Adele', 'Hello')).toBe('https://is1-ssl.mzstatic.com/it-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://is1-ssl.mzstatic.com/it-cover.jpg');
	});

	it('falls back to Deezer when YTM + iTunes miss (and does NOT reach the CN tier)', async () => {
		mockSearch();
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/dz-cover.jpg');

		await backfillCovers([{ artist: 'Adele', title: 'Hello' }]);

		expect(itunesSpy).toHaveBeenCalled();
		expect(deezerSpy).toHaveBeenCalledWith('Adele', 'Hello', undefined);
		expect(cnCalls()).toHaveLength(0);
		expect(getCachedCover('Adele', 'Hello')).toBe('https://cdn-images.dzcdn.net/dz-cover.jpg');
	});

	it('falls back to the CN cover when YTM + iTunes + Deezer all miss, then caches + notifies', async () => {
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn-cover.jpg' });
		const searchSpy = mockSearch({ cn: [hit] });
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Jay Chou', title: 'Simple Love' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(ytmCalls()).toHaveLength(1);
		expect(itunesSpy).toHaveBeenCalled();
		expect(deezerSpy).toHaveBeenCalled();
		// WR-01: the CN tier threads explicit {} prefs + the caller's signal (undefined here) so the
		// fan-out is abortable like the tiers above.
		expect(searchSpy).toHaveBeenCalledWith('Jay Chou Simple Love', 1, {}, undefined);
		expect(getCachedCover('Jay Chou', 'Simple Love')).toBe('https://cn.example/cn-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cn.example/cn-cover.jpg');
	});

	it('leaves the gradient (no cache, no notify) when all four tiers miss', async () => {
		mockSearch();
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'X', title: 'Y' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('X', 'Y')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('NEGATIVE-MISS CACHE: a repeat pass for a missing tile within the TTL does NOT re-search (kills the refresh re-fire flood)', async () => {
		// debug-nowbar-frozen-audius-spam follow-up: a total miss is not cover-cached (so it retries
		// eventually), but it MUST be remembered short-term so every Home refresh/randomize does not
		// re-run the full four-tier fan-out for the same imageless tiles.
		mockSearch();
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);

		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]); // pass 1: full chain, finds nothing
		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]); // pass 2: skipped by the negative cache

		expect(ytmCalls()).toHaveLength(1); // NOT 2 — the second pass issued zero requests
		expect(itunesSpy).toHaveBeenCalledTimes(1);
		expect(deezerSpy).toHaveBeenCalledTimes(1);
		expect(cnCalls()).toHaveLength(1);

		// After the TTL window (simulated by a reset) the tile is eligible to retry — nothing is pinned.
		__resetCoverMissCache();
		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]);
		expect(ytmCalls()).toHaveLength(2); // retried once the miss expired
	});

	it('NEGATIVE-MISS CACHE: a later SOLID hit clears the miss so a now-resolvable tile is not skipped', async () => {
		mockSearch();
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValueOnce(null); // pass 1: miss

		await backfillCovers([{ artist: 'Later', title: 'Cover' }]); // miss → remembered
		expect(getCachedCover('Later', 'Cover')).toBeNull();

		// Cover becomes available; a fresh pass (after the miss TTL) resolves + caches it.
		deezerSpy.mockResolvedValue('https://cdn-images.dzcdn.net/later.jpg');
		__resetCoverMissCache();
		await backfillCovers([{ artist: 'Later', title: 'Cover' }]);
		expect(getCachedCover('Later', 'Cover')).toBe('https://cdn-images.dzcdn.net/later.jpg');
		expect(cnCalls()).toHaveLength(1); // only the first (missing) pass reached the CN tier
	});

	it('treats a NON-https cover as a miss and falls through to the next tier', async () => {
		// YTM returns an http (insecure) URL → must NOT be cached; falls through to iTunes.
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: 'http://insecure.example/x.jpg' })] });
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/ok.jpg');

		await backfillCovers([{ artist: 'A', title: 'B' }]);
		expect(itunesSpy).toHaveBeenCalled();
		expect(getCachedCover('A', 'B')).toBe('https://is1-ssl.mzstatic.com/ok.jpg');
	});

	it('does NOT cache an http-only final result (all tiers non-https → gradient)', async () => {
		mockSearch({
			ytm: [mk('ytmusic', 'y', { cover: 'http://a/ytm.jpg' })],
			cn: [mk('netease', 'hit', { cover: 'http://cn.example/insecure.jpg' })]
		});
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://a/x.jpg');

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'A', title: 'B' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('A', 'B')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('falls through to iTunes when the YTM tier THROWS (per-tier never-throw)', async () => {
		vi.spyOn(catalog, 'searchAll').mockImplementation(async (_kw, _page, prefs) => {
			if (prefs?.ytmusic) throw new Error('ytmusic down');
			return result([]);
		});
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');

		await backfillCovers([{ artist: 'X', title: 'Y' }]);
		expect(itunesSpy).toHaveBeenCalled();
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(cnCalls()).toHaveLength(0);
		expect(getCachedCover('X', 'Y')).toBe('https://is1-ssl.mzstatic.com/it.jpg');
	});

	it('falls through to Deezer when iTunes THROWS after a YTM miss (per-tier never-throw)', async () => {
		mockSearch();
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes down'));
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/dz.jpg');

		await backfillCovers([{ artist: 'X', title: 'Y' }]);
		expect(deezerSpy).toHaveBeenCalled();
		expect(getCachedCover('X', 'Y')).toBe('https://cdn-images.dzcdn.net/dz.jpg');
	});

	it('falls through to CN when Deezer THROWS after a YTM + iTunes miss (per-tier never-throw)', async () => {
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn.jpg' });
		mockSearch({ cn: [hit] });
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer down'));

		await backfillCovers([{ artist: 'X', title: 'Y' }]);
		expect(cnCalls()).toHaveLength(1);
		expect(getCachedCover('X', 'Y')).toBe('https://cn.example/cn.jpg');
	});

	it('never rejects when ALL tiers throw (degrades to the gradient)', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search'));
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes'));
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer'));
		await expect(backfillCovers([{ artist: 'X', title: 'Y' }])).resolves.toBeUndefined();
		expect(getCachedCover('X', 'Y')).toBeNull();
	});

	it('skips an already-cached track (zero tier calls on a warm pass)', async () => {
		const { setCachedCover } = await import('./cover-cache');
		setCachedCover('Cached', 'Song', 'https://cdn-images.dzcdn.net/cached.jpg');
		const searchSpy = mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://x/y.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue('https://x/z.jpg');

		await backfillCovers([{ artist: 'Cached', title: 'Song' }]);
		expect(searchSpy).not.toHaveBeenCalled();
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(itunesSpy).not.toHaveBeenCalled();
	});

	it('caps the track fan-out to `max`', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		await backfillCovers(
			[
				{ artist: 'A', title: '1' },
				{ artist: 'B', title: '2' },
				{ artist: 'C', title: '3' }
			],
			{ max: 2 }
		);
		expect(ytmCalls()).toHaveLength(2);
	});
});

describe('backfillArtistCovers — Deezer → iTunes artist chain (quick-260607-0bb)', () => {
	it('uses the Deezer artist cover when present and does NOT call iTunes (tier-1 short-circuit)', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/artist.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesArtistCover');

		const resolved: Array<[string, string]> = [];
		await backfillArtistCovers(['Taylor Swift'], { onResolved: (k, u) => resolved.push([k, u]) });

		expect(deezerSpy).toHaveBeenCalledWith('Taylor Swift', undefined);
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(getCachedArtistCover('Taylor Swift')).toBe('https://cdn-images.dzcdn.net/artist.jpg');
		expect(resolved).toHaveLength(1);
		// The onResolved key is the ARTIST key, not the track key.
		expect(resolved[0][0]).toBe(artistCoverCacheKey('Taylor Swift'));
	});

	it('falls back to iTunes when the Deezer artist picture misses, then caches + notifies', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue(null);
		const itunesSpy = vi
			.spyOn(itunes, 'itunesArtistCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it-artist.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillArtistCovers(['周杰倫'], { onResolved: (k, u) => resolved.push([k, u]) });

		expect(deezerSpy).toHaveBeenCalled();
		// iTunes artist resolver receives the caller's signal (undefined here — none supplied).
		expect(itunesSpy).toHaveBeenCalledWith('周杰倫', undefined);
		expect(getCachedArtistCover('周杰倫')).toBe('https://is1-ssl.mzstatic.com/it-artist.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][0]).toBe(artistCoverCacheKey('周杰倫'));
	});

	it('treats a NON-https artist cover as a miss and falls through to iTunes', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue('http://insecure/a.jpg');
		const itunesSpy = vi
			.spyOn(itunes, 'itunesArtistCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/ok.jpg');
		await backfillArtistCovers(['A']);
		expect(itunesSpy).toHaveBeenCalled();
		expect(getCachedArtistCover('A')).toBe('https://is1-ssl.mzstatic.com/ok.jpg');
	});

	it('skips an already-cached artist (zero resolver calls on a warm pass)', async () => {
		setCachedArtistCover('Drake', 'https://cached/artist.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue('https://it/x.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue('https://it/y.jpg');

		await backfillArtistCovers(['Drake']);
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(getCachedArtistCover('Drake')).toBe('https://cached/artist.jpg');
	});

	it('de-dupes identical names so a repeated artist resolves once', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillArtistCovers(['Drake', 'Drake', 'Drake']);
		expect(deezerSpy).toHaveBeenCalledTimes(1);
	});

	it('does not cache or notify when BOTH Deezer and iTunes miss (artist tile keeps its gradient)', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockResolvedValue(null);
		vi.spyOn(itunes, 'itunesArtistCover').mockResolvedValue(null);
		const resolved: string[] = [];
		await backfillArtistCovers(['Nobody'], { onResolved: (k) => resolved.push(k) });
		expect(getCachedArtistCover('Nobody')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('falls through to iTunes when the Deezer artist resolver THROWS (per-tier never-throw)', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockRejectedValue(new Error('boom'));
		const itunesSpy = vi
			.spyOn(itunes, 'itunesArtistCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it.jpg');
		await backfillArtistCovers(['X']);
		expect(itunesSpy).toHaveBeenCalled();
		expect(getCachedArtistCover('X')).toBe('https://is1-ssl.mzstatic.com/it.jpg');
	});

	it('never rejects when BOTH artist tiers throw (degrades to the gradient)', async () => {
		vi.spyOn(deezer, 'deezerArtistCover').mockRejectedValue(new Error('deezer'));
		vi.spyOn(itunes, 'itunesArtistCover').mockRejectedValue(new Error('itunes'));
		await expect(backfillArtistCovers(['X'])).resolves.toBeUndefined();
		expect(getCachedArtistCover('X')).toBeNull();
	});

	it('caps the artist fan-out to `max`', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerArtistCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillArtistCovers(['A', 'B', 'C', 'D', 'E'], { max: 2 });
		expect(deezerSpy).toHaveBeenCalledTimes(2);
	});
});

describe('resolveCoverForTrack — shared single-item resolve helper (Plan 21-02, COVER-02)', () => {
	it('returns a SOLID https URL on a tier hit and writes BOTH cache layers', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: 'https://lh3.googleusercontent.com/ytm.jpg' })] });
		const t = mk('netease', '12345', { artist: 'Drake', title: 'Hotline Bling' });

		const out = await resolveCoverForTrack(t);
		expect(out).toBe('https://lh3.googleusercontent.com/ytm.jpg');
		// BOTH layers written on a SOLID hit (D-13).
		expect(getCachedCoverByUid('netease:12345')).toBe('https://lh3.googleusercontent.com/ytm.jpg');
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://lh3.googleusercontent.com/ytm.jpg');
	});

	it('runs the YTM → iTunes → Deezer → CN tier order (falls through to iTunes on a YTM miss)', async () => {
		mockSearch();
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');
		const t = mk('qq', 'abc', { artist: 'Adele', title: 'Hello' });

		const out = await resolveCoverForTrack(t);
		expect(out).toBe('https://is1-ssl.mzstatic.com/it.jpg');
		expect(ytmCalls()).toHaveLength(1);
		expect(itunesSpy).toHaveBeenCalled();
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(cnCalls()).toHaveLength(0);
	});

	it('returns null on a total miss (chain never throws), caching nothing', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('search'));
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer'));
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes'));
		const t = mk('netease', 'miss', { artist: 'X', title: 'Y' });

		await expect(resolveCoverForTrack(t)).resolves.toBeNull();
		expect(getCachedCoverByUid('netease:miss')).toBeNull();
		expect(getCachedCover('X', 'Y')).toBeNull();
	});

	it('rejects a non-https tier result (isSolidCover gate) — returns null, nothing cached', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: 'http://insecure/ytm.jpg' })] });
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://insecure/a.jpg');
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const t = mk('netease', 'ins', { artist: 'A', title: 'B' });

		await expect(resolveCoverForTrack(t)).resolves.toBeNull();
		expect(getCachedCoverByUid('netease:ins')).toBeNull();
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	// charts-tags-same-cover regression: a synthetic discovery stub (charts/tags, charts/countries)
	// carries uid ''. The uid cache layer is a shared flat record keyed by `'uid:' + uid`, so writing
	// an empty uid would store EVERY distinct row under the single `'uid:'` slot and the first row's
	// cover would read back for ALL rows. An empty uid must write ONLY the per-song {artist,title}
	// name layer, never the uid layer.
	it('does NOT write the uid layer for an empty-uid stub (charts-tags-same-cover)', async () => {
		mockSearch();
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://cdn-images.dzcdn.net/r.jpg');
		const stub = mk('netease', 'ignored', {
			uid: '',
			artist: 'Foo Fighters',
			title: 'Everlong'
		});

		const out = await resolveCoverForTrack(stub);
		expect(out).toBe('https://cdn-images.dzcdn.net/r.jpg');
		// The shared empty-uid slot ('uid:') is NEVER written — distinct rows can't collide on it.
		expect(getCachedCoverByUid('')).toBeNull();
		// The per-song name layer IS written, so this stub still caches under its own identity.
		expect(getCachedCover('Foo Fighters', 'Everlong')).toBe('https://cdn-images.dzcdn.net/r.jpg');
	});
});

describe('resolveHqCover — YTM → Deezer HQ upgrade (Plan 26-02 COVER-01; quick-260919-0mw)', () => {
	const YTM = 'https://lh3.googleusercontent.com/hq.jpg';

	it('returns the SOLID YTM cover and issues NEITHER Deezer, iTunes NOR the CN tier (tier-1 short-circuit)', async () => {
		const searchSpy = mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');
		const t = mk('kuwo', '999', { artist: 'Drake', title: 'Hotline Bling' });

		const out = await resolveHqCover(t);
		expect(out).toBe(YTM);
		expect(searchSpy).toHaveBeenCalledTimes(1); // exactly ONE call — the YTM tier
		expect(deezerSpy).not.toHaveBeenCalled(); // YTM hit → no second call (common case = 1 call)
		expect(itunesSpy).not.toHaveBeenCalled(); // NEVER iTunes — this is an upgrade, not a chain
		expect(cnCalls()).toHaveLength(0); // NEVER the CN searchAll tier (T-26-02-01 fan-out bound)
	});

	it('falls back to Deezer on a YTM miss — worst case TWO calls, still no iTunes and no CN', async () => {
		mockSearch();
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const t = mk('kuwo', '999', { artist: 'Drake', title: 'Hotline Bling' });

		const out = await resolveHqCover(t);
		expect(out).toBe('https://cdn-images.dzcdn.net/hq.jpg');
		expect(ytmCalls()).toHaveLength(1);
		expect(deezerSpy).toHaveBeenCalledWith('Drake', 'Hotline Bling', undefined);
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(cnCalls()).toHaveLength(0);
	});

	it('writes BOTH cache layers on a SOLID hit (real uid → uid layer + name layer)', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const t = mk('kuwo', '12345', { artist: 'Drake', title: 'Hotline Bling' });
		await resolveHqCover(t);
		expect(getCachedCoverByUid('kuwo:12345')).toBe(YTM);
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe(YTM);
	});

	it('writes ONLY the name layer for an empty-uid stub (charts-tags-same-cover guard)', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const stub = mk('netease', 'ignored', { uid: '', artist: 'Foo Fighters', title: 'Everlong' });
		await resolveHqCover(stub);
		expect(getCachedCoverByUid('')).toBeNull(); // shared 'uid:' slot never written for an empty uid
		expect(getCachedCover('Foo Fighters', 'Everlong')).toBe(YTM);
	});

	it('returns null (no throw) and caches nothing when BOTH tiers miss — never touches iTunes/CN', async () => {
		mockSearch();
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const t = mk('kuwo', 'miss', { artist: 'A', title: 'B' });

		await expect(resolveHqCover(t)).resolves.toBeNull();
		expect(deezerSpy).toHaveBeenCalledTimes(1);
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(cnCalls()).toHaveLength(0);
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('treats a non-https result from either tier as a miss (isSolidCover) — returns null, caches nothing', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: 'http://insecure.example/ytm.jpg' })] });
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://insecure.example/x.jpg');
		const t = mk('kuwo', 'ins', { artist: 'A', title: 'B' });
		await expect(resolveHqCover(t)).resolves.toBeNull();
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('never throws when a tier throws (per-tier never-throw) — returns null', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('ytmusic down'));
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer down'));
		const t = mk('kuwo', 'throw', { artist: 'A', title: 'B' });
		await expect(resolveHqCover(t)).resolves.toBeNull();
	});

	it('returns null immediately when the signal is already aborted (issues NO call at all)', async () => {
		const searchSpy = mockSearch({ ytm: [mk('ytmusic', 'y', { cover: YTM })] });
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');
		const t = mk('kuwo', 'abort', { artist: 'A', title: 'B' });
		const ac = new AbortController();
		ac.abort();
		await expect(resolveHqCover(t, ac.signal)).resolves.toBeNull();
		expect(searchSpy).not.toHaveBeenCalled();
		expect(deezerSpy).not.toHaveBeenCalled();
	});
});

// Plan 26-02, Task 3 — the click-to-play cover fan-out PROOF (T-26-02-01 DoS mitigation). Spike 003
// measured the Deezer+iTunes tiers + a 7-source CN searchAll per COVERLESS tile as a large share of a
// play's /api calls; kuwo returns a usable cover inline on 38/38, so ~all plays need zero cover network
// work. These tests pin the two paths at the SERVICE seam the player drives:
//   - INLINE-COVER hot path → the bounded resolveHqCover UPGRADE: 0 iTunes + 0 CN + ≤2 calls total.
//   - COVERLESS miss path   → resolveCoverForTrack still fans the full YTM → iTunes → Deezer → CN chain.
// They are regression guards for behavior already landed in Tasks 1–2 (so they are GREEN on first run
// by design — the hot path never fans out, the miss path still recovers).
describe('click-to-play cover fan-out proof (Plan 26-02, T-26-02-01)', () => {
	it('INLINE-COVER hot path (resolveHqCover): 0 iTunes + 0 CN searchAll + at most 2 upgrade calls', async () => {
		mockSearch({ ytm: [mk('ytmusic', 'y', { cover: 'https://lh3.googleusercontent.com/hq.jpg' })] });
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		// A resolved track that ALREADY carries a SOLID inline source cover (kuwo pic) — the player
		// painted it synchronously and fires ONLY the optional HQ upgrade for it.
		const inline = mk('kuwo', 'inline', {
			artist: 'Jay Chou',
			title: 'Blue and White Porcelain',
			cover: 'https://kuwo.example/inline.jpg'
		});

		await resolveHqCover(inline);

		expect(itunesSpy).not.toHaveBeenCalled(); // ZERO iTunes on the hot path
		expect(cnCalls()).toHaveLength(0); // ZERO CN searchAll on the hot path (T-26-02-01)
		// quick-260919-0mw: the ladder is YTM then Deezer-on-miss — never more than 2 calls, and a
		// YTM hit (this case) short-circuits to 1.
		expect(ytmCalls().length + deezerSpy.mock.calls.length).toBeLessThanOrEqual(2);
		expect(deezerSpy).not.toHaveBeenCalled();
	});

	it('COVERLESS miss path (resolveCoverForTrack): still fans through YTM → iTunes → Deezer → CN', async () => {
		const cnHit = mk('netease', 'cn', { cover: 'https://cn.example/cn.jpg' });
		mockSearch({ cn: [cnHit] });
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		// A genuinely coverless source (joox/fivesing) — no inline cover, so the full chain must run.
		const coverless = mk('joox', 'coverless', { artist: 'Adele', title: 'Hello', cover: null });

		const out = await resolveCoverForTrack(coverless);

		expect(ytmCalls()).toHaveLength(1); // tier 1
		expect(itunesSpy).toHaveBeenCalled(); // tier 2 (YTM missed)
		expect(deezerSpy).toHaveBeenCalled(); // tier 3 (YTM + iTunes missed)
		expect(cnCalls()).toHaveLength(1); // tier 4 (all three missed)
		expect(out).toBe('https://cn.example/cn.jpg');
	});
});

// quick-260915-w4f — collectCoverCandidates. The picker's ENUMERATE-ALL counterpart to
// resolveTrackChain's stop-at-first. It runs alongside the chain and must not change it: the
// fast-path tests above are untouched and still assert the sequential short-circuit.
describe('collectCoverCandidates (quick-260915-w4f)', () => {
	const track = mk('qq', 'c1', {
		artist: 'Adele',
		title: 'Hello',
		cover: 'https://own/c.jpg'
	});

	it('orders own → ytmusic → itunes → deezer → CN, https-only, deduped by url, labelled by source', async () => {
		// quick-260919-0mw: the grid order mirrors resolveTrackChain's tier ranking.
		vi.spyOn(deezer, 'deezerSearchTopN').mockResolvedValue([
			{ id: '1', title: 'Hello', artist: 'Adele', album: '25', cover: 'https://dz/1.jpg', preview: null },
			{ id: '2', title: 'Hello', artist: 'Adele', album: '25', cover: null, preview: null }
		]);
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue('https://it/1.jpg');
		mockSearch({
			ytm: [mk('ytmusic', 'y', { cover: 'https://ytm/1.jpg' })],
			cn: [
				mk('kuwo', 'k', { cover: 'https://k/1.jpg' }),
				mk('qq', 'q', { cover: 'http://insecure/x.jpg' }),
				mk('netease', 'n', { cover: 'https://k/1.jpg' }) // duplicate URL of the kuwo hit
			]
		});

		const out = await collectCoverCandidates(track);

		expect(out).toEqual([
			{ url: 'https://own/c.jpg', source: 'qq' },
			{ url: 'https://ytm/1.jpg', source: 'ytmusic' },
			{ url: 'https://it/1.jpg', source: 'itunes' },
			{ url: 'https://dz/1.jpg', source: 'deezer' },
			{ url: 'https://k/1.jpg', source: 'kuwo' }
		]);
		// The null Deezer cover, the http qq cover and the duplicate netease URL are all gone.
		expect(out.every((c) => c.url.startsWith('https:'))).toBe(true);
	});

	it('one tier rejecting still returns the other tiers (parallel + per-tier never-throw)', async () => {
		vi.spyOn(deezer, 'deezerSearchTopN').mockResolvedValue([
			{ id: '1', title: 'x', artist: 'y', album: '', cover: 'https://dz/1.jpg', preview: null }
		]);
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		// Both searchAll tiers (ytmusic + CN) reject — the deezer tier must still come back.
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('CN upstream blocked'));

		const out = await collectCoverCandidates(mk('kuwo', 'k1', { cover: null }));
		expect(out).toEqual([{ url: 'https://dz/1.jpg', source: 'deezer' }]);
	});

	it('an already-aborted signal returns [] and issues no fetch', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSearchTopN');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const searchSpy = mockSearch();
		const ac = new AbortController();
		ac.abort();

		expect(await collectCoverCandidates(track, ac.signal)).toEqual([]);
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
	});

	it('caps the grid at 12 candidates (the CN interleaved list can be dozens)', async () => {
		vi.spyOn(deezer, 'deezerSearchTopN').mockResolvedValue([]);
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		mockSearch({
			cn: Array.from({ length: 30 }, (_, i) => mk('kuwo', `k${i}`, { cover: `https://k/${i}.jpg` }))
		});
		const out = await collectCoverCandidates(mk('kuwo', 'seed', { cover: null }));
		expect(out).toHaveLength(12);
	});

	it('does NOT write the cover cache (enumerating candidates is not a resolve)', async () => {
		vi.spyOn(deezer, 'deezerSearchTopN').mockResolvedValue([
			{ id: '1', title: 'x', artist: 'y', album: '', cover: 'https://dz/1.jpg', preview: null }
		]);
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		mockSearch();
		await collectCoverCandidates(track);
		expect(getCachedCover('Adele', 'Hello')).toBeNull();
		expect(getCachedCoverByUid(track.uid)).toBeNull();
	});
});
