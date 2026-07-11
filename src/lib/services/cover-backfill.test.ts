import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	backfillCovers,
	backfillArtistCovers,
	resolveCoverForTrack,
	resolveDeezerHQ,
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

// cover-backfill (quick-260607-0bb supersedes wv8). These tests pin the NEW multi-tier chains:
//   TRACK:  Deezer → iTunes → CN (searchAll+dedupeBest), stop at first SOLID (https, non-empty);
//   ARTIST: Deezer → iTunes, stop at first SOLID.
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

describe('backfillCovers — Deezer → iTunes → CN track chain (quick-260607-0bb)', () => {
	it('uses the Deezer cover when present and calls NEITHER iTunes NOR searchAll (tier-1 short-circuit)', async () => {
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/dz-cover.jpg');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Drake', title: 'Hotline Bling' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(deezerSpy).toHaveBeenCalledWith('Drake', 'Hotline Bling', undefined);
		expect(itunesSpy).not.toHaveBeenCalled(); // Deezer hit → no iTunes
		expect(searchSpy).not.toHaveBeenCalled(); // Deezer hit → no CN search
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe(
			'https://cdn-images.dzcdn.net/dz-cover.jpg'
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cdn-images.dzcdn.net/dz-cover.jpg');
	});

	it('falls back to iTunes when Deezer misses (and does NOT call searchAll)', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it-cover.jpg');
		const searchSpy = vi.spyOn(catalog, 'searchAll');

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Adele', title: 'Hello' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(deezerSpy).toHaveBeenCalled();
		// iTunes receives the caller's signal (undefined here — no signal supplied).
		expect(itunesSpy).toHaveBeenCalledWith('Adele', 'Hello', undefined);
		expect(searchSpy).not.toHaveBeenCalled(); // iTunes hit → no CN search
		expect(getCachedCover('Adele', 'Hello')).toBe('https://is1-ssl.mzstatic.com/it-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://is1-ssl.mzstatic.com/it-cover.jpg');
	});

	it('falls back to the CN cover when BOTH Deezer and iTunes miss, then caches + notifies', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn-cover.jpg' });
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		const resolved: Array<[string, string]> = [];
		await backfillCovers([{ artist: 'Jay Chou', title: 'Simple Love' }], {
			onResolved: (k, u) => resolved.push([k, u])
		});

		expect(deezerSpy).toHaveBeenCalled();
		expect(itunesSpy).toHaveBeenCalled();
		// WR-01: the CN tier now threads explicit {} prefs + the caller's signal
		// (undefined here — no signal supplied) so the fan-out is abortable like tiers 1-2.
		expect(searchSpy).toHaveBeenCalledWith('Jay Chou Simple Love', 1, {}, undefined);
		expect(getCachedCover('Jay Chou', 'Simple Love')).toBe('https://cn.example/cn-cover.jpg');
		expect(resolved).toHaveLength(1);
		expect(resolved[0][1]).toBe('https://cn.example/cn-cover.jpg');
	});

	it('leaves the gradient (no cache, no notify) when Deezer + iTunes + CN all miss', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'X', title: 'Y' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('X', 'Y')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('NEGATIVE-MISS CACHE: a repeat pass for a missing tile within the TTL does NOT re-search (kills the refresh re-fire flood)', async () => {
		// debug-nowbar-frozen-audius-spam follow-up: a total miss is not cover-cached (so it retries
		// eventually), but it MUST be remembered short-term so every Home refresh/randomize does not
		// re-run the full Deezer→iTunes→CN fan-out for the same imageless tiles.
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]); // pass 1: full chain, finds nothing
		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]); // pass 2: skipped by the negative cache

		expect(deezerSpy).toHaveBeenCalledTimes(1); // NOT 2 — the second pass issued zero requests
		expect(itunesSpy).toHaveBeenCalledTimes(1);
		expect(searchSpy).toHaveBeenCalledTimes(1);

		// After the TTL window (simulated by a reset) the tile is eligible to retry — nothing is pinned.
		__resetCoverMissCache();
		await backfillCovers([{ artist: 'Miss', title: 'Tile' }]);
		expect(deezerSpy).toHaveBeenCalledTimes(2); // retried once the miss expired
	});

	it('NEGATIVE-MISS CACHE: a later SOLID hit clears the miss so a now-resolvable tile is not skipped', async () => {
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValueOnce(null); // pass 1: miss

		await backfillCovers([{ artist: 'Later', title: 'Cover' }]); // miss → remembered
		expect(getCachedCover('Later', 'Cover')).toBeNull();

		// Cover becomes available; a fresh pass (after the miss TTL) resolves + caches it.
		deezerSpy.mockResolvedValue('https://cdn-images.dzcdn.net/later.jpg');
		__resetCoverMissCache();
		await backfillCovers([{ artist: 'Later', title: 'Cover' }]);
		expect(getCachedCover('Later', 'Cover')).toBe('https://cdn-images.dzcdn.net/later.jpg');
		expect(searchSpy).toHaveBeenCalledTimes(1); // only the first (missing) pass reached the CN tier
	});

	it('treats a NON-https cover as a miss and falls through to the next tier', async () => {
		// Deezer returns an http (insecure) URL → must NOT be cached; falls through to iTunes.
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://insecure.example/x.jpg');
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/ok.jpg');
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));

		await backfillCovers([{ artist: 'A', title: 'B' }]);
		expect(itunesSpy).toHaveBeenCalled();
		expect(getCachedCover('A', 'B')).toBe('https://is1-ssl.mzstatic.com/ok.jpg');
	});

	it('does NOT cache an http-only final result (all tiers non-https → gradient)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://a/x.jpg');
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const cnHit = mk('netease', 'hit', { cover: 'http://cn.example/insecure.jpg' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([cnHit]));

		const resolved: string[] = [];
		await backfillCovers([{ artist: 'A', title: 'B' }], { onResolved: (k) => resolved.push(k) });
		expect(getCachedCover('A', 'B')).toBeNull();
		expect(resolved).toHaveLength(0);
	});

	it('falls through to iTunes when deezerSongCover THROWS (per-tier never-throw)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer down'));
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it.jpg');
		const searchSpy = vi.spyOn(catalog, 'searchAll');

		await backfillCovers([{ artist: 'X', title: 'Y' }]);
		expect(itunesSpy).toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
		expect(getCachedCover('X', 'Y')).toBe('https://is1-ssl.mzstatic.com/it.jpg');
	});

	it('falls through to CN when iTunes THROWS after a Deezer miss (per-tier never-throw)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes down'));
		const hit = mk('netease', 'hit', { cover: 'https://cn.example/cn.jpg' });
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([hit]));

		await backfillCovers([{ artist: 'X', title: 'Y' }]);
		expect(searchSpy).toHaveBeenCalled();
		expect(getCachedCover('X', 'Y')).toBe('https://cn.example/cn.jpg');
	});

	it('never rejects when ALL tiers throw (degrades to the gradient)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer'));
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes'));
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('cn'));
		await expect(backfillCovers([{ artist: 'X', title: 'Y' }])).resolves.toBeUndefined();
		expect(getCachedCover('X', 'Y')).toBeNull();
	});

	it('skips an already-cached track (zero tier calls on a warm pass)', async () => {
		const { setCachedCover } = await import('./cover-cache');
		setCachedCover('Cached', 'Song', 'https://cdn-images.dzcdn.net/cached.jpg');
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://x/y.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue('https://x/z.jpg');
		const searchSpy = vi.spyOn(catalog, 'searchAll');

		await backfillCovers([{ artist: 'Cached', title: 'Song' }]);
		expect(deezerSpy).not.toHaveBeenCalled();
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
	});

	it('caps the track fan-out to `max`', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/x.jpg');
		await backfillCovers(
			[
				{ artist: 'A', title: '1' },
				{ artist: 'B', title: '2' },
				{ artist: 'C', title: '3' }
			],
			{ max: 2 }
		);
		expect(deezerSpy).toHaveBeenCalledTimes(2);
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
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://cdn-images.dzcdn.net/c.jpg');
		const t = mk('netease', '12345', { artist: 'Drake', title: 'Hotline Bling' });

		const out = await resolveCoverForTrack(t);
		expect(out).toBe('https://cdn-images.dzcdn.net/c.jpg');
		// BOTH layers written on a SOLID hit (D-13).
		expect(getCachedCoverByUid('netease:12345')).toBe('https://cdn-images.dzcdn.net/c.jpg');
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://cdn-images.dzcdn.net/c.jpg');
	});

	it('runs the Deezer → iTunes → CN tier order (falls through to iTunes on a Deezer miss)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi
			.spyOn(itunes, 'itunesSongCover')
			.mockResolvedValue('https://is1-ssl.mzstatic.com/it.jpg');
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const t = mk('qq', 'abc', { artist: 'Adele', title: 'Hello' });

		const out = await resolveCoverForTrack(t);
		expect(out).toBe('https://is1-ssl.mzstatic.com/it.jpg');
		expect(itunesSpy).toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
	});

	it('returns null on a total miss (chain never throws), caching nothing', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer'));
		vi.spyOn(itunes, 'itunesSongCover').mockRejectedValue(new Error('itunes'));
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('cn'));
		const t = mk('netease', 'miss', { artist: 'X', title: 'Y' });

		await expect(resolveCoverForTrack(t)).resolves.toBeNull();
		expect(getCachedCoverByUid('netease:miss')).toBeNull();
		expect(getCachedCover('X', 'Y')).toBeNull();
	});

	it('rejects a non-https tier result (isSolidCover gate) — returns null, nothing cached', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://insecure/a.jpg');
		vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([]));
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

describe('resolveDeezerHQ — Deezer-only HQ upgrade (Plan 26-02, COVER-01)', () => {
	it('returns the SOLID Deezer cover and calls NEITHER iTunes NOR searchAll (single tier)', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const t = mk('kuwo', '999', { artist: 'Drake', title: 'Hotline Bling' });

		const out = await resolveDeezerHQ(t);
		expect(out).toBe('https://cdn-images.dzcdn.net/hq.jpg');
		expect(deezerSpy).toHaveBeenCalledTimes(1);
		expect(deezerSpy).toHaveBeenCalledWith('Drake', 'Hotline Bling', undefined);
		expect(itunesSpy).not.toHaveBeenCalled(); // single tier — NEVER iTunes
		expect(searchSpy).not.toHaveBeenCalled(); // single tier — NEVER the CN searchAll tier
	});

	it('writes BOTH cache layers on a SOLID hit (real uid → uid layer + name layer)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const t = mk('kuwo', '12345', { artist: 'Drake', title: 'Hotline Bling' });
		await resolveDeezerHQ(t);
		expect(getCachedCoverByUid('kuwo:12345')).toBe('https://cdn-images.dzcdn.net/hq.jpg');
		expect(getCachedCover('Drake', 'Hotline Bling')).toBe('https://cdn-images.dzcdn.net/hq.jpg');
	});

	it('writes ONLY the name layer for an empty-uid stub (charts-tags-same-cover guard)', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const stub = mk('netease', 'ignored', { uid: '', artist: 'Foo Fighters', title: 'Everlong' });
		await resolveDeezerHQ(stub);
		expect(getCachedCoverByUid('')).toBeNull(); // shared 'uid:' slot never written for an empty uid
		expect(getCachedCover('Foo Fighters', 'Everlong')).toBe('https://cdn-images.dzcdn.net/hq.jpg');
	});

	it('returns null (no throw) and caches nothing on a Deezer miss — never touches iTunes/CN', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		const t = mk('kuwo', 'miss', { artist: 'A', title: 'B' });

		await expect(resolveDeezerHQ(t)).resolves.toBeNull();
		expect(deezerSpy).toHaveBeenCalledTimes(1);
		expect(itunesSpy).not.toHaveBeenCalled();
		expect(searchSpy).not.toHaveBeenCalled();
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('treats a non-https Deezer result as a miss (isSolidCover) — returns null, caches nothing', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue('http://insecure.example/x.jpg');
		const t = mk('kuwo', 'ins', { artist: 'A', title: 'B' });
		await expect(resolveDeezerHQ(t)).resolves.toBeNull();
		expect(getCachedCover('A', 'B')).toBeNull();
	});

	it('never throws when Deezer throws (per-tier never-throw) — returns null', async () => {
		vi.spyOn(deezer, 'deezerSongCover').mockRejectedValue(new Error('deezer down'));
		const t = mk('kuwo', 'throw', { artist: 'A', title: 'B' });
		await expect(resolveDeezerHQ(t)).resolves.toBeNull();
	});

	it('returns null immediately when the signal is already aborted (issues NO Deezer call)', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover');
		const t = mk('kuwo', 'abort', { artist: 'A', title: 'B' });
		const ac = new AbortController();
		ac.abort();
		await expect(resolveDeezerHQ(t, ac.signal)).resolves.toBeNull();
		expect(deezerSpy).not.toHaveBeenCalled();
	});
});

// Plan 26-02, Task 3 — the click-to-play cover fan-out PROOF (T-26-02-01 DoS mitigation). Spike 003
// measured the Deezer+iTunes tiers + a 7-source CN searchAll per COVERLESS tile as a large share of a
// play's /api calls; kuwo returns a usable cover inline on 38/38, so ~all plays need zero cover network
// work. These tests pin the two paths at the SERVICE seam the player drives:
//   - INLINE-COVER hot path → the bounded resolveDeezerHQ UPGRADE: 0 iTunes + 0 CN + ≤1 Deezer call.
//   - COVERLESS miss path   → resolveCoverForTrack still fans the full Deezer → iTunes → CN chain.
// They are regression guards for behavior already landed in Tasks 1–2 (so they are GREEN on first run
// by design — the hot path never fans out, the miss path still recovers).
describe('click-to-play cover fan-out proof (Plan 26-02, T-26-02-01)', () => {
	it('INLINE-COVER hot path (resolveDeezerHQ): 0 iTunes + 0 CN searchAll + at most 1 Deezer call', async () => {
		const deezerSpy = vi
			.spyOn(deezer, 'deezerSongCover')
			.mockResolvedValue('https://cdn-images.dzcdn.net/hq.jpg');
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover');
		const searchSpy = vi.spyOn(catalog, 'searchAll');
		// A resolved track that ALREADY carries a SOLID inline source cover (kuwo pic) — the player
		// painted it synchronously and fires ONLY the optional Deezer HQ upgrade for it.
		const inline = mk('kuwo', 'inline', {
			artist: 'Jay Chou',
			title: 'Blue and White Porcelain',
			cover: 'https://kuwo.example/inline.jpg'
		});

		await resolveDeezerHQ(inline);

		expect(itunesSpy).not.toHaveBeenCalled(); // ZERO iTunes on the hot path
		expect(searchSpy).not.toHaveBeenCalled(); // ZERO CN searchAll on the hot path
		expect(deezerSpy.mock.calls.length).toBeLessThanOrEqual(1); // at most ONE Deezer upgrade call
	});

	it('COVERLESS miss path (resolveCoverForTrack): still fans through Deezer → iTunes → CN', async () => {
		const deezerSpy = vi.spyOn(deezer, 'deezerSongCover').mockResolvedValue(null);
		const itunesSpy = vi.spyOn(itunes, 'itunesSongCover').mockResolvedValue(null);
		const cnHit = mk('netease', 'cn', { cover: 'https://cn.example/cn.jpg' });
		const searchSpy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(result([cnHit]));
		// A genuinely coverless source (joox/fivesing) — no inline cover, so the full chain must run.
		const coverless = mk('joox', 'coverless', { artist: 'Adele', title: 'Hello', cover: null });

		const out = await resolveCoverForTrack(coverless);

		expect(deezerSpy).toHaveBeenCalled(); // tier 1
		expect(itunesSpy).toHaveBeenCalled(); // tier 2 (Deezer missed)
		expect(searchSpy).toHaveBeenCalled(); // tier 3 (Deezer + iTunes missed)
		expect(out).toBe('https://cn.example/cn.jpg');
	});
});
